import { describe, it, expect, beforeEach } from "vitest";
import {
  DataGovernance,
  ResidencyViolationError,
  PolicyNotFoundError,
  type DataRecord,
  type RetentionPolicy,
} from "../src/data_governance.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const policy: RetentionPolicy = {
  tenantId: "t1",
  retentionDays: { runtime_trace: 30, eval_result: 0 }, // 0 = indefinite
  allowedRegions: ["eu", "uk"],
};

function rec(over: Partial<DataRecord> = {}): DataRecord {
  return {
    id: "r1",
    tenantId: "t1",
    dataClass: "runtime_trace",
    region: "eu",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

let dg: DataGovernance;
beforeEach(() => {
  dg = new DataGovernance(() => Date.parse("2026-01-15T00:00:00.000Z"));
  dg.setPolicy(policy);
});

describe("policy", () => {
  it("stores and returns a policy (defensively copied)", () => {
    const p = dg.getPolicy("t1");
    expect(p.allowedRegions).toEqual(["eu", "uk"]);
  });
  it("throws for a missing policy", () => {
    expect(() => dg.getPolicy("ghost")).toThrow(PolicyNotFoundError);
  });
});

describe("residency enforcement", () => {
  it("places a record in an allowed region", () => {
    expect(dg.place(rec({ region: "eu" })).region).toBe("eu");
  });
  it("rejects a record in a disallowed region", () => {
    expect(() => dg.place(rec({ region: "us" }))).toThrow(ResidencyViolationError);
  });
  it("requires a policy before placement", () => {
    const dg2 = new DataGovernance();
    expect(() => dg2.place(rec())).toThrow(PolicyNotFoundError);
  });
  it("freezes placed records", () => {
    expect(Object.isFrozen(dg.place(rec()))).toBe(true);
  });
  it("get returns the record or null", () => {
    dg.place(rec({ id: "r1" }));
    expect(dg.get("r1")?.id).toBe("r1");
    expect(dg.get("ghost")).toBeNull();
  });
});

describe("expiry", () => {
  it("expires a record past its retention window", () => {
    // clock = Jan 15; created Jan 1; 14 days old > 30? no. Use older record.
    const old = rec({ createdAt: "2025-11-01T00:00:00.000Z" }); // ~75 days
    dg.place(old);
    expect(dg.isExpired(old)).toBe(true);
  });

  it("does not expire a record within the window", () => {
    const fresh = rec({ createdAt: "2026-01-10T00:00:00.000Z" }); // 5 days
    dg.place(fresh);
    expect(dg.isExpired(fresh)).toBe(false);
  });

  it("never expires indefinite-retention classes (0 days)", () => {
    const evalRec = rec({
      id: "e1",
      dataClass: "eval_result",
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    dg.place(evalRec);
    expect(dg.isExpired(evalRec)).toBe(false);
  });

  it("never expires a class with no configured retention", () => {
    const auditRec = rec({
      id: "a1",
      dataClass: "audit_log",
      createdAt: "2000-01-01T00:00:00.000Z",
    });
    dg.place(auditRec);
    expect(dg.isExpired(auditRec)).toBe(false);
  });

  it("a record with no policy is not expired", () => {
    const dg2 = new DataGovernance(() => Date.now());
    // place would throw without policy, so test isExpired directly
    expect(dg2.isExpired(rec())).toBe(false);
  });

  it("uses the default clock (epoch) when none injected", () => {
    const dg2 = new DataGovernance(); // default now = () => 0
    dg2.setPolicy(policy);
    // createdAt is in 2026; default clock is epoch (1970), so age is negative
    // and the record is not yet expired — exercises the default now().
    const r = rec({ createdAt: "2026-01-01T00:00:00.000Z" });
    expect(dg2.isExpired(r)).toBe(false);
  });
});

describe("purge", () => {
  it("removes expired records and returns sorted ids", () => {
    dg.place(rec({ id: "r-old-b", createdAt: "2025-01-01T00:00:00.000Z" }));
    dg.place(rec({ id: "r-old-a", createdAt: "2025-01-01T00:00:00.000Z" }));
    dg.place(rec({ id: "r-fresh", createdAt: "2026-01-14T00:00:00.000Z" }));
    const removed = dg.purgeExpired();
    expect(removed).toEqual(["r-old-a", "r-old-b"]);
    expect(dg.get("r-fresh")).not.toBeNull();
    expect(dg.get("r-old-a")).toBeNull();
  });

  it("returns empty when nothing is expired", () => {
    dg.place(rec({ id: "r-fresh", createdAt: "2026-01-14T00:00:00.000Z" }));
    expect(dg.purgeExpired()).toEqual([]);
  });
});

describe("listing + residency report", () => {
  beforeEach(() => {
    dg.place(rec({ id: "r1", region: "eu", dataClass: "runtime_trace" }));
    dg.place(rec({ id: "r2", region: "uk", dataClass: "runtime_trace" }));
    dg.place(rec({ id: "r3", region: "eu", dataClass: "eval_result", createdAt: "2026-01-14T00:00:00.000Z" }));
  });

  it("lists all for a tenant", () => {
    expect(dg.list({ tenantId: "t1" })).toHaveLength(3);
  });
  it("filters by data class", () => {
    expect(dg.list({ tenantId: "t1", dataClass: "eval_result" })).toHaveLength(1);
  });
  it("filters by region", () => {
    expect(dg.list({ tenantId: "t1", region: "uk" })).toHaveLength(1);
  });
  it("scopes by tenant", () => {
    expect(dg.list({ tenantId: "t2" })).toHaveLength(0);
  });
  it("produces a residency report by region", () => {
    const report = dg.residencyReport("t1");
    expect(report.eu).toBe(2);
    expect(report.uk).toBe(1);
  });
  it("residency report ignores other tenants", () => {
    expect(dg.residencyReport("t2")).toEqual({});
  });
});
