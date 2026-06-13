// S22 — API server: wires the router to the platform modules behind RBAC.
// Each route resolves the authenticated user, calls the governed module, and
// publishes an event. This is the real HTTP integration surface for the engine.

import { Router, json, authMiddleware, HttpError, type ApiRequest } from "./api.js";
import { GovernedRegistry } from "./governed_registry.js";
import { IdentityStore, hasPermission, type User } from "./identity.js";
import { ReviewQueue } from "./notifications.js";
import { EventBus } from "./events.js";
import { PolicyRegistry, evaluatePolicy, type PolicyContext } from "./policy.js";
import { OidcValidator } from "./oidc.js";
import {
  AuthService,
  InvalidCredentialsError,
  EmailTakenError,
  WeakPasswordError,
  type RegisterInput,
} from "./auth.js";
import { schemaValidationMiddleware, AGENTFOUNDRY_BODY_SCHEMAS } from "./schema_middleware.js";
import { HealthAggregator } from "./health.js";
import type { PlatformStatusReport } from "./platform_status.js";
import type { AgentDesign } from "./types.js";
import type { ApprovalRecord } from "./promotion.js";

export interface ApiDeps {
  identity: IdentityStore;
  registry: GovernedRegistry;
  reviews: ReviewQueue;
  events: EventBus;
  // Optional policy registry; when present, promote enforces the matching policy.
  policies?: PolicyRegistry;
  // Optional OIDC validator; when present, tokens are validated as signed claims
  // (federated identity) instead of looked up in the static token map.
  oidc?: OidcValidator;
  // When true, request bodies are validated against the route schemas (400 on fail).
  validateBodies?: boolean;
  // Optional health aggregator; exposes a deep status report at GET /healthz.
  health?: HealthAggregator;
  // Optional consolidated status provider; exposes GET /status (operator view).
  statusProvider?: () => PlatformStatusReport;
  // Optional status-history provider; exposes GET /status/history (trend + samples).
  statusHistoryProvider?: () => unknown;
  // Optional compliance-history provider; exposes GET /compliance/history for a tenant.
  complianceHistoryProvider?: (tenantId: string) => unknown;
  // Optional signed audit-export provider; exposes GET /audit/export for a tenant.
  auditExportProvider?: (tenantId: string) => unknown;
  // Optional DR runbook provider; exposes GET /dr/runbook.
  drRunbookProvider?: () => unknown;
  // Optional compliance pack provider; exposes GET /compliance/pack for a tenant.
  compliancePackProvider?: (tenantId: string) => unknown;
  // Optional profile-apply handler; exposes POST /profiles/:tenant/apply.
  // Returns the apply result (or throws to signal failure).
  profileApplyHandler?: (tenantId: string) => unknown;
  // Optional profile-history provider; exposes GET /profiles/:tenant/history.
  profileHistoryProvider?: (tenantId: string) => unknown;
  // Optional profile-export provider; exposes GET /profiles/:tenant/export.
  profileExportProvider?: (tenantId: string) => unknown;
  // Optional profile-import handler; exposes POST /profiles/:tenant/import.
  // Receives the target tenant and the posted export envelope.
  profileImportHandler?: (tenantId: string, envelope: unknown) => unknown;
  // Optional session auth service; when present, exposes public POST /auth/register,
  // /auth/login, /auth/logout and resolves session bearer tokens for all routes.
  auth?: AuthService;
  // token -> userId resolver (a real system uses JWT/session).
  tokens: Map<string, string>;
}

