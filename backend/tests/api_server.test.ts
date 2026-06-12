import { describe, it, expect, beforeEach } from "vitest";
import { buildApi, type ApiDeps } from "../src/api_server.js";
import { GovernedRegistry } from "../src/governed_registry.js";
import { IdentityStore } from "../src/identity.js";
import { ReviewQueue, InMemoryChannel } from "../src/notifications.js";
import { EventBus, type WebhookTransport } from "../src/events.js";
import { PolicyRegistry, BASELINE_POLICY } from "../src/policy.js";
import { OidcValidator, decodeUnsignedClaims, encodeUnsignedClaims } from "../src/oidc.js";
import { HealthAggregator } from "../src/health.js";
import { acmeSupportBot } from "../src/seed.js";
import type { ApiRequest } from "../src/api.js";
import type { ApprovalRecord } from "../src/promotion.js";

const okTransport: WebhookTransport = { post: async () => true };

function setup(): { deps: ApiDeps; router: ReturnType<typeof buildApi> } {
  const identity = new IdentityStore();
  identity.createTenant({ id: "t1", name: "Acme" });
  identity.createUser({ id: "admin", tenantId: "t1", email: "admin@acme.test", roles: ["admin"] });
  identity.createUser({ id: "viewer", tenantId: "t1", email: "v@acme.test", roles: ["viewer"] });
  identity.createTenant({ id: "t2", name: "Other" });
  identity.createUser({ id: "outsider", tenantId: "t2", email: "x@evil.test", roles: ["admin"] });

  const tokens = new Map([
    ["admin-token", "admin"],
    ["viewer-token", "viewer"],
    ["outsider-token", "outsider"],
  ]);

  const deps: ApiDeps = {
    identity,
    registry: new GovernedRegistry(),
    reviews: new ReviewQueue(new InMemoryChannel()),
    events: new EventBus({ transport: okTransport }),
    tokens,
  };
  return { deps, router: buildApi(deps) };
}

function req(token: string, over: Partial<ApiRequest>): ApiRequest {
  return {
    method: "GET",
    path: "/",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    query: {},
    params: {},
    body: null,
    ...over,
  };
}

const approval: ApprovalRecord = Object.freeze({
  designId: "acme-support-bot",
  designVersion: "1.0.0",
  reviewer: "admin@acme.test",
  decision: "approved",
  weightedScore: 0.92,
  timestamp: new Date(0).toISOString(),
});

let ctx: ReturnType<typeof setup>;
beforeEach(() => (ctx = setup()));

describe("auth", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await ctx.router.handle(req("", { method: "GET", path: "/agents" }));
    expect(res.status).toBe(401);
  });
  it("rejects an unknown token", async () => {
    const res = await ctx.router.handle(req("nope", { method: "GET", path: "/agents" }));
    expect(res.status).toBe(401);
  });
  it("rejects a token that maps to a nonexistent user", async () => {
    // Token resolves to a userId, but that user isn't in the identity store.
    ctx.deps.tokens.set("orphan-token", "ghost-user");
    const res = await ctx.router.handle(req("orphan-token", { method: "GET", path: "/agents" }));
    expect(res.status).toBe(401);
  });
  it("allows health when authenticated", async () => {
    const res = await ctx.router.handle(req("admin-token", { method: "GET", path: "/health" }));
    expect(res.status).toBe(200);
  });
});

