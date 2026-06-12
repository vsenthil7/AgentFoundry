import { describe, it, expect } from "vitest";
import { detectConfigDrift, type LiveConfigProbe } from "../src/config_drift.js";
import { TenantProfileStore } from "../src/tenant_profile.js";

function profile() {
  const store = new TenantProfileStore();
  return store.set("t1", {
    policyId: "high-risk",
    quotaLimits: { limits: { agents: 10 } },
    retention: { retentionDays: { runtime_trace: 30 }, allowedRegions: ["eu", "uk"] },
    slaTarget: 0.999,
  });
}

// A probe that mirrors the profile exactly (in sync).
function syncedProbe(): LiveConfigProbe {
  return {
    quotaLimits: () => ({ limits: { agents: 10 } }),
    retentionDays: () => ({ runtime_trace: 30 }),
    allowedRegions: () => ["uk", "eu"], // different order, same set
    slaTarget: () => 0.999,
  };
}

describe("detectConfigDrift", () => {
  it("reports in sync when live state matches the profile", () => {
    const report = detectConfigDrift(profile(), syncedProbe());
    expect(report.inSync).toBe(true);
    expect(report.findings).toHaveLength(0);
    expect(report.profileVersion).toBe(1);
  });

  it("detects a quota drift", () => {
    const probe = { ...syncedProbe(), quotaLimits: () => ({ limits: { agents: 999 } }) };
    const report = detectConfigDrift(profile(), probe);
    expect(report.inSync).toBe(false);
    expect(report.findings.some((f) => f.field === "quotaLimits")).toBe(true);
  });

  it("detects a retention-days drift", () => {
    const probe = { ...syncedProbe(), retentionDays: () => ({ runtime_trace: 7 }) };
    expect(detectConfigDrift(profile(), probe).findings.some((f) => f.field === "retention.retentionDays")).toBe(true);
  });

  it("detects an allowed-regions drift", () => {
    const probe = { ...syncedProbe(), allowedRegions: () => ["eu"] as const };
    expect(detectConfigDrift(profile(), probe).findings.some((f) => f.field === "retention.allowedRegions")).toBe(true);
  });

  it("detects an SLA target drift", () => {
    const probe = { ...syncedProbe(), slaTarget: () => 0.95 };
    expect(detectConfigDrift(profile(), probe).findings.some((f) => f.field === "slaTarget")).toBe(true);
  });

  it("treats missing live state as drift", () => {
    const probe: LiveConfigProbe = {
      quotaLimits: () => null,
      retentionDays: () => null,
      allowedRegions: () => null,
      slaTarget: () => null,
    };
    const report = detectConfigDrift(profile(), probe);
    expect(report.findings).toHaveLength(4);
  });
});