export function buildApi(deps: ApiDeps): Router {
  const router = new Router();

  // Public (pre-auth) endpoints that the auth middleware must not block.
  const PUBLIC_PATHS = new Set(["/auth/register", "/auth/login", "/auth/logout"]);

  const authMiddlewareImpl = authMiddleware((token) => {
    // Federated identity path: validate the token as signed claims and
    // just-in-time provision the user into the local store.
    if (deps.oidc) {
      const result = deps.oidc.validate(token);
      if (result.valid) {
        const c = result.claims;
        try {
          deps.identity.upsertUser({
            id: c.sub,
            tenantId: c.tenant,
            email: c.email,
            roles: c.roles,
          });
          return { userId: c.sub, tenantId: c.tenant };
        } catch {
          // Tenant not provisioned -> reject below via token map fallback.
        }
      }
      // Fall through to the token map (supports mixed/migration setups).
    }
    // Session token path: resolve an opaque session via the AuthService.
    if (deps.auth) {
      try {
        const user = deps.auth.resolve(token);
        return { userId: user.id, tenantId: user.tenantId };
      } catch {
        // Not a session token (or expired) -> fall through to the token map.
      }
    }
    const userId = deps.tokens.get(token);
    if (!userId) return null;
    try {
      const user = deps.identity.getUser(userId);
      return { userId: user.id, tenantId: user.tenantId };
    } catch {
      return null;
    }
  });

  // Auth: OIDC-validated claims when configured, else session token, else the
  // static token map. Public auth endpoints are exempt.
  router.use(async (req, next) => {
    if (PUBLIC_PATHS.has(req.path)) return next();
    return authMiddlewareImpl(req, next);
  });

  const userOf = (req: ApiRequest): User => deps.identity.getUser(req.userId!);

  // Optional request-body contract enforcement (after auth, before handlers).
  if (deps.validateBodies) {
    router.use(schemaValidationMiddleware(AGENTFOUNDRY_BODY_SCHEMAS));
  }

  // Health (still behind auth in this build; a real one would exempt it).
  router.get("/health", () => json(200, { status: "ok" }));

  // ---- Public authentication endpoints (S78) ----
  // Registration: provisions tenant (if new) + user + credentials, returns a session.
  router.post("/auth/register", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    const b = (req.body ?? {}) as Partial<RegisterInput>;
    if (!b.tenantId || !b.tenantName || !b.email || !b.password) {
      throw new HttpError(400, "tenantId, tenantName, email and password are required");
    }
    try {
      const r = deps.auth.register({
        tenantId: b.tenantId,
        tenantName: b.tenantName,
        email: b.email,
        password: b.password,
        roles: b.roles,
      });
      return json(201, {
        token: r.token,
        expiresAt: r.expiresAt,
        user: { id: r.user.id, email: r.user.email, tenantId: r.user.tenantId, roles: r.user.roles },
      });
    } catch (err) {
      if (err instanceof WeakPasswordError) throw new HttpError(400, err.message);
      if (err instanceof EmailTakenError) throw new HttpError(409, err.message);
      throw err;
    }
  });

  // Login: verifies credentials, returns a fresh session token.
  router.post("/auth/login", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    const b = (req.body ?? {}) as { email?: string; password?: string };
    if (!b.email || !b.password) throw new HttpError(400, "email and password are required");
    try {
      const r = deps.auth.login(b.email, b.password);
      return json(200, {
        token: r.token,
        expiresAt: r.expiresAt,
        user: { id: r.user.id, email: r.user.email, tenantId: r.user.tenantId, roles: r.user.roles },
      });
    } catch (err) {
      if (err instanceof InvalidCredentialsError) throw new HttpError(401, err.message);
      throw err;
    }
  });

  // Logout: revokes the bearer session token. Idempotent.
  router.post("/auth/logout", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    const authz = req.headers["authorization"] ?? "";
    const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
    const revoked = deps.auth.logout(token);
    return json(200, { revoked });
  });

  // ---- Authenticated session + admin endpoints (S78) ----
  // Who am I: returns the resolved user for the current session.
  router.get("/auth/me", (req) => {
    const user = userOf(req);
    return json(200, {
      id: user.id,
      email: user.email,
      tenantId: user.tenantId,
      roles: user.roles,
    });
  });

  // Admin: list users in the caller's tenant (requires admin:manage_users).
  router.get("/admin/users", (req) => {
    const user = userOf(req);
    if (!hasPermission(user, "admin:manage_users")) {
      throw new HttpError(403, "Requires admin:manage_users");
    }
    const users = deps.identity.usersInTenant(user.tenantId).map((u) => ({
      id: u.id,
      email: u.email,
      tenantId: u.tenantId,
      roles: u.roles,
    }));
    return json(200, { users });
  });

  // Deep health report (when a health aggregator is configured).
  router.get("/healthz", () => {
    if (!deps.health) return json(200, { status: "ok", components: [] });
    const report = deps.health.report();
    const status = report.state === "down" ? 503 : 200;
    return json(status, report);
  });

  // Consolidated operator status (health + agents + reviews + drift + billing).
  router.get("/status", () => {
    if (!deps.statusProvider) {
      throw new HttpError(404, "Status provider not configured");
    }
    const report = deps.statusProvider();
    const httpStatus = report.state === "down" ? 503 : 200;
    return json(httpStatus, report);
  });

  // Platform status history (trend + recent samples).
  router.get("/status/history", () => {
    if (!deps.statusHistoryProvider) {
      throw new HttpError(404, "Status history not configured");
    }
    return json(200, deps.statusHistoryProvider());
  });

  // Register an agent.
  router.post("/agents", async (req) => {
    const design = req.body as AgentDesign;
    if (!design || !design.id) throw new HttpError(400, "Missing agent design");
    const rec = deps.registry.register(userOf(req), design);
    await deps.events.publish({
      type: "agent.registered",
      tenantId: req.tenantId!,
      subject: rec.id,
      payload: { version: rec.currentVersion },
    });
    return json(201, rec);
  });

  // Read an agent.
  router.get("/agents/:id", (req) => {
    const rec = deps.registry.read(userOf(req), req.params.id);
    return json(200, rec);
  });

  // List agents in the caller's tenant.
  router.get("/agents", (req) => {
    return json(200, deps.registry.list(userOf(req)));
  });

  // Request promotion -> creates a review item + event.
  router.post("/agents/:id/promote", async (req) => {
    const user = userOf(req);
    const rec = deps.registry.requestPromotion(user, req.params.id);
    const item = deps.reviews.submit({
      agentId: rec.id,
      tenantId: user.tenantId,
      requestedBy: user.email,
      weightedScore: (req.body as { weightedScore?: number })?.weightedScore ?? 0,
    });
    await deps.events.publish({
      type: "promotion.requested",
      tenantId: user.tenantId,
      subject: rec.id,
      payload: { reviewId: item.id },
    });
    return json(202, { agent: rec, review: item });
  });

  // Approve -> transitions registry + resolves review + event.
  router.post("/agents/:id/approve", async (req) => {
    const user = userOf(req);
    const body = req.body as {
      approval: ApprovalRecord;
      reviewId?: string;
      policyContext?: PolicyContext;
    };
    if (!body?.approval) throw new HttpError(400, "Missing approval record");

    // Policy-as-code gate: if a policy registry is configured and a scorecard
    // context is provided, enforce the matching policy before approving.
    if (deps.policies && body.policyContext) {
      const policy = deps.policies.selectForTier(body.policyContext.riskTier);
      if (policy) {
        const evaluation = evaluatePolicy(policy, body.policyContext);
        if (!evaluation.passed) {
          return json(422, {
            error: "Policy gate failed",
            policyId: evaluation.policyId,
            hardFailures: evaluation.hardFailures,
          });
        }
      }
    }

    const rec = deps.registry.approve(user, req.params.id, body.approval);
    if (body.reviewId) deps.reviews.resolve(body.reviewId, "approved", user.email);
    await deps.events.publish({
      type: "promotion.approved",
      tenantId: user.tenantId,
      subject: rec.id,
      payload: { reviewer: user.email },
    });
    return json(200, rec);
  });

  // Deploy -> registry transition + event.
  router.post("/agents/:id/deploy", async (req) => {
    const user = userOf(req);
    const rec = deps.registry.deploy(user, req.params.id);
    await deps.events.publish({
      type: "agent.deployed",
      tenantId: user.tenantId,
      subject: rec.id,
      payload: {},
    });
    return json(200, rec);
  });

  // Retire.
  router.delete("/agents/:id", async (req) => {
    const user = userOf(req);
    const rec = deps.registry.retire(user, req.params.id, "retired via API");
    await deps.events.publish({
      type: "agent.retired",
      tenantId: user.tenantId,
      subject: rec.id,
      payload: {},
    });
    return json(200, rec);
  });

  // Pending reviews for the caller's tenant.
  router.get("/reviews", (req) => {
    const user = userOf(req);
    return json(200, deps.reviews.pending(user.tenantId));
  });

  // Signed audit export for the caller's tenant (compliance bundle).
  router.get("/audit/export", (req) => {
    if (!deps.auditExportProvider) {
      throw new HttpError(404, "Audit export not configured");
    }
    const user = userOf(req);
    return json(200, deps.auditExportProvider(user.tenantId));
  });

  // DR runbook (operator recovery procedure).
  router.get("/dr/runbook", () => {
    if (!deps.drRunbookProvider) {
      throw new HttpError(404, "DR runbook not configured");
    }
    return json(200, deps.drRunbookProvider());
  });

  // Consolidated compliance pack for the caller's tenant.
  router.get("/compliance/pack", (req) => {
    if (!deps.compliancePackProvider) {
      throw new HttpError(404, "Compliance pack not configured");
    }
    const user = userOf(req);
    return json(200, deps.compliancePackProvider(user.tenantId));
  });

  // Compliance posture history (archived snapshots + latest diff) for the tenant.
  router.get("/compliance/history", (req) => {
    if (!deps.complianceHistoryProvider) {
      throw new HttpError(404, "Compliance history not configured");
    }
    const user = userOf(req);
    return json(200, deps.complianceHistoryProvider(user.tenantId));
  });

  // Apply the caller's tenant config profile to live subsystems.
  router.post("/profiles/:tenant/apply", (req) => {
    if (!deps.profileApplyHandler) {
      throw new HttpError(404, "Profile apply not configured");
    }
    const user = userOf(req);
    // Callers may only apply their own tenant's profile.
    if (req.params.tenant !== user.tenantId) {
      throw new HttpError(403, "Cannot apply another tenant's profile");
    }
    return json(200, deps.profileApplyHandler(user.tenantId));
  });

  // Config profile version history (with diffs) for the caller's tenant.
  router.get("/profiles/:tenant/history", (req) => {
    if (!deps.profileHistoryProvider) {
      throw new HttpError(404, "Profile history not configured");
    }
    const user = userOf(req);
    if (req.params.tenant !== user.tenantId) {
      throw new HttpError(403, "Cannot read another tenant's profile history");
    }
    return json(200, deps.profileHistoryProvider(user.tenantId));
  });

  // Export the caller's tenant config profile as a portable envelope.
  router.get("/profiles/:tenant/export", (req) => {
    if (!deps.profileExportProvider) {
      throw new HttpError(404, "Profile export not configured");
    }
    const user = userOf(req);
    if (req.params.tenant !== user.tenantId) {
      throw new HttpError(403, "Cannot export another tenant's profile");
    }
    return json(200, deps.profileExportProvider(user.tenantId));
  });

  // Import a config profile envelope into the caller's tenant as a new version.
  router.post("/profiles/:tenant/import", (req) => {
    if (!deps.profileImportHandler) {
      throw new HttpError(404, "Profile import not configured");
    }
    const user = userOf(req);
    if (req.params.tenant !== user.tenantId) {
      throw new HttpError(403, "Cannot import into another tenant");
    }
    if (!req.body) throw new HttpError(400, "Missing import envelope");
    return json(200, deps.profileImportHandler(user.tenantId, req.body));
  });

  return router;
}
