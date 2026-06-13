import { describe, it, expect, beforeEach } from "vitest";
import { seedLiveData } from "../src/demo_seed.js";
import { ApiAuditLog } from "../src/api_audit.js";
import { CircuitBreakerManager } from "../src/circuit_breaker.js";
import { AuthService } from "../src/auth.js";
import { IdentityStore } from "../src/identity.js";

let audit: ApiAuditLog;
let breakers: CircuitBreakerManager;

beforeEach(() => {
  audit = new ApiAuditLog(() => 1_700_000_000_000);
  breakers = new CircuitBreakerManager(() => 1_700_000_000_000);
});

describe("seedLiveData (S85)", () => {
  it("populates the audit trail with a believable history", () => {
    const r = seedLiveData({ audit, breakers });
    expect(r.auditCalls).toBe(8);
    expect(audit.size()).toBe(8);
    // Includes a failed login and an RBAC denial so error paths are visible.
    expect(audit.query({ minStatus: 400 }).length).toBe(2);
  });

  it("trips a breaker on the flaky agent and leaves the healthy one closed", () => {
    const r = seedLiveData({ audit, breakers });
    expect(r.trippedAgents).toContain("experimental-router");
    expect(r.trippedAgents).not.toContain("acme-support-bot");
    expect(breakers.state("acme-support-bot")).toBe("closed");
    expect(breakers.state("experimental-router")).toBe("open");
  });

  it("registers a demo admin when an AuthService is provided", () => {
    const auth = new AuthService(new IdentityStore());
    const r = seedLiveData({ audit, breakers, auth });
    expect(r.demoAdminEmail).toBe("owner@acme.test");
    expect(auth.isRegistered("owner@acme.test")).toBe(true);
  });

  it("does not re-register an existing demo admin", () => {
    const auth = new AuthService(new IdentityStore());
    auth.register({ tenantId: "acme", tenantName: "Acme", email: "owner@acme.test", password: "already-here-1" });
    const r = seedLiveData({ audit, breakers, auth });
    expect(r.demoAdminEmail).toBeNull(); // skipped — already registered
  });

  it("works without an AuthService (audit + breakers only)", () => {
    const r = seedLiveData({ audit, breakers });
    expect(r.demoAdminEmail).toBeNull();
    expect(r.auditCalls).toBe(8);
  });

  it("scopes seeded audit calls to a custom tenant", () => {
    seedLiveData({ audit, breakers, tenantId: "globex" });
    expect(audit.query({ tenantId: "globex" }).length).toBe(8);
    expect(audit.query({ tenantId: "acme" }).length).toBe(0);
  });
});