describe("agent lifecycle over HTTP", () => {
  async function register(token = "admin-token") {
    return ctx.router.handle(
      req(token, { method: "POST", path: "/agents", body: acmeSupportBot() }),
    );
  }

  it("registers an agent and emits an event", async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(ctx.deps.events.eventLog().some((e) => e.type === "agent.registered")).toBe(true);
  });

  it("rejects a malformed agent body", async () => {
    const res = await ctx.router.handle(req("admin-token", { method: "POST", path: "/agents", body: {} }));
    expect(res.status).toBe(400);
  });

  it("reads a registered agent", async () => {
    await register();
    const res = await ctx.router.handle(req("admin-token", { method: "GET", path: "/agents/acme-support-bot" }));
    expect(res.status).toBe(200);
  });

  it("lists agents in the tenant", async () => {
    await register();
    const res = await ctx.router.handle(req("admin-token", { method: "GET", path: "/agents" }));
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as unknown[]).length).toBe(1);
  });

  it("walks promote -> approve -> deploy -> retire with events", async () => {
    await register();
    const promote = await ctx.router.handle(
      req("admin-token", { method: "POST", path: "/agents/acme-support-bot/promote", body: { weightedScore: 0.92 } }),
    );
    expect(promote.status).toBe(202);
    const reviewId = (promote.body as { review: { id: string } }).review.id;

    const approve = await ctx.router.handle(
      req("admin-token", { method: "POST", path: "/agents/acme-support-bot/approve", body: { approval, reviewId } }),
    );
    expect(approve.status).toBe(200);

    const deploy = await ctx.router.handle(
      req("admin-token", { method: "POST", path: "/agents/acme-support-bot/deploy", body: {} }),
    );
    expect((deploy.body as { state: string }).state).toBe("deployed");

    const retire = await ctx.router.handle(
      req("admin-token", { method: "DELETE", path: "/agents/acme-support-bot", body: null }),
    );
    expect((retire.body as { state: string }).state).toBe("retired");

    const types = ctx.deps.events.eventLog().map((e) => e.type);
    expect(types).toContain("promotion.requested");
    expect(types).toContain("promotion.approved");
    expect(types).toContain("agent.deployed");
    expect(types).toContain("agent.retired");
  });

  it("approve rejects a missing approval record", async () => {
    await register();
    await ctx.router.handle(req("admin-token", { method: "POST", path: "/agents/acme-support-bot/promote", body: {} }));
    const res = await ctx.router.handle(
      req("admin-token", { method: "POST", path: "/agents/acme-support-bot/approve", body: {} }),
    );
    expect(res.status).toBe(400);
  });
});

describe("RBAC + tenant isolation over HTTP", () => {
  it("a viewer cannot register (403-ish -> 500 mapped from PermissionDenied)", async () => {
    const res = await ctx.router.handle(req("viewer-token", { method: "POST", path: "/agents", body: acmeSupportBot() }));
    // PermissionDeniedError is not an HttpError -> mapped to 500 by the router.
    expect(res.status).toBe(500);
  });

  it("an outsider tenant cannot read another tenant's agent", async () => {
    await ctx.router.handle(req("admin-token", { method: "POST", path: "/agents", body: acmeSupportBot() }));
    const res = await ctx.router.handle(req("outsider-token", { method: "GET", path: "/agents/acme-support-bot" }));
    expect(res.status).toBe(500); // TenantIsolationError -> 500
  });
});

describe("policy gate over HTTP (S28)", () => {
  it("blocks approval with 422 when the policy hard-fails", async () => {
    const { deps } = setup();
    const policies = new PolicyRegistry();
    policies.register(BASELINE_POLICY);
    const router = buildApi({ ...deps, policies });

    await router.handle(req("admin-token", { method: "POST", path: "/agents", body: acmeSupportBot() }));
    await router.handle(req("admin-token", { method: "POST", path: "/agents/acme-support-bot/promote", body: { weightedScore: 0.5 } }));

    const failingContext = {
      card: { groundedAccuracy: 0, safetyPassRate: 0, consistencyScore: 0, hitlCoverage: 0, toolScopeRisk: 1, piiExposure: 1, costRisk: 1, weightedScore: 0.3, provenance: [] },
      coverage: { byClass: {}, fullyMapped: false },
      riskTier: "high" as const,
    };
    const res = await router.handle(
      req("admin-token", { method: "POST", path: "/agents/acme-support-bot/approve", body: { approval, policyContext: failingContext } }),
    );
    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toBe("Policy gate failed");
  });

  it("allows approval when the policy passes", async () => {
    const { deps } = setup();
    const policies = new PolicyRegistry();
    policies.register(BASELINE_POLICY);
    const router = buildApi({ ...deps, policies });

    await router.handle(req("admin-token", { method: "POST", path: "/agents", body: acmeSupportBot() }));
    await router.handle(req("admin-token", { method: "POST", path: "/agents/acme-support-bot/promote", body: { weightedScore: 0.95 } }));

    const passingContext = {
      card: { groundedAccuracy: 1, safetyPassRate: 1, consistencyScore: 1, hitlCoverage: 1, toolScopeRisk: 0, piiExposure: 0, costRisk: 0, weightedScore: 0.95, provenance: [] },
      coverage: { byClass: {}, fullyMapped: true },
      riskTier: "high" as const,
    };
    const res = await router.handle(
      req("admin-token", { method: "POST", path: "/agents/acme-support-bot/approve", body: { approval, policyContext: passingContext } }),
    );
    expect(res.status).toBe(200);
  });

  it("approves normally when no policy registry is configured", async () => {
    const { router } = setup();
    await router.handle(req("admin-token", { method: "POST", path: "/agents", body: acmeSupportBot() }));
    await router.handle(req("admin-token", { method: "POST", path: "/agents/acme-support-bot/promote", body: {} }));
    const res = await router.handle(
      req("admin-token", { method: "POST", path: "/agents/acme-support-bot/approve", body: { approval } }),
    );
    expect(res.status).toBe(200);
  });
});

