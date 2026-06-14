import { describe, it, expect } from "vitest";
import { AuthClient, AuthApiError } from "../src/auth/authClient.js";

// A fake fetch that returns canned responses keyed by path.
function fakeFetch(
  routes: Record<string, { status: number; body: unknown }>,
): (input: string, init?: RequestInit) => Promise<Response> {
  return async (input: string) => {
    const path = input.replace(/^https?:\/\/[^/]+/, "").replace(/^[^/]*/, (m) => (m.startsWith("/") ? m : ""));
    const key = Object.keys(routes).find((k) => input.endsWith(k)) ?? input;
    const r = routes[key];
    if (!r) return new Response("", { status: 404 });
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  };
}

const session = {
  token: "abc",
  expiresAt: 1,
  user: { id: "acme:u", email: "u@acme.com", tenantId: "acme", roles: ["admin"] },
};

describe("AuthClient (S78)", () => {
  it("register returns the session on 201", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/register": { status: 201, body: session } }));
    const s = await c.register({ tenantId: "acme", tenantName: "Acme", email: "u@acme.com", password: "password1" });
    expect(s.token).toBe("abc");
    expect(s.user.roles).toEqual(["admin"]);
  });

  it("login returns the session on 200", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/login": { status: 200, body: session } }));
    const s = await c.login({ email: "u@acme.com", password: "password1" });
    expect(s.user.email).toBe("u@acme.com");
  });

  it("throws AuthApiError carrying the server error message and status", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/login": { status: 401, body: { error: "Invalid email or password." } } }));
    await expect(c.login({ email: "u@acme.com", password: "x" })).rejects.toMatchObject({
      name: "AuthApiError",
      status: 401,
      message: "Invalid email or password.",
    });
  });

  it("throws a generic AuthApiError when the error body has no message", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/login": { status: 500, body: {} } }));
    await expect(c.login({ email: "u@acme.com", password: "x" })).rejects.toBeInstanceOf(AuthApiError);
  });

  it("me returns the current user", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/me": { status: 200, body: session.user } }));
    const u = await c.me("abc");
    expect(u.email).toBe("u@acme.com");
  });

  it("listUsers returns tenant users", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users": { status: 200, body: { users: [session.user] } } }));
    const r = await c.listUsers("abc");
    expect(r.users.length).toBe(1);
  });

  it("logout posts to the logout endpoint without throwing", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/logout": { status: 200, body: { revoked: true } } }));
    await expect(c.logout("abc")).resolves.toBeUndefined();
  });

  it("handles an empty response body (no JSON)", async () => {
    const emptyFetch = async () => new Response("", { status: 200 });
    const c = new AuthClient("", emptyFetch);
    await expect(c.logout("abc")).resolves.toBeUndefined();
  });

  it("getAuditTrail returns the audit summary + calls", async () => {
    const trail = { summary: { total: 1, errors: 0, errorRate: 0, lastSeq: 1 }, calls: [] };
    const c = new AuthClient("", fakeFetch({ "/audit/api": { status: 200, body: trail } }));
    const r = await c.getAuditTrail("abc");
    expect(r.summary.total).toBe(1);
  });

  it("getBreakers returns tripped agents + transitions", async () => {
    const view = { tripped: ["a"], transitions: [] };
    const c = new AuthClient("", fakeFetch({ "/breakers": { status: 200, body: view } }));
    const r = await c.getBreakers("abc");
    expect(r.tripped).toEqual(["a"]);
  });

  it("resetBreaker posts to the agent reset endpoint", async () => {
    const c = new AuthClient("", fakeFetch({ "/reset": { status: 200, body: { to: "closed" } } }));
    await expect(c.resetBreaker("abc", "agent-x")).resolves.toBeTruthy();
  });

  it("getRuns returns recorded invocations", async () => {
    const c = new AuthClient("", fakeFetch({ "/runs": { status: 200, body: { runs: [{ seq: 1 }] } } }));
    const r = await c.getRuns("abc");
    expect(r.runs.length).toBe(1);
  });

  it("replayRun posts to the run replay endpoint", async () => {
    const c = new AuthClient("", fakeFetch({ "/replay": { status: 200, body: { seq: 2, reproduced: true } } }));
    const r = await c.replayRun("abc", 2);
    expect(r.reproduced).toBe(true);
  });

  it("uses the global fetch by default when no fetchImpl is injected", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(session), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      const c = new AuthClient(); // default baseUrl + default fetchImpl
      const s = await c.login({ email: "u@acme.com", password: "password1" });
      expect(s.token).toBe("abc");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("updateProfile PATCHes the profile and returns the updated user (S96)", async () => {
    const updated = { ...session.user, displayName: "Owner One", email: "new@acme.com" };
    const c = new AuthClient("", fakeFetch({ "/auth/profile": { status: 200, body: updated } }));
    const u = await c.updateProfile("abc", { displayName: "Owner One", email: "new@acme.com" });
    expect(u.displayName).toBe("Owner One");
    expect(u.email).toBe("new@acme.com");
  });

  it("changePassword POSTs and returns the change result (S96)", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/password": { status: 200, body: { changed: true, otherSessionsRevoked: 2 } } }));
    const r = await c.changePassword("abc", "old12345", "new12345");
    expect(r.changed).toBe(true);
    expect(r.otherSessionsRevoked).toBe(2);
  });

  // ---- S97: tenant-admin user management ----
  const adminUser = { id: "acme:u", email: "u@acme.com", tenantId: "acme", roles: ["viewer"], active: true };

  it("listAdminUsers returns users with the active flag (S97)", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users": { status: 200, body: { users: [adminUser] } } }));
    const r = await c.listAdminUsers("abc");
    expect(r.users[0].active).toBe(true);
  });

  it("adminCreateUser POSTs and returns the created user (S97)", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users": { status: 201, body: adminUser } }));
    const u = await c.adminCreateUser("abc", { email: "u@acme.com", password: "temp12345", roles: ["viewer"] });
    expect(u.email).toBe("u@acme.com");
  });

  it("setUserRoles PATCHes the role set (S97)", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users/acme%3Au/roles": { status: 200, body: { ...adminUser, roles: ["composer"] } } }));
    const u = await c.setUserRoles("abc", "acme:u", ["composer"]);
    expect(u.roles).toEqual(["composer"]);
  });

  it("deactivateUser POSTs and returns the user (S97)", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users/acme%3Au/deactivate": { status: 200, body: { ...adminUser, active: false } } }));
    const u = await c.deactivateUser("abc", "acme:u");
    expect(u.active).toBe(false);
  });

  it("reactivateUser POSTs and returns the user (S97)", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users/acme%3Au/reactivate": { status: 200, body: adminUser } }));
    const u = await c.reactivateUser("abc", "acme:u");
    expect(u.active).toBe(true);
  });

  it("resetUserPassword POSTs and returns reset:true (S97)", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users/acme%3Au/reset-password": { status: 200, body: { reset: true } } }));
    const r = await c.resetUserPassword("abc", "acme:u", "temp12345");
    expect(r.reset).toBe(true);
  });

  // ---- S98: superadmin platform console ----
  const platTenant = { id: "acme", name: "Acme", status: "active", userCount: 3 };

  it("listTenants returns tenants with status + counts (S98)", async () => {
    const c = new AuthClient("", fakeFetch({ "/platform/tenants": { status: 200, body: { tenants: [platTenant] } } }));
    const r = await c.listTenants("abc");
    expect(r.tenants[0].status).toBe("active");
    expect(r.tenants[0].userCount).toBe(3);
  });

  it("listTenantUsers returns a tenant's users (S98)", async () => {
    const c = new AuthClient("", fakeFetch({ "/platform/tenants/acme/users": { status: 200, body: { users: [adminUser] } } }));
    const r = await c.listTenantUsers("abc", "acme");
    expect(r.users[0].email).toBe("u@acme.com");
  });

  it("provisionTenant POSTs and returns tenant + admin (S98)", async () => {
    const c = new AuthClient("", fakeFetch({ "/platform/tenants": { status: 201, body: { tenant: platTenant, admin: adminUser } } }));
    const r = await c.provisionTenant("abc", { tenantId: "acme", tenantName: "Acme", adminEmail: "u@acme.com", adminPassword: "password1" });
    expect(r.tenant.id).toBe("acme");
    expect(r.admin.email).toBe("u@acme.com");
  });

  it("suspendTenant POSTs and returns the tenant (S98)", async () => {
    const c = new AuthClient("", fakeFetch({ "/platform/tenants/acme/suspend": { status: 200, body: { ...platTenant, status: "suspended" } } }));
    const t = await c.suspendTenant("abc", "acme");
    expect(t.status).toBe("suspended");
  });

  it("activateTenant POSTs and returns the tenant (S98)", async () => {
    const c = new AuthClient("", fakeFetch({ "/platform/tenants/acme/activate": { status: 200, body: platTenant } }));
    const t = await c.activateTenant("abc", "acme");
    expect(t.status).toBe("active");
  });

  // ---- S99: reviewer queue ----
  const review = { id: "rev-1", agentId: "support-bot", tenantId: "acme", requestedBy: "c@acme.com", weightedScore: 0.86, status: "pending", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

  it("listReviews returns the pending queue (S99)", async () => {
    const c = new AuthClient("", fakeFetch({ "/reviews": { status: 200, body: [review] } }));
    const r = await c.listReviews("abc");
    expect(r[0].agentId).toBe("support-bot");
  });

  it("getReview returns a single item (S99)", async () => {
    const c = new AuthClient("", fakeFetch({ "/reviews/rev-1": { status: 200, body: review } }));
    const r = await c.getReview("abc", "rev-1");
    expect(r.id).toBe("rev-1");
  });

  it("approveReview POSTs and returns the resolved item (S99)", async () => {
    const c = new AuthClient("", fakeFetch({ "/reviews/rev-1/approve": { status: 200, body: { ...review, status: "approved" } } }));
    const r = await c.approveReview("abc", "rev-1");
    expect(r.status).toBe("approved");
  });

  it("rejectReview POSTs the reason and returns the resolved item (S99)", async () => {
    const c = new AuthClient("", fakeFetch({ "/reviews/rev-1/reject": { status: 200, body: { ...review, status: "rejected" } } }));
    const r = await c.rejectReview("abc", "rev-1", "too risky");
    expect(r.status).toBe("rejected");
  });

  it("getStatus returns the consolidated platform report (S102)", async () => {
    const report = { state: "healthy", summary: "ok", health: { state: "healthy", healthyCount: 4, totalComponents: 4 }, agents: { total: 3, deployed: 2, retired: 0 }, reviews: { pending: 1 }, drift: { agentsScanned: 3, regressions: 0 }, billing: { tenantsBilled: 1, periodTotalMinor: 1250, currency: "USD" }, flags: [], generatedAt: "2026-01-01T00:00:00.000Z" };
    const c = new AuthClient("", fakeFetch({ "/status": { status: 200, body: report } }));
    const r = await c.getStatus("abc");
    expect(r.state).toBe("healthy");
    expect(r.agents.deployed).toBe(2);
  });

  it("listSecrets returns masked secrets (S106)", async () => {
    const c = new AuthClient("", fakeFetch({ "/secrets": { status: 200, body: { secrets: [{ id: "k", tenantId: "acme", name: "Key", masked: "sk\u2026WXYZ", createdAt: "2026-01-01T00:00:00.000Z" }] } } }));
    const r = await c.listSecrets("abc");
    expect(r.secrets[0].masked).toBe("sk\u2026WXYZ");
  });

  it("listConnectors returns connector defs (S106)", async () => {
    const c = new AuthClient("", fakeFetch({ "/connectors": { status: 200, body: { connectors: [{ id: "oai", tenantId: "acme", kind: "openapi", name: "OpenAI", endpoint: "https://api.openai.com", secretId: "k" }] } } }));
    const r = await c.listConnectors("abc");
    expect(r.connectors[0].kind).toBe("openapi");
    expect(r.connectors[0].secretId).toBe("k");
  });

  it("getCurrentInvoice returns the current-period invoice (S107)", async () => {
    const inv = { tenantId: "acme", period: "2026-06", currency: "USD", lineItems: [{ resource: "agents", quantity: 3, unitPrice: 100, amount: 300 }], subtotal: 300, total: 300 };
    const c = new AuthClient("", fakeFetch({ "/billing/current": { status: 200, body: inv } }));
    const r = await c.getCurrentInvoice("abc");
    expect(r.total).toBe(300);
    expect(r.lineItems[0].resource).toBe("agents");
  });

  it("getInvoiceHistory returns invoices + summary + period-over-period (S107)", async () => {
    const hist = { invoices: [{ tenantId: "acme", period: "2025-12", currency: "USD", lineItems: [], subtotal: 8000, total: 8000 }], summary: { tenantId: "acme", invoiceCount: 1, lifetimeTotal: 8000, currency: "USD", periods: ["2025-12"] }, periodOverPeriod: { delta: 3000, pct: 60 } };
    const c = new AuthClient("", fakeFetch({ "/billing/history": { status: 200, body: hist } }));
    const r = await c.getInvoiceHistory("abc");
    expect(r.summary.lifetimeTotal).toBe(8000);
    expect(r.periodOverPeriod!.delta).toBe(3000);
  });

  it("getSlaReport returns per-agent uptime reports (S110)", async () => {
    const rep = { agents: [{ agentId: "bot", windowMs: 1000, upMs: 990, downMs: 10, uptime: 0.99, target: 0.999, breached: true, errorBudgetMsRemaining: -9 }] };
    const c = new AuthClient("", fakeFetch({ "/sla": { status: 200, body: rep } }));
    const r = await c.getSlaReport("abc");
    expect(r.agents[0].agentId).toBe("bot");
    expect(r.agents[0].breached).toBe(true);
    expect(r.agents[0].errorBudgetMsRemaining).toBe(-9);
  });

  it("getCompliancePack returns the pack with markdown + governance (S111)", async () => {
    const pack = { tenantId: "acme", generatedAt: "2026-06-01T00:00:00.000Z", sections: ["Governance"], governance: { totalAgents: 5, deployedAgents: 3, certifiedAgents: 2, openIncidents: 1 }, markdown: "# Compliance Pack" };
    const c = new AuthClient("", fakeFetch({ "/compliance/pack": { status: 200, body: pack } }));
    const r = await c.getCompliancePack("abc");
    expect(r.governance.deployedAgents).toBe(3);
    expect(r.markdown).toContain("Compliance Pack");
  });

  it("getComplianceHistory returns snapshots + latest diff (S111)", async () => {
    const hist = { snapshots: [{ generatedAt: "2026-06-01T00:00:00.000Z", sections: ["Governance"] }], latestDiff: { readinessChanged: false, deployedAgentsDelta: 1, certifiedAgentsDelta: 0, openIncidentsDelta: 0, auditRecordDelta: 2, profileVersionChanged: false } };
    const c = new AuthClient("", fakeFetch({ "/compliance/history": { status: 200, body: hist } }));
    const r = await c.getComplianceHistory("abc");
    expect(r.snapshots).toHaveLength(1);
    expect(r.latestDiff!.deployedAgentsDelta).toBe(1);
  });

  it("getAuditExport returns the signed bundle (S111)", async () => {
    const bundle = { version: 1, exportedAt: "2026-06-01T00:00:00.000Z", tenantId: "acme", ledgerEntries: [{}, {}], events: [{ type: "agent.deployed" }], signature: "sha256=abc" };
    const c = new AuthClient("", fakeFetch({ "/audit/export": { status: 200, body: bundle } }));
    const r = await c.getAuditExport("abc");
    expect(r.signature).toBe("sha256=abc");
    expect(r.ledgerEntries).toHaveLength(2);
  });

  it("getStatusHistory returns the trend summary (S112)", async () => {
    const sum = { samples: 5, current: "healthy", trend: "improving", healthyFraction: 0.8, degradedFraction: 0.2, downFraction: 0 };
    const c = new AuthClient("", fakeFetch({ "/status/history": { status: 200, body: sum } }));
    const r = await c.getStatusHistory("abc");
    expect(r.trend).toBe("improving");
    expect(r.samples).toBe(5);
    expect(r.healthyFraction).toBe(0.8);
  });

  it("getDataGovernance returns regions + retention + residency (S113)", async () => {
    const view = { allowedRegions: ["eu", "uk"], retentionDays: { audit_log: 365 }, residency: { eu: 2 } };
    const c = new AuthClient("", fakeFetch({ "/governance/data": { status: 200, body: view } }));
    const r = await c.getDataGovernance("abc");
    expect(r.allowedRegions).toEqual(["eu", "uk"]);
    expect(r.retentionDays.audit_log).toBe(365);
    expect(r.residency.eu).toBe(2);
  });

  it("browseMarketplace returns the catalog with install counts (S114)", async () => {
    const cat = { packs: [{ id: "p1", kind: "eval_pack", name: "P1", publisher: "acme", version: "1.0.0", certificationTier: "gold", installs: 7 }] };
    const c = new AuthClient("", fakeFetch({ "/marketplace": { status: 200, body: cat } }));
    const r = await c.browseMarketplace("abc");
    expect(r.packs[0].id).toBe("p1");
    expect(r.packs[0].installs).toBe(7);
    expect(r.packs[0].certificationTier).toBe("gold");
  });

  it("createSecret POSTs id/name/value and returns a masked secret (S115)", async () => {
    const masked = { id: "k", tenantId: "acme", name: "K", masked: "sk…WXYZ", createdAt: "2026-01-01T00:00:00.000Z" };
    const c = new AuthClient("", fakeFetch({ "/secrets": { status: 201, body: masked } }));
    const r = await c.createSecret("abc", { id: "k", name: "K", value: "sk-secret-123" });
    expect(r.id).toBe("k");
    expect(r.masked).toBe("sk…WXYZ");
  });

  it("rotateSecret POSTs the new value to the rotate path (S115)", async () => {
    const masked = { id: "k", tenantId: "acme", name: "K", masked: "ne…ABCD", createdAt: "2026-01-01T00:00:00.000Z" };
    const c = new AuthClient("", fakeFetch({ "/secrets/k/rotate": { status: 200, body: masked } }));
    const r = await c.rotateSecret("abc", "k", "new-value-ABCD");
    expect(r.masked).toBe("ne…ABCD");
  });

  it("deleteSecret DELETEs the secret and returns { deleted } (S115)", async () => {
    const c = new AuthClient("", fakeFetch({ "/secrets/k": { status: 200, body: { deleted: true } } }));
    const r = await c.deleteSecret("abc", "k");
    expect(r.deleted).toBe(true);
  });
});
