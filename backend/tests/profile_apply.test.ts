import { describe, it, expect } from "vitest";
import { applyProfile, ProfileApplyError } from "../src/profile_apply.js";
import { QuotaManager } from "../src/ratelimit.js";
import { DataGovernance } from "../src/data_governance.js";
import { SlaTracker } from "../src/sla.js";
import { TenantProfileStore } from "../src/tenant_profile.js";

function profile() {
  const store = new TenantProfileStore();
  return store.set("t1", {
    policyId: "high-risk",
    quotaLimits: { limits: { agents: 10, deployments: 5 } },
    retention: { retentionDays: { runtime_trace: 30 }, allowedRegions: ["eu", "uk"] },
    slaTarget: 0.999,
  });
}

function deps() {
  return {
    quotas: new QuotaManager(() => Date.parse("2026-06-09T00:00:00.000Z")),
    governance: new DataGovernance(() => Date.parse("2026-06-09T00:00:00.000Z")),
    sla: new SlaTracker(),
  };
}

describe("applyProfile", () => {
  it("applies all subsystems in order", () => {
    const result = applyProfile(profile(), deps());
    expect(result.applied).toEqual(["quotas", "retention", "sla"]);
    expect(result.version).toBe(1);
  });

  it("makes quota limits effective", () => {
    const d = deps();
    applyProfile(profile(), d);
    // agents limit is 10 -> 11th record throws.
    for (let i = 0; i < 10; i++) d.quotas.record("t1", "agents");
    expect(() => d.quotas.record("t1", "agents")).toThrow();
  });

  it("makes residency policy effective", () => {
    const d = deps();
    applyProfile(profile(), d);
    // 'us' not allowed -> placement throws.
    expect(() =>
      d.governance.place({ id: "r1", tenantId: "t1", dataClass: "runtime_trace", region: "us", createdAt: "2026-06-09T00:00:00.000Z" }),
    ).toThrow();
    // 'eu' allowed -> succeeds.
    expect(d.governance.place({ id: "r2", tenantId: "t1", dataClass: "runtime_trace", region: "eu", createdAt: "2026-06-09T00:00:00.000Z" }).region).toBe("eu");
  });

  it("makes the SLA target effective", () => {
    const d = deps();
    applyProfile(profile(), d);
    expect(d.sla.report("t1", 0, 1000).target).toBe(0.999);
  });

  it("reports partial apply on failure", () => {
    const d = deps();
    // Make SLA setTarget throw by stubbing it.
    d.sla.setTarget = () => { throw new Error("sla subsystem down"); };
    try {
      applyProfile(profile(), d);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProfileApplyError);
      expect((err as Error).message).toContain("quotas, retention");
      expect((err as Error).message).toContain("sla subsystem down");
    }
  });

  it("handles a non-Error throw", () => {
    const d = deps();
    d.quotas.setLimits = () => { throw "string failure"; };
    expect(() => applyProfile(profile(), d)).toThrow(ProfileApplyError);
  });
});
