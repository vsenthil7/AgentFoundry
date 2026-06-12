import { describe, it, expect } from "vitest";
import { DrRunbookGenerator, type DrPosture } from "../src/dr_runbook.js";

function posture(over: Partial<DrPosture> = {}): DrPosture {
  return {
    backups: { retained: 3, maxRetained: 7, latestAt: "2026-06-09T11:00:00.000Z" },
    restoreDrill: { lastRun: "2026-06-09T11:30:00.000Z", passed: true, entriesVerified: 5 },
    replication: { primaryUp: true, replicaCount: 2, healthyReplicas: 2, lag: 0 },
    ...over,
  };
}

const gen = new DrRunbookGenerator();

describe("assess", () => {
  it("is ready when all posture is healthy", () => {
    const { readiness, warnings } = gen.assess(posture());
    expect(readiness).toBe("ready");
    expect(warnings).toHaveLength(0);
  });

  it("is not_ready with no backups", () => {
    expect(gen.assess(posture({ backups: { retained: 0, maxRetained: 7, latestAt: null } })).readiness).toBe("not_ready");
  });

  it("is not_ready when the last drill failed", () => {
    expect(gen.assess(posture({ restoreDrill: { lastRun: "x", passed: false, entriesVerified: 0 } })).readiness).toBe("not_ready");
  });

  it("is not_ready when the primary is down", () => {
    expect(gen.assess(posture({ replication: { primaryUp: false, replicaCount: 2, healthyReplicas: 1, lag: 0 } })).readiness).toBe("not_ready");
  });

  it("warns when the restore drill was never run", () => {
    const { readiness, warnings } = gen.assess(posture({ restoreDrill: { lastRun: null, passed: null, entriesVerified: 0 } }));
    expect(readiness).toBe("at_risk");
    expect(warnings.some((w) => w.includes("never run"))).toBe(true);
  });

  it("is at_risk with replication lag", () => {
    const { readiness, warnings } = gen.assess(posture({ replication: { primaryUp: true, replicaCount: 2, healthyReplicas: 2, lag: 3 } }));
    expect(readiness).toBe("at_risk");
    expect(warnings.some((w) => w.includes("lag"))).toBe(true);
  });

  it("warns when no healthy replicas remain", () => {
    const { warnings } = gen.assess(posture({ replication: { primaryUp: true, replicaCount: 2, healthyReplicas: 0, lag: 0 } }));
    expect(warnings.some((w) => w.includes("No healthy replicas"))).toBe(true);
  });

  it("does not warn about replicas when there are none configured", () => {
    const { warnings } = gen.assess(posture({ replication: { primaryUp: true, replicaCount: 0, healthyReplicas: 0, lag: 0 } }));
    expect(warnings.some((w) => w.includes("No healthy replicas"))).toBe(false);
  });
});

describe("generate", () => {
  it("produces a markdown runbook with all sections", () => {
    const rb = gen.generate(posture());
    expect(rb.markdown).toContain("# Disaster Recovery Runbook");
    expect(rb.markdown).toContain("## Backup posture");
    expect(rb.markdown).toContain("## Restore verification");
    expect(rb.markdown).toContain("## Replication");
    expect(rb.markdown).toContain("## Recovery procedure");
    expect(rb.readiness).toBe("ready");
  });

  it("includes a warnings section when at risk", () => {
    const rb = gen.generate(posture({ replication: { primaryUp: true, replicaCount: 2, healthyReplicas: 2, lag: 5 } }));
    expect(rb.markdown).toContain("## ⚠ Warnings");
  });

  it("renders drill status text for each state", () => {
    expect(gen.generate(posture({ restoreDrill: { lastRun: null, passed: null, entriesVerified: 0 } })).markdown).toContain("not run");
    expect(gen.generate(posture({ restoreDrill: { lastRun: "x", passed: false, entriesVerified: 0 } })).markdown).toContain("FAILED");
    expect(gen.generate(posture()).markdown).toContain("passed, 5 entries");
  });

  it("shows 'none' when no backup exists", () => {
    const rb = gen.generate(posture({ backups: { retained: 0, maxRetained: 7, latestAt: null } }));
    expect(rb.markdown).toContain("Latest snapshot: none");
  });

  it("marks the primary DOWN in the report", () => {
    const rb = gen.generate(posture({ replication: { primaryUp: false, replicaCount: 1, healthyReplicas: 1, lag: 0 } }));
    expect(rb.markdown).toContain("Primary: DOWN");
  });

  it("uses an injected clock", () => {
    const g = new DrRunbookGenerator(() => "2026-06-09T12:00:00.000Z");
    expect(g.generate(posture()).generatedAt).toBe("2026-06-09T12:00:00.000Z");
  });
});
