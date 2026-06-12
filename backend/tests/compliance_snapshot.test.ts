import { describe, it, expect } from "vitest";
import {
  CompliancePackArchive,
  runCompliancePackSnapshot,
  compliancePackSnapshotJob,
} from "../src/compliance_snapshot.js";
import { CompliancePackGenerator } from "../src/compliance_pack.js";
import { buildAuditExport } from "../src/audit_export.js";
import { DrRunbookGenerator } from "../src/dr_runbook.js";
import { Scheduler } from "../src/scheduler.js";
import type { CompliancePack } from "../src/compliance_pack.js";

const runbook = new DrRunbookGenerator().generate({
  backups: { retained: 1, maxRetained: 7, latestAt: "x" },
  restoreDrill: { lastRun: "x", passed: true, entriesVerified: 1 },
  replication: { primaryUp: true, replicaCount: 1, healthyReplicas: 1, lag: 0 },
});

function makePack(): CompliancePack {
  return new CompliancePackGenerator().generate({
    tenantId: "t1",
    governance: { totalAgents: 1, deployedAgents: 1, certifiedAgents: 1, openIncidents: 0 },
    auditExport: buildAuditExport("secret", { tenantId: "t1", ledgerEntries: [], events: [] }),
    drRunbook: runbook,
    profile: null,
  });
}

describe("CompliancePackArchive", () => {
  it("rejects non-positive retention", () => {
    expect(() => new CompliancePackArchive({ maxSnapshots: 0 })).toThrow();
  });

  it("retains snapshots up to capacity, evicting oldest", () => {
    const archive = new CompliancePackArchive({ maxSnapshots: 2 });
    archive.add(makePack());
    archive.add(makePack());
    archive.add(makePack());
    expect(archive.count()).toBe(2);
  });

  it("returns the latest snapshot", () => {
    const archive = new CompliancePackArchive();
    expect(archive.latest()).toBeNull();
    archive.add(makePack());
    expect(archive.latest()?.tenantId).toBe("t1");
  });

  it("lists snapshots", () => {
    const archive = new CompliancePackArchive();
    archive.add(makePack());
    expect(archive.list()).toHaveLength(1);
  });
});

describe("runCompliancePackSnapshot", () => {
  it("generates and archives a pack", () => {
    const archive = new CompliancePackArchive();
    const pack = runCompliancePackSnapshot({ archive, generate: makePack });
    expect(pack.tenantId).toBe("t1");
    expect(archive.count()).toBe(1);
  });
});

describe("compliancePackSnapshotJob", () => {
  it("runs via the scheduler", async () => {
    const archive = new CompliancePackArchive();
    const job = compliancePackSnapshotJob("compliance-snapshot", 1000, { archive, generate: makePack });
    let t = 0;
    const scheduler = new Scheduler(() => t);
    scheduler.schedule(job);
    t = 1000;
    const runs = await scheduler.tick();
    expect(runs[0].status).toBe("succeeded");
    expect(runs[0].detail).toContain("1 retained");
  });
});