describe("OIDC-federated auth (S32)", () => {
  it("authenticates via a valid OIDC token and JIT-provisions the user", async () => {
    const { deps } = setup();
    const oidc = new OidcValidator({
      issuer: "https://sso.acme.test",
      audience: "agentfoundry",
      verify: decodeUnsignedClaims,
      now: () => 1_750_000_000,
    });
    const router = buildApi({ ...deps, oidc });
    const token = encodeUnsignedClaims({
      sub: "fed-user", tenant: "t1", email: "fed@acme.test", roles: ["admin"],
      iss: "https://sso.acme.test", aud: "agentfoundry", exp: 1_750_003_600, iat: 1_749_999_940,
    });
    const res = await router.handle(req(token, { method: "GET", path: "/agents" }));
    expect(res.status).toBe(200);
    // The federated user now exists locally.
    expect(deps.identity.getUser("fed-user").email).toBe("fed@acme.test");
  });

  it("rejects an OIDC token for a non-provisioned tenant", async () => {
    const { deps } = setup();
    const oidc = new OidcValidator({
      issuer: "https://sso.acme.test", audience: "agentfoundry",
      verify: decodeUnsignedClaims, now: () => 1_750_000_000,
    });
    const router = buildApi({ ...deps, oidc });
    const token = encodeUnsignedClaims({
      sub: "u", tenant: "no-such-tenant", email: "u@x.test", roles: ["admin"],
      iss: "https://sso.acme.test", aud: "agentfoundry", exp: 1_750_003_600, iat: 1_749_999_940,
    });
    const res = await router.handle(req(token, { method: "GET", path: "/agents" }));
    expect(res.status).toBe(401);
  });

  it("falls back to the token map when the OIDC token is invalid", async () => {
    const { deps } = setup();
    const oidc = new OidcValidator({
      issuer: "https://sso.acme.test", audience: "agentfoundry",
      verify: () => null, now: () => 1_750_000_000, // always invalid
    });
    const router = buildApi({ ...deps, oidc });
    // admin-token is still in the static map -> fallback path works.
    const res = await router.handle(req("admin-token", { method: "GET", path: "/agents" }));
    expect(res.status).toBe(200);
  });
});

describe("body validation (S35)", () => {
  it("returns 400 with details for a malformed agent body when enabled", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, validateBodies: true });
    const res = await router.handle(req("admin-token", { method: "POST", path: "/agents", body: { id: "" } }));
    expect(res.status).toBe(400);
    expect((res.body as { details: unknown[] }).details.length).toBeGreaterThan(0);
  });

  it("allows a well-formed body when validation is enabled", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, validateBodies: true });
    const res = await router.handle(req("admin-token", { method: "POST", path: "/agents", body: acmeSupportBot() }));
    expect(res.status).toBe(201);
  });

  it("does not validate bodies when the flag is off", async () => {
    const { router } = setup();
    // Malformed body, but validation disabled -> reaches handler -> 400 from handler guard.
    const res = await router.handle(req("admin-token", { method: "POST", path: "/agents", body: { id: "" } }));
    // The handler itself rejects missing design.id with 400 (HttpError), not the middleware.
    expect(res.status).toBe(400);
  });
});

describe("healthz endpoint (S43)", () => {
  it("returns a shallow ok when no aggregator is configured", async () => {
    const { router } = setup();
    const res = await router.handle(req("admin-token", { method: "GET", path: "/healthz" }));
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("ok");
  });

  it("returns the deep report and 200 when healthy", async () => {
    const { deps } = setup();
    const health = new HealthAggregator(() => "2026-06-08T00:00:00.000Z").register(() => ({
      name: "storage", state: "healthy", critical: true,
    }));
    const router = buildApi({ ...deps, health });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/healthz" }));
    expect(res.status).toBe(200);
    expect((res.body as { state: string }).state).toBe("healthy");
  });

  it("returns 503 when a critical component is down", async () => {
    const { deps } = setup();
    const health = new HealthAggregator().register(() => ({
      name: "storage", state: "down", critical: true,
    }));
    const router = buildApi({ ...deps, health });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/healthz" }));
    expect(res.status).toBe(503);
  });
});

