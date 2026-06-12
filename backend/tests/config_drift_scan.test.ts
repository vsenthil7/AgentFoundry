import { describe, it, expect } from "vitest";
import { runConfigDriftScan, configDriftScanJob, type DriftScanTenant } from "../src/config_drift_scan.js";
import { TenantProfileStore } from "../src/tenant_profile.js";
import { InMemoryChannel } from "../src/notifications.js";
import { Scheduler } from "../src/scheduler.js";
import type { LiveConfigProbe } from "../src/config_drift.js";

function prof(tenantId: string) {
  const store = new TenantProfileStore();
  return store.set(tenantId, {
    policyId: "baseline",
    quotaLimits: { limits: { agents: 10 } },
    retention: { retentionDays: { runtime_trace: 30 }, allowedRegions: ["eu"] },
    slaTarget: 0.99,
  });
}

function syncedProbe(): LiveConfigProbe {
  return {
    quotaLimits: () => ({ limits: { agents: 10 } }),
    retentionDays: () => ({ runtime_trace: 30 }),
    allowedRegions: () => ["eu"],
    slaTarget: () => 0.99,
  };
}

function driftedProbe(): LiveConfigProbe {
  return { ...syncedProbe(), quotaLimits: () => ({ limits: { agents: 999 } }) };
}

describe("runConfigDriftScan", () => {
  it("reports no drift when everything is in sync", () => {
    const channel = new InMemoryChannel();
    const tenant: DriftScanTenant = { tenantId: "t1", profile: prof("t1"), probe: syncedProbe() };
    const result = runConfigDriftScan({ tenants: () => [tenant], channel });
    expect(result.drifted).toBe(0);
    expect(channel.sent).toHaveLength(0);
  });

  it("alerts on drift", () => {
    const channel = new InMemoryChannel();
    const tenant: DriftScanTenant = { tenantId: "t1", profile: prof("t1"), probe: driftedProbe() };
    const result = runConfigDriftScan({ tenants: () => [tenant], channel });
    expect(result.drifted).toBe(1);
    expect(result.remediated).toBe(0);
    expect(channel.for("on-call")).toHaveLength(1);
    expect(channel.for("on-call")[0].subject).toContain("CONFIG DRIFT");
  });

  it("auto-remediates when a remediate function is provided", () => {
    const channel = new InMemoryChannel();
    let remediatedProfile = "";
    const tenant: DriftScanTenant = { tenantId: "t1", profile: prof("t1"), probe: driftedProbe() };
    const result = runConfigDriftScan({
      tenants: () => [tenant], channel,
      remediate: (p) => { remediatedProfile = p.tenantId; return true; },
    });
    expect(result.remediated).toBe(1);
    expect(remediatedProfile).toBe("t1");
    expect(channel.for("on-call")[0].body).toContain("Auto-remediated");
  });

  it("counts a failed remediation as not remediated", () => {
    const channel = new InMemoryChannel();
    const tenant: DriftScanTenant = { tenantId: "t1", profile: prof("t1"), probe: driftedProbe() };
    const result = runConfigDriftScan({ tenants: () => [tenant], channel, remediate: () => false });
    expect(result.remediated).toBe(0);
    expect(channel.for("on-call")[0].body).not.toContain("Auto-remediated");
  });

  it("routes to a custom recipient and uses a custom clock", () => {
    const channel = new InMemoryChannel();
    const tenant: DriftScanTenant = { tenantId: "t1", profile: prof("t1"), probe: driftedProbe() };
    runConfigDriftScan({ tenants: () => [tenant], channel, recipient: "sre", now: () => "2026-06-09T13:00:00.000Z" });
    expect(channel.for("sre")[0].timestamp).toBe("2026-06-09T13:00:00.000Z");
  });

  it("scans multiple tenants in deterministic order", () => {
    const channel = new InMemoryChannel();
    const result = runConfigDriftScan({
      tenants: () => [
        { tenantId: "b", profile: prof("b"), probe: syncedProbe() },
        { tenantId: "a", profile: prof("a"), probe: syncedProbe() },
      ],
      channel,
    });
    expect(result.reports.map((r) => r.tenantId)).toEqual(["a", "b"]);
  });
});

describe("configDriftScanJob", () => {
  it("runs via the scheduler", async () => {
    const channel = new InMemoryChannel();
    const job = configDriftScanJob("config-drift", 1000, {
      tenants: () => [{ tenantId: "t1", profile: prof("t1"), probe: driftedProbe() }],
      channel, remediate: () => true,
    });
    let t = 0;
    const scheduler = new Scheduler(() => t);
    scheduler.schedule(job);
    t = 1000;
    const runs = await scheduler.tick();
    expect(runs[0].detail).toContain("1 drifted, 1 remediated");
  });
});
