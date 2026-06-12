import { describe, it, expect } from "vitest";
import { diffCompliancePacks } from "../src/compliance_diff.js";
import { CompliancePackGenerator, type CompliancePackInput } from "../src/compliance_pack.js";
import { buildAuditExport } from "../src/audit_export.js";
import { DrRunbookGenerator } from "../src/dr_runbook.js";
import { TenantProfileStore } from "../src/tenant_profile.js";

function runbook(ready: boolean) {
  return new DrRunbookGenerator().generate({
    backups: { retained: ready ? 1 : 0, maxRetained: 7, latestAt: ready ? "x" : null },
    restoreDrill: { lastRun: "x", passed: ready, entriesVerified: 1 },
    replication: { primaryUp: true, replicaCount: 1, healthyReplicas: 1, lag: 0 },
  });
}

function profileV(n: number) {
  const store = new TenantProfileStore();
  let p = store.set("t1", { policyId: "baseline", quotaLimits: { limits: {} }, retention: { retentionDays: {}, allowedRegions: ["eu"] }, slaTarget: 0.99 });
  for (let i = 1; i < n; i++) {
    p = store.set("t1", { policyId: "high-risk", quotaLimits: { limits: {} }, retention: { retentionDays: {}, allowedRegions: ["eu"] }, slaTarget: 0.99 });
  }
  return p;
}

function pack(over: Partial<CompliancePackInput> = {}, at = "2026-06-09T00:00:00.000Z") {
  return new CompliancePackGenerator(() => at).generate({
    tenantId: "t1",
    governance: { totalAgents: 5, deployedAgents: 3, certifiedAgents: 2, openIncidents: 0 },
    auditExport: buildAuditExport("secret", { tenantId: "t1", ledgerEntries: [], events: [] }),
    drRunbook: runbook(true),
    profile: profileV(1),
    ...over,
  });
}

describe("diffCompliancePacks", () => {
  it("reports no changes for identical posture", () => {
    const diff = diffCompliancePacks(pack(), pack(undefined, "2026-06-10T00:00:00.000Z"));
    expect(diff.hasChanges).toBe(false);
    expect(diff.fromGeneratedAt).toBe("2026-06-09T00:00:00.000Z");
    expect(diff.toGeneratedAt).toBe("2026-06-10T00:00:00.000Z");
  });

  it("detects a DR readiness change", () => {
    const diff = diffCompliancePacks(pack({ drRunbook: runbook(true) }), pack({ drRunbook: runbook(false) }));
    expect(diff.changes.some((c) => c.field === "drReadiness")).toBe(true);
  });

  it("detects deployed-agent count changes", () => {
    const diff = diffCompliancePacks(pack(), pack({ governance: { totalAgents: 5, deployedAgents: 4, certifiedAgents: 2, openIncidents: 0 } }));
    expect(diff.changes.some((c) => c.field === "deployedAgents")).toBe(true);
  });

  it("detects certified-agent changes", () => {
    const diff = diffCompliancePacks(pack(), pack({ governance: { totalAgents: 5, deployedAgents: 3, certifiedAgents: 4, openIncidents: 0 } }));
    expect(diff.changes.some((c) => c.field === "certifiedAgents")).toBe(true);
  });

  it("detects open-incident changes", () => {
    const diff = diffCompliancePacks(pack(), pack({ governance: { totalAgents: 5, deployedAgents: 3, certifiedAgents: 2, openIncidents: 3 } }));
    expect(diff.changes.some((c) => c.field === "openIncidents")).toBe(true);
  });

  it("detects audit-record volume changes", () => {
    const more = buildAuditExport("secret", {
      tenantId: "t1", ledgerEntries: [],
      events: [{ id: "e", type: "agent.deployed", tenantId: "t1", subject: "a", payload: {}, timestamp: new Date(0).toISOString() }],
    });
    const diff = diffCompliancePacks(pack(), pack({ auditExport: more }));
    expect(diff.changes.some((c) => c.field === "auditRecordCount")).toBe(true);
  });

  it("detects a profile version change", () => {
    const diff = diffCompliancePacks(pack({ profile: profileV(1) }), pack({ profile: profileV(2) }));
    expect(diff.changes.some((c) => c.field === "profileVersion")).toBe(true);
  });

  it("handles a null profile on one side", () => {
    const diff = diffCompliancePacks(pack({ profile: null }), pack({ profile: profileV(1) }));
    expect(diff.changes.some((c) => c.field === "profileVersion")).toBe(true);
  });

  it("handles a null profile on the after side", () => {
    const diff = diffCompliancePacks(pack({ profile: profileV(1) }), pack({ profile: null }));
    expect(diff.changes.some((c) => c.field === "profileVersion")).toBe(true);
  });

  it("treats two null profiles as no profile change", () => {
    const diff = diffCompliancePacks(pack({ profile: null }), pack({ profile: null }));
    expect(diff.changes.some((c) => c.field === "profileVersion")).toBe(false);
  });
});