describe("status endpoint (S47)", () => {
  const report = {
    state: "healthy" as const,
    summary: "HEALTHY · 1/1 agents deployed",
    health: { state: "healthy" as const, healthyCount: 2, totalComponents: 2 },
    agents: { total: 1, deployed: 1, retired: 0 },
    reviews: { pending: 0 },
    drift: { agentsScanned: 1, regressions: 0 },
    billing: { tenantsBilled: 1, periodTotalMinor: 10000, currency: "USD" },
    flags: [],
    generatedAt: new Date(0).toISOString(),
  };

  it("returns 200 with the report when a provider is configured", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, statusProvider: () => report });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/status" }));
    expect(res.status).toBe(200);
    expect((res.body as { state: string }).state).toBe("healthy");
  });

  it("returns 503 when the platform is down", async () => {
    const { deps } = setup();
    const downReport = { ...report, state: "down" as const, health: { ...report.health, state: "down" as const } };
    const router = buildApi({ ...deps, statusProvider: () => downReport });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/status" }));
    expect(res.status).toBe(503);
  });

  it("returns 404 when no provider is configured", async () => {
    const { router } = setup();
    const res = await router.handle(req("admin-token", { method: "GET", path: "/status" }));
    expect(res.status).toBe(404);
  });
});

describe("audit export endpoint (S53)", () => {
  it("returns the signed bundle for the caller's tenant", async () => {
    const { deps } = setup();
    const router = buildApi({
      ...deps,
      auditExportProvider: (tenantId) => ({ tenantId, signature: "sha256=abc", events: [] }),
    });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/audit/export" }));
    expect(res.status).toBe(200);
    expect((res.body as { tenantId: string }).tenantId).toBe("t1");
  });

  it("returns 404 when no provider is configured", async () => {
    const { router } = setup();
    const res = await router.handle(req("admin-token", { method: "GET", path: "/audit/export" }));
    expect(res.status).toBe(404);
  });

  it("scopes the export to the authenticated tenant", async () => {
    const { deps } = setup();
    let requestedTenant = "";
    const router = buildApi({
      ...deps,
      auditExportProvider: (tenantId) => { requestedTenant = tenantId; return {}; },
    });
    await router.handle(req("admin-token", { method: "GET", path: "/audit/export" }));
    expect(requestedTenant).toBe("t1");
  });
});

describe("dr runbook endpoint (S58)", () => {
  it("returns the runbook when a provider is configured", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, drRunbookProvider: () => ({ readiness: "ready", warnings: [] }) });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/dr/runbook" }));
    expect(res.status).toBe(200);
    expect((res.body as { readiness: string }).readiness).toBe("ready");
  });

  it("returns 404 when no provider is configured", async () => {
    const { router } = setup();
    const res = await router.handle(req("admin-token", { method: "GET", path: "/dr/runbook" }));
    expect(res.status).toBe(404);
  });
});

describe("compliance pack endpoint (S59)", () => {
  it("returns the pack for the caller's tenant", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, compliancePackProvider: (tenantId) => ({ tenantId, sections: ["Governance"] }) });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/compliance/pack" }));
    expect(res.status).toBe(200);
    expect((res.body as { tenantId: string }).tenantId).toBe("t1");
  });

  it("returns 404 when no provider is configured", async () => {
    const { router } = setup();
    const res = await router.handle(req("admin-token", { method: "GET", path: "/compliance/pack" }));
    expect(res.status).toBe(404);
  });

  it("scopes the pack to the authenticated tenant", async () => {
    const { deps } = setup();
    let requested = "";
    const router = buildApi({ ...deps, compliancePackProvider: (t) => { requested = t; return {}; } });
    await router.handle(req("admin-token", { method: "GET", path: "/compliance/pack" }));
    expect(requested).toBe("t1");
  });
});

describe("profile apply endpoint (S64)", () => {
  it("applies the caller's own tenant profile", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, profileApplyHandler: (tenantId) => ({ tenantId, applied: ["quotas", "retention", "sla"] }) });
    const res = await router.handle(req("admin-token", { method: "POST", path: "/profiles/t1/apply", body: {} }));
    expect(res.status).toBe(200);
    expect((res.body as { applied: string[] }).applied).toEqual(["quotas", "retention", "sla"]);
  });

  it("forbids applying another tenant's profile", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, profileApplyHandler: () => ({}) });
    const res = await router.handle(req("admin-token", { method: "POST", path: "/profiles/t2/apply", body: {} }));
    expect(res.status).toBe(403);
  });

  it("returns 404 when no handler is configured", async () => {
    const { router } = setup();
    const res = await router.handle(req("admin-token", { method: "POST", path: "/profiles/t1/apply", body: {} }));
    expect(res.status).toBe(404);
  });
});

