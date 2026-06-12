import { describe, it, expect, beforeEach } from "vitest";
import {
  TenantProfileStore,
  validateProfileInput,
  TenantProfileError,
  diffProfiles,
  historyWithDiffs,
  type TenantProfileInput,
} from "../src/tenant_profile.js";

function input(over: Partial<TenantProfileInput> = {}): TenantProfileInput {
  return {
    policyId: "baseline",
    quotaLimits: { limits: { agents: 10 } },
    retention: { retentionDays: { runtime_trace: 30 }, allowedRegions: ["eu"] },
    slaTarget: 0.999,
    ...over,
  };
}

describe("validateProfileInput", () => {
  it("accepts a valid profile", () => {
    expect(() => validateProfileInput(input())).not.toThrow();
  });
  it("rejects a missing policyId", () => {
    expect(() => validateProfileInput(input({ policyId: "" }))).toThrow(TenantProfileError);
  });
  it("rejects an out-of-range SLA target", () => {
    expect(() => validateProfileInput(input({ slaTarget: 0 }))).toThrow(TenantProfileError);
    expect(() => validateProfileInput(input({ slaTarget: 1.1 }))).toThrow(TenantProfileError);
  });
  it("rejects empty allowed regions", () => {
    expect(() => validateProfileInput(input({ retention: { retentionDays: {}, allowedRegions: [] } }))).toThrow(TenantProfileError);
  });
});

describe("TenantProfileStore", () => {
  let store: TenantProfileStore;
  beforeEach(() => (store = new TenantProfileStore()));

  it("creates v1 then increments versions", () => {
    expect(store.set("t1", input()).version).toBe(1);
    expect(store.set("t1", input({ slaTarget: 0.99 })).version).toBe(2);
  });

  it("returns the current (latest) profile", () => {
    store.set("t1", input());
    store.set("t1", input({ policyId: "high-risk" }));
    expect(store.current("t1")?.policyId).toBe("high-risk");
    expect(store.current("t1")?.version).toBe(2);
  });

  it("returns null current for an unknown tenant", () => {
    expect(store.current("ghost")).toBeNull();
  });

  it("fetches a specific version", () => {
    store.set("t1", input({ policyId: "baseline" }));
    store.set("t1", input({ policyId: "high-risk" }));
    expect(store.getVersion("t1", 1)?.policyId).toBe("baseline");
    expect(store.getVersion("t1", 99)).toBeNull();
    expect(store.getVersion("ghost", 1)).toBeNull();
  });

  it("lists all versions", () => {
    store.set("t1", input());
    store.set("t1", input());
    expect(store.versions("t1")).toHaveLength(2);
    expect(store.versions("ghost")).toEqual([]);
  });

  it("freezes profiles and deep-copies config", () => {
    const limits = { limits: { agents: 5 } };
    const p = store.set("t1", input({ quotaLimits: limits }));
    expect(Object.isFrozen(p)).toBe(true);
    limits.limits.agents = 999; // mutate caller's object
    expect(store.current("t1")?.quotaLimits.limits.agents).toBe(5); // unaffected
  });

  it("rolls back to a prior version as a new version", () => {
    store.set("t1", input({ policyId: "baseline", slaTarget: 0.99 })); // v1
    store.set("t1", input({ policyId: "high-risk", slaTarget: 0.999 })); // v2
    const rolled = store.rollback("t1", 1);
    expect(rolled.version).toBe(3);
    expect(rolled.policyId).toBe("baseline");
    expect(rolled.slaTarget).toBe(0.99);
  });

  it("rejects rollback to an unknown version", () => {
    store.set("t1", input());
    expect(() => store.rollback("t1", 99)).toThrow(TenantProfileError);
  });

  it("uses an injected clock", () => {
    const s = new TenantProfileStore(() => "2026-06-09T12:00:00.000Z");
    expect(s.set("t1", input()).updatedAt).toBe("2026-06-09T12:00:00.000Z");
  });
});

describe("diffProfiles", () => {
  let store: TenantProfileStore;
  beforeEach(() => (store = new TenantProfileStore()));

  it("reports no changes for identical config", () => {
    const v1 = store.set("t1", input());
    const v2 = store.set("t1", input());
    const diff = diffProfiles(v1, v2);
    expect(diff.hasChanges).toBe(false);
    expect(diff.fromVersion).toBe(1);
    expect(diff.toVersion).toBe(2);
  });

  it("detects a policy change", () => {
    const v1 = store.set("t1", input({ policyId: "baseline" }));
    const v2 = store.set("t1", input({ policyId: "high-risk" }));
    const diff = diffProfiles(v1, v2);
    expect(diff.changes.some((c) => c.field === "policyId")).toBe(true);
  });

  it("detects an SLA target change", () => {
    const v1 = store.set("t1", input({ slaTarget: 0.99 }));
    const v2 = store.set("t1", input({ slaTarget: 0.999 }));
    expect(diffProfiles(v1, v2).changes.some((c) => c.field === "slaTarget")).toBe(true);
  });

  it("detects a quota change", () => {
    const v1 = store.set("t1", input({ quotaLimits: { limits: { agents: 10 } } }));
    const v2 = store.set("t1", input({ quotaLimits: { limits: { agents: 20 } } }));
    expect(diffProfiles(v1, v2).changes.some((c) => c.field === "quotaLimits")).toBe(true);
  });

  it("detects a retention-days change", () => {
    const v1 = store.set("t1", input({ retention: { retentionDays: { runtime_trace: 30 }, allowedRegions: ["eu"] } }));
    const v2 = store.set("t1", input({ retention: { retentionDays: { runtime_trace: 90 }, allowedRegions: ["eu"] } }));
    expect(diffProfiles(v1, v2).changes.some((c) => c.field === "retention.retentionDays")).toBe(true);
  });

  it("detects an allowed-regions change (order-insensitive)", () => {
    const v1 = store.set("t1", input({ retention: { retentionDays: {}, allowedRegions: ["eu"] } }));
    const v2 = store.set("t1", input({ retention: { retentionDays: {}, allowedRegions: ["eu", "uk"] } }));
    expect(diffProfiles(v1, v2).changes.some((c) => c.field === "retention.allowedRegions")).toBe(true);
  });

  it("treats reordered regions as no change", () => {
    const v1 = store.set("t1", input({ retention: { retentionDays: {}, allowedRegions: ["eu", "uk"] } }));
    const v2 = store.set("t1", input({ retention: { retentionDays: {}, allowedRegions: ["uk", "eu"] } }));
    expect(diffProfiles(v1, v2).changes.some((c) => c.field === "retention.allowedRegions")).toBe(false);
  });
});

describe("historyWithDiffs", () => {
  let store: TenantProfileStore;
  beforeEach(() => (store = new TenantProfileStore()));

  it("returns an empty list for no versions", () => {
    expect(historyWithDiffs(store.versions("t1"))).toEqual([]);
  });

  it("annotates the first version with a null diff", () => {
    store.set("t1", input());
    const history = historyWithDiffs(store.versions("t1"));
    expect(history).toHaveLength(1);
    expect(history[0].diffFromPrevious).toBeNull();
  });

  it("diffs each version against the previous", () => {
    store.set("t1", input({ policyId: "baseline" }));
    store.set("t1", input({ policyId: "high-risk" }));
    const history = historyWithDiffs(store.versions("t1"));
    expect(history[1].diffFromPrevious?.hasChanges).toBe(true);
    expect(history[1].diffFromPrevious?.changes.some((c) => c.field === "policyId")).toBe(true);
  });
});
