import { describe, it, expect } from "vitest";
import { CompliancePackGenerator, type CompliancePackInput } from "../src/compliance_pack.js";
import { buildAuditExport } from "../src/audit_export.js";
import { DrRunbookGenerator } from "../src/dr_runbook.js";
import { TenantProfileStore } from "../src/tenant_profile.js";

const auditExport = buildAuditExport("secret", { tenantId: "t1", ledgerEntries: [], events: [] });
const drRunbook = new DrRunbookGenerator().generate({
  backups: { retained: 3, maxRetained: 7, latestAt: "2026-06-09T11:00:00.000Z" },
  restoreDrill: { lastRun: "2026-06-09T11:30:00.000Z", passed: true, entriesVerified: 5 },
  replication: { primaryUp: true, replicaCount: 2, healthyReplicas: 2, lag: 0 },
});

function profileStore() {
  const s = new TenantProfileStore();
  s.set("t1", {
    policyId: "high-risk",
    quotaLimits: { limits: { agents: 10 } },
    retention: { retentionDays: { runtime_trace: 30 }, allowedRegions: ["eu", "uk"] },
    slaTarget: 0.999,
  });
  return s;
}

function input(over: Partial<CompliancePackInput> = {}): CompliancePackInput {
  return {
    tenantId: "t1",
    governance: { totalAgents: 5, deployedAgents: 3, certifiedAgents: 2, openIncidents: 0 },
    auditExport,
    drRunbook,
    profile: profileStore().current("t1"),
    ...over,
  };
}

const gen = new CompliancePackGenerator();

describe("CompliancePackGenerator", () => {
  it("assembles all four sections", () => {
    const pack = gen.generate(input());
    expect(pack.sections).toEqual(["Governance", "Audit trail", "Configuration profile", "Disaster recovery"]);
  });

  it("renders a governance section with agent counts", () => {
    const pack = gen.generate(input());
    expect(pack.markdown).toContain("3 deployed / 5 total");
    expect(pack.markdown).toContain("Certified agents: 2");
  });

  it("includes the audit signature", () => {
    const pack = gen.generate(input());
    expect(pack.markdown).toContain(auditExport.signature);
  });

  it("renders the config profile when present", () => {
    const pack = gen.generate(input());
    expect(pack.markdown).toContain("Promotion policy: high-risk");
    expect(pack.markdown).toContain("SLA target: 99.90%");
    expect(pack.markdown).toContain("eu, uk");
  });

  it("notes when no profile is on record", () => {
    const pack = gen.generate(input({ profile: null }));
    expect(pack.markdown).toContain("No configuration profile on record");
  });

  it("embeds the DR runbook with readiness", () => {
    const pack = gen.generate(input());
    expect(pack.markdown).toContain("DR readiness: READY");
    expect(pack.markdown).toContain("Full DR runbook");
    expect(pack.markdown).toContain("# Disaster Recovery Runbook");
  });

  it("uses an injected clock", () => {
    const g = new CompliancePackGenerator(() => "2026-06-09T12:00:00.000Z");
    expect(g.generate(input()).generatedAt).toBe("2026-06-09T12:00:00.000Z");
  });

  it("titles the pack with the tenant id", () => {
    expect(gen.generate(input()).markdown).toContain("# Compliance Pack — t1");
  });
});