describe("profile history endpoint (S67)", () => {
  it("returns the caller's own profile history", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, profileHistoryProvider: (tenantId) => ([{ tenantId, version: 1 }]) });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/profiles/t1/history" }));
    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBe(1);
  });

  it("forbids reading another tenant's history", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, profileHistoryProvider: () => [] });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/profiles/t2/history" }));
    expect(res.status).toBe(403);
  });

  it("returns 404 when no provider is configured", async () => {
    const { router } = setup();
    const res = await router.handle(req("admin-token", { method: "GET", path: "/profiles/t1/history" }));
    expect(res.status).toBe(404);
  });
});

describe("profile export/import endpoints (S71)", () => {
  it("exports the caller's own profile", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, profileExportProvider: (t) => ({ sourceTenantId: t, checksum: "abc" }) });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/profiles/t1/export" }));
    expect(res.status).toBe(200);
    expect((res.body as { sourceTenantId: string }).sourceTenantId).toBe("t1");
  });

  it("forbids exporting another tenant's profile", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, profileExportProvider: () => ({}) });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/profiles/t2/export" }));
    expect(res.status).toBe(403);
  });

  it("returns 404 when export is unconfigured", async () => {
    const { router } = setup();
    const res = await router.handle(req("admin-token", { method: "GET", path: "/profiles/t1/export" }));
    expect(res.status).toBe(404);
  });

  it("imports an envelope into the caller's tenant", async () => {
    const { deps } = setup();
    let receivedTenant = "";
    let receivedBody: unknown = null;
    const router = buildApi({ ...deps, profileImportHandler: (t, env) => { receivedTenant = t; receivedBody = env; return { tenantId: t, version: 1 }; } });
    const res = await router.handle(req("admin-token", { method: "POST", path: "/profiles/t1/import", body: { version: 1 } }));
    expect(res.status).toBe(200);
    expect(receivedTenant).toBe("t1");
    expect(receivedBody).toEqual({ version: 1 });
  });

  it("forbids importing into another tenant", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, profileImportHandler: () => ({}) });
    const res = await router.handle(req("admin-token", { method: "POST", path: "/profiles/t2/import", body: { version: 1 } }));
    expect(res.status).toBe(403);
  });

  it("rejects an import with no body", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, profileImportHandler: () => ({}) });
    const res = await router.handle(req("admin-token", { method: "POST", path: "/profiles/t1/import", body: null }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when import is unconfigured", async () => {
    const { router } = setup();
    const res = await router.handle(req("admin-token", { method: "POST", path: "/profiles/t1/import", body: { version: 1 } }));
    expect(res.status).toBe(404);
  });
});

describe("status history endpoint (S75)", () => {
  it("returns the trend summary when configured", async () => {
    const { deps } = setup();
    const router = buildApi({ ...deps, statusHistoryProvider: () => ({ samples: 3, trend: "improving", current: "healthy" }) });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/status/history" }));
    expect(res.status).toBe(200);
    expect((res.body as { trend: string }).trend).toBe("improving");
  });

  it("returns 404 when unconfigured", async () => {
    const { router } = setup();
    const res = await router.handle(req("admin-token", { method: "GET", path: "/status/history" }));
    expect(res.status).toBe(404);
  });
});

describe("compliance history endpoint (S76)", () => {
  it("returns the tenant's compliance history when configured", async () => {
    const { deps } = setup();
    let requested = "";
    const router = buildApi({ ...deps, complianceHistoryProvider: (t) => { requested = t; return { snapshots: 3 }; } });
    const res = await router.handle(req("admin-token", { method: "GET", path: "/compliance/history" }));
    expect(res.status).toBe(200);
    expect(requested).toBe("t1");
    expect((res.body as { snapshots: number }).snapshots).toBe(3);
  });

  it("returns 404 when unconfigured", async () => {
    const { router } = setup();
    const res = await router.handle(req("admin-token", { method: "GET", path: "/compliance/history" }));
    expect(res.status).toBe(404);
  });
});

describe("reviews endpoint", () => {
  it("lists pending reviews for the tenant", async () => {
    await ctx.router.handle(req("admin-token", { method: "POST", path: "/agents", body: acmeSupportBot() }));
    await ctx.router.handle(req("admin-token", { method: "POST", path: "/agents/acme-support-bot/promote", body: { weightedScore: 0.9 } }));
    const res = await ctx.router.handle(req("admin-token", { method: "GET", path: "/reviews" }));
    expect((res.body as unknown[]).length).toBe(1);
  });
});
