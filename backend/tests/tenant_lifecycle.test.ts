import { describe, it, expect, beforeEach } from "vitest";
import { TenantLifecycle, OnboardingError, type OnboardingRequest } from "../src/tenant_lifecycle.js";
import { IdentityStore } from "../src/identity.js";
import { QuotaManager } from "../src/ratelimit.js";
import { DataGovernance } from "../src/data_governance.js";

function deps() {
  return {
    identity: new IdentityStore(),
    quotas: new QuotaManager(() => Date.parse("2026-06-08T00:00:00.000Z")),
    governance: new DataGovernance(() => Date.parse("2026-06-08T00:00:00.000Z")),
  };
}

function request(over: Partial<OnboardingRequest> = {}): OnboardingRequest {
  return {
    tenantId: "t1",
    tenantName: "Acme",
    adminId: "admin-1",
    adminEmail: "admin@acme.test",
    quotaLimits: { limits: { agents: 50, deployments: 100 } },
    retention: { retentionDays: { runtime_trace: 30 }, allowedRegions: ["eu", "uk"] },
    ...over,
  };
}

let d: ReturnType<typeof deps>;
let lifecycle: TenantLifecycle;
beforeEach(() => {
  d = deps();
  lifecycle = new TenantLifecycle(d);
});

describe("onboard", () => {
  it("provisions all subsystems in order", () => {
    const result = lifecycle.onboard(request());
    expect(result.provisioned).toEqual(["identity:tenant", "identity:admin", "quotas", "governance"]);
    expect(d.identity.hasTenant("t1")).toBe(true);
    expect(d.identity.getUser("admin-1").roles).toContain("admin");
    expect(d.quotas.status("t1", "agents").limit).toBe(50);
    expect(d.governance.getPolicy("t1").allowedRegions).toEqual(["eu", "uk"]);
  });

  it("rejects a missing tenant id/name", () => {
    expect(() => lifecycle.onboard(request({ tenantId: "" }))).toThrow(OnboardingError);
    expect(() => lifecycle.onboard(request({ tenantName: "" }))).toThrow(OnboardingError);
  });

  it("rejects a missing admin id/email", () => {
    expect(() => lifecycle.onboard(request({ adminId: "" }))).toThrow(OnboardingError);
    expect(() => lifecycle.onboard(request({ adminEmail: "" }))).toThrow(OnboardingError);
  });

  it("rejects a duplicate tenant", () => {
    lifecycle.onboard(request());
    expect(() => lifecycle.onboard(request())).toThrow(/already exists/);
  });

  it("rejects empty residency regions", () => {
    expect(() => lifecycle.onboard(request({ retention: { retentionDays: {}, allowedRegions: [] } }))).toThrow(
      /residency region/,
    );
  });

  it("rolls back the tenant if a later step fails", () => {
    // Force createUser to fail by pre-seeding a duplicate admin id under another
    // tenant is not possible (different tenant). Instead, stub governance.setPolicy
    // to throw and verify the tenant is rolled back.
    const broken = new TenantLifecycle({
      ...d,
      governance: { setPolicy: () => { throw new Error("db down"); } } as never,
    });
    expect(() => broken.onboard(request())).toThrow(/Onboarding failed/);
    // Tenant created then rolled back -> should not exist.
    expect(d.identity.hasTenant("t1")).toBe(false);
  });
  it("rolls back when a later step throws a non-Error value", () => {
    const broken = new TenantLifecycle({
      ...d,
      governance: { setPolicy: () => { throw "string failure"; } } as never,
    });
    expect(() => broken.onboard(request())).toThrow(/string failure/);
    expect(d.identity.hasTenant("t1")).toBe(false);
  });
});

describe("offboard", () => {
  it("removes a tenant and its users", () => {
    lifecycle.onboard(request());
    expect(lifecycle.offboard("t1")).toBe(true);
    expect(d.identity.hasTenant("t1")).toBe(false);
    expect(() => d.identity.getUser("admin-1")).toThrow();
  });

  it("returns false for an unknown tenant", () => {
    expect(lifecycle.offboard("ghost")).toBe(false);
  });

  it("leaves other tenants' users intact when offboarding one", () => {
    lifecycle.onboard(request());
    lifecycle.onboard(request({ tenantId: "t2", tenantName: "Beta", adminId: "admin-2", adminEmail: "admin@beta.test" }));
    lifecycle.offboard("t1");
    // t2's admin must still exist.
    expect(d.identity.getUser("admin-2").tenantId).toBe("t2");
    expect(d.identity.hasTenant("t2")).toBe(true);
  });

  it("allows re-onboarding after offboarding", () => {
    lifecycle.onboard(request());
    lifecycle.offboard("t1");
    expect(() => lifecycle.onboard(request())).not.toThrow();
  });
});
