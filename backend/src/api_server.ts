// S22 — API server: wires the router to the platform modules behind RBAC.
// Each route resolves the authenticated user, calls the governed module, and
// publishes an event. This is the real HTTP integration surface for the engine.

import { Router, json, authMiddleware, HttpError, type ApiRequest } from "./api.js";
import { GovernedRegistry } from "./governed_registry.js";
import { IdentityStore, hasPermission, type User, type Role } from "./identity.js";
import { ReviewQueue, InvalidReviewActionError, type ReviewItem } from "./notifications.js";
import { EventBus } from "./events.js";
import { PolicyRegistry, evaluatePolicy, type PolicyContext } from "./policy.js";
import { OidcValidator } from "./oidc.js";
import {
  AuthService,
  InvalidCredentialsError,
  EmailTakenError,
  WeakPasswordError,
  IncorrectPasswordError,
  LastAdminError,
  AuthNotFoundError,
  UserDeactivatedError,
  TenantSuspendedError,
  AuthError,
  type RegisterInput,
} from "./auth.js";
import { DuplicateTenantError } from "./identity.js";
import { schemaValidationMiddleware, AGENTFOUNDRY_BODY_SCHEMAS } from "./schema_middleware.js";
import { HealthAggregator } from "./health.js";
import { SecretsVault } from "./secrets.js";
import { BillingEngine } from "./billing.js";
import { InvoiceStore } from "./invoice_store.js";
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
  // Optional secrets vault (S17); when present, exposes admin-only, tenant-scoped
  // read endpoints GET /secrets and /connectors (masked values only).
  secretsVault?: SecretsVault;
  // Optional billing engine (S34); when present, exposes admin-only GET
  // /billing/current (the caller tenant's current-period invoice).
  billingEngine?: BillingEngine;
  // Optional invoice store (S37); when present, exposes admin-only GET
  // /billing/history (the caller tenant's stored invoices + lifetime summary).
  invoiceStore?: InvoiceStore;
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

  // Extract the bearer session token from a request (empty string if absent).
  // The auth middleware has already validated it for protected routes; handlers
  // use this when they need the raw token (logout, keep-this-session on password
  // change). Centralised so the parse is covered in exactly one place.
  const bearerToken = (req: ApiRequest): string => {
    const authz = req.headers["authorization"] ?? "";
    return authz.startsWith("Bearer ") ? authz.slice(7) : "";
  };

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
      // S91/S92: deactivated account or suspended tenant -> 403 (authenticated
      // identity is valid but access is administratively blocked).
      if (err instanceof UserDeactivatedError) throw new HttpError(403, err.message);
      if (err instanceof TenantSuspendedError) throw new HttpError(403, err.message);
      throw err;
    }
  });

  // Logout: revokes the bearer session token. Idempotent.
  router.post("/auth/logout", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    const revoked = deps.auth.logout(bearerToken(req));
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
      displayName: user.displayName,
    });
  });

  // S90 — profile self-service: update the caller's own display name / email.
  router.patch("/auth/profile", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    const user = userOf(req);
    const b = (req.body ?? {}) as { displayName?: string; email?: string };
    if (b.displayName === undefined && b.email === undefined) {
      throw new HttpError(400, "Provide displayName and/or email");
    }
    try {
      const updated = deps.auth.updateProfile(user.id, b);
      return json(200, {
        id: updated.id,
        email: updated.email,
        tenantId: updated.tenantId,
        roles: updated.roles,
        displayName: updated.displayName,
      });
    } catch (err) {
      if (err instanceof EmailTakenError) throw new HttpError(409, err.message);
      if (err instanceof AuthError) throw new HttpError(400, err.message);
      throw err;
    }
  });

  // S90 — change the caller's own password (verifies current, revokes other sessions).
  router.post("/auth/password", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    const user = userOf(req);
    const b = (req.body ?? {}) as { currentPassword?: string; newPassword?: string };
    if (!b.currentPassword || !b.newPassword) {
      throw new HttpError(400, "currentPassword and newPassword are required");
    }
    const keepToken = bearerToken(req);
    try {
      const revoked = deps.auth.changePassword(user.id, b.currentPassword, b.newPassword, keepToken);
      return json(200, { changed: true, otherSessionsRevoked: revoked });
    } catch (err) {
      if (err instanceof IncorrectPasswordError) throw new HttpError(401, err.message);
      if (err instanceof WeakPasswordError) throw new HttpError(400, err.message);
      throw err;
    }
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
      displayName: u.displayName,
      active: u.active !== false,
    }));
    return json(200, { users });
  });

  // ---- S91: tenant-admin user management (admin:manage_users, own-tenant only) ----
  const requireUserAdmin = (req: ApiRequest): User => {
    const user = userOf(req);
    if (!hasPermission(user, "admin:manage_users")) throw new HttpError(403, "Requires admin:manage_users");
    return user;
  };
  // Resolve a target user in the admin's own tenant (404 if missing, 403 cross-tenant).
  const targetInTenant = (admin: User, userId: string): User => {
    let target: User;
    try {
      target = deps.identity.getUser(userId);
    } catch {
      throw new HttpError(404, "User not found");
    }
    if (target.tenantId !== admin.tenantId) throw new HttpError(403, "Cannot manage another tenant's user");
    return target;
  };
  const publicUser = (u: User) => ({
    id: u.id,
    email: u.email,
    tenantId: u.tenantId,
    roles: u.roles,
    displayName: u.displayName,
    active: u.active !== false,
  });

  // Create a user in the admin's tenant.
  router.post("/admin/users", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    const admin = requireUserAdmin(req);
    const b = (req.body ?? {}) as { email?: string; password?: string; roles?: Role[]; displayName?: string };
    if (!b.email || !b.password) throw new HttpError(400, "email and password are required");
    const roles: Role[] = Array.isArray(b.roles) && b.roles.length > 0 ? b.roles : ["viewer"];
    try {
      const created = deps.auth.adminCreateUser({
        tenantId: admin.tenantId,
        email: b.email,
        password: b.password,
        roles,
        displayName: b.displayName,
      });
      return json(201, publicUser(created));
    } catch (err) {
      if (err instanceof WeakPasswordError) throw new HttpError(400, err.message);
      if (err instanceof EmailTakenError) throw new HttpError(409, err.message);
      if (err instanceof AuthNotFoundError) throw new HttpError(404, err.message);
      throw err;
    }
  });

  // Replace a user's roles.
  router.patch("/admin/users/:id/roles", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    const admin = requireUserAdmin(req);
    targetInTenant(admin, req.params.id);
    const b = (req.body ?? {}) as { roles?: Role[] };
    if (!Array.isArray(b.roles) || b.roles.length === 0) throw new HttpError(400, "roles must be a non-empty array");
    try {
      return json(200, publicUser(deps.auth.setUserRoles(req.params.id, b.roles)));
    } catch (err) {
      if (err instanceof LastAdminError) throw new HttpError(409, err.message);
      throw err;
    }
  });

  // Deactivate a user.
  router.post("/admin/users/:id/deactivate", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    const admin = requireUserAdmin(req);
    targetInTenant(admin, req.params.id);
    try {
      return json(200, publicUser(deps.auth.deactivateUser(req.params.id)));
    } catch (err) {
      if (err instanceof LastAdminError) throw new HttpError(409, err.message);
      throw err;
    }
  });

  // Reactivate a user.
  router.post("/admin/users/:id/reactivate", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    const admin = requireUserAdmin(req);
    targetInTenant(admin, req.params.id);
    return json(200, publicUser(deps.auth.reactivateUser(req.params.id)));
  });

  // Reset a user's password (admin issues a temp password).
  router.post("/admin/users/:id/reset-password", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    const admin = requireUserAdmin(req);
    targetInTenant(admin, req.params.id);
    const b = (req.body ?? {}) as { newPassword?: string };
    if (!b.newPassword) throw new HttpError(400, "newPassword is required");
    try {
      deps.auth.resetUserPassword(req.params.id, b.newPassword);
      return json(200, { reset: true });
    } catch (err) {
      if (err instanceof WeakPasswordError) throw new HttpError(400, err.message);
      throw err;
    }
  });

  // ---- S92: superadmin platform console (admin:platform, cross-tenant) ----
  const requirePlatformAdmin = (req: ApiRequest): User => {
    const user = userOf(req);
    if (!hasPermission(user, "admin:platform")) throw new HttpError(403, "Requires admin:platform");
    return user;
  };

  // List every tenant with user counts + status (platform-wide).
  router.get("/platform/tenants", (req) => {
    requirePlatformAdmin(req);
    const tenants = deps.identity.allTenants().map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status ?? "active",
      userCount: deps.identity.userCount(t.id),
    }));
    return json(200, { tenants });
  });

  // List the users of any tenant (cross-tenant read).
  router.get("/platform/tenants/:id/users", (req) => {
    requirePlatformAdmin(req);
    try {
      deps.identity.getTenant(req.params.id);
    } catch {
      throw new HttpError(404, "Tenant not found");
    }
    const users = deps.identity.usersInTenant(req.params.id).map(publicUser);
    return json(200, { users });
  });

  // Provision a brand-new tenant + its first admin user.
  router.post("/platform/tenants", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    requirePlatformAdmin(req);
    const b = (req.body ?? {}) as { tenantId?: string; tenantName?: string; adminEmail?: string; adminPassword?: string };
    if (!b.tenantId || !b.tenantName || !b.adminEmail || !b.adminPassword) {
      throw new HttpError(400, "tenantId, tenantName, adminEmail and adminPassword are required");
    }
    try {
      const { tenant, admin } = deps.auth.provisionTenant({
        tenantId: b.tenantId,
        tenantName: b.tenantName,
        adminEmail: b.adminEmail,
        adminPassword: b.adminPassword,
      });
      return json(201, {
        tenant: { id: tenant.id, name: tenant.name, status: tenant.status ?? "active" },
        admin: publicUser(admin),
      });
    } catch (err) {
      if (err instanceof DuplicateTenantError) throw new HttpError(409, err.message);
      if (err instanceof WeakPasswordError) throw new HttpError(400, err.message);
      if (err instanceof EmailTakenError) throw new HttpError(409, err.message);
      throw err;
    }
  });

  // Suspend a tenant (revokes its users' sessions; blocks their login).
  router.post("/platform/tenants/:id/suspend", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    requirePlatformAdmin(req);
    try {
      deps.identity.getTenant(req.params.id);
    } catch {
      throw new HttpError(404, "Tenant not found");
    }
    const t = deps.auth.setTenantStatus(req.params.id, "suspended");
    return json(200, { id: t.id, name: t.name, status: t.status });
  });

  // Reactivate a suspended tenant.
  router.post("/platform/tenants/:id/activate", (req) => {
    if (!deps.auth) throw new HttpError(404, "Auth not configured");
    requirePlatformAdmin(req);
    try {
      deps.identity.getTenant(req.params.id);
    } catch {
      throw new HttpError(404, "Tenant not found");
    }
    const t = deps.auth.setTenantStatus(req.params.id, "active");
    return json(200, { id: t.id, name: t.name, status: t.status });
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

  // ---- S93: human-in-the-loop reviewer queue over HTTP (reviewer or admin) ----
  const requireReviewer = (req: ApiRequest): User => {
    const user = userOf(req);
    // Reviewers approve; admins manage. Either may act on the review queue.
    if (!hasPermission(user, "agent:approve") && !hasPermission(user, "admin:manage_users")) {
      throw new HttpError(403, "Requires reviewer or admin");
    }
    return user;
  };
  const reviewView = (item: ReviewItem) => ({
    id: item.id,
    agentId: item.agentId,
    tenantId: item.tenantId,
    requestedBy: item.requestedBy,
    weightedScore: item.weightedScore,
    status: item.status,
    assignee: item.assignee,
    resolvedBy: item.resolvedBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
  // Resolve a review item that belongs to the caller's tenant (404 / 403).
  const reviewInTenant = (user: User, id: string): ReviewItem => {
    let item: ReviewItem;
    try {
      item = deps.reviews.get(id);
    } catch {
      throw new HttpError(404, "Review item not found");
    }
    if (item.tenantId !== user.tenantId) throw new HttpError(403, "Cannot act on another tenant's review");
    return item;
  };

  // Pending/assigned reviews for the caller's tenant.
  router.get("/reviews", (req) => {
    const user = userOf(req);
    return json(200, deps.reviews.pending(user.tenantId));
  });

  // Read a single review item (tenant-scoped).
  router.get("/reviews/:id", (req) => {
    const user = requireReviewer(req);
    const item = reviewInTenant(user, req.params.id);
    return json(200, reviewView(item));
  });

  // Approve a review item. Resolves the queue entry + emits an event.
  router.post("/reviews/:id/approve", async (req) => {
    const user = requireReviewer(req);
    const item = reviewInTenant(user, req.params.id);
    try {
      const resolved = deps.reviews.resolve(item.id, "approved", user.email);
      await deps.events.publish({
        type: "review.approved",
        tenantId: user.tenantId,
        subject: item.agentId,
        payload: { reviewId: item.id, reviewer: user.email },
      });
      return json(200, reviewView(resolved));
    } catch (err) {
      if (err instanceof InvalidReviewActionError) throw new HttpError(409, err.message);
      throw err;
    }
  });

  // Reject a review item. A reason is required and recorded with the event.
  router.post("/reviews/:id/reject", async (req) => {
    const user = requireReviewer(req);
    const item = reviewInTenant(user, req.params.id);
    const b = (req.body ?? {}) as { reason?: string };
    if (!b.reason || b.reason.trim().length === 0) throw new HttpError(400, "A rejection reason is required");
    try {
      const resolved = deps.reviews.resolve(item.id, "rejected", user.email);
      await deps.events.publish({
        type: "review.rejected",
        tenantId: user.tenantId,
        subject: item.agentId,
        payload: { reviewId: item.id, reviewer: user.email, reason: b.reason.trim() },
      });
      return json(200, reviewView(resolved));
    } catch (err) {
      if (err instanceof InvalidReviewActionError) throw new HttpError(409, err.message);
      throw err;
    }
  });

  // ---- S106: secrets & connectors read surface (admin-only, tenant-scoped) ----
  // Masked secrets only — plaintext is never returned over HTTP. The vault's
  // list()/listConnectors() already filter to the caller's tenant.
  router.get("/secrets", (req) => {
    if (!deps.secretsVault) throw new HttpError(404, "Secrets vault not configured");
    const user = userOf(req);
    if (!hasPermission(user, "admin:manage_users")) {
      throw new HttpError(403, "Requires admin:manage_users");
    }
    return json(200, { secrets: deps.secretsVault.list(user) });
  });

  router.get("/connectors", (req) => {
    if (!deps.secretsVault) throw new HttpError(404, "Secrets vault not configured");
    const user = userOf(req);
    if (!hasPermission(user, "admin:manage_users")) {
      throw new HttpError(403, "Requires admin:manage_users");
    }
    return json(200, { connectors: deps.secretsVault.listConnectors(user) });
  });

  // ---- S107: billing & invoices read surface (admin-only, tenant-scoped) ----
  // Current-period invoice computed live from metered usage.
  router.get("/billing/current", (req) => {
    if (!deps.billingEngine) throw new HttpError(404, "Billing engine not configured");
    const user = userOf(req);
    if (!hasPermission(user, "admin:manage_users")) {
      throw new HttpError(403, "Requires admin:manage_users");
    }
    return json(200, deps.billingEngine.invoice(user.tenantId));
  });

  // Stored invoice history + lifetime summary + period-over-period delta.
  router.get("/billing/history", (req) => {
    if (!deps.invoiceStore) throw new HttpError(404, "Invoice store not configured");
    const user = userOf(req);
    if (!hasPermission(user, "admin:manage_users")) {
      throw new HttpError(403, "Requires admin:manage_users");
    }
    return json(200, {
      invoices: deps.invoiceStore.history(user.tenantId),
      summary: deps.invoiceStore.summary(user.tenantId),
      periodOverPeriod: deps.invoiceStore.periodOverPeriod(user.tenantId),
    });
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
