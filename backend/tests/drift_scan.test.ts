import { describe, it, expect } from "vitest";
import { runDriftScan, driftScanJob, type DriftScanTarget } from "../src/drift_scan.js";
import { BehavioralMonitor } from "../src/behavioral_monitor.js";
import { InMemoryChannel } from "../src/notifications.js";
import { Scheduler } from "../src/scheduler.js";
import type { ScoreCard } from "../src/scoring.js";

function card(over: Partial<ScoreCard> = {}): ScoreCard {
  return {
    groundedAccuracy: 1, safetyPassRate: 1, consistencyScore: 1, hitlCoverage: 1,
    toolScopeRisk: 0, piiExposure: 0, costRisk: 0, weightedScore: 0.95, provenance: [],
    ...over,
  };
}

function target(agentId: string, observed: ScoreCard): DriftScanTarget {
  return { agentId, tenantId: "t1", rescore: () => observed };
}

describe("runDriftScan", () => {
  it("scans agents with a baseline and reports no regression when stable", () => {
    const monitor = new BehavioralMonitor();
    monitor.setBaseline("a1", card());
    const channel = new InMemoryChannel();
    const result = runDriftScan({ monitor, channel, targets: () => [target("a1", card())] });
    expect(result.scanned).toBe(1);
    expect(result.regressions).toBe(0);
    expect(channel.sent).toHaveLength(0);
  });

  it("notifies on a regression", () => {
    const monitor = new BehavioralMonitor();
    monitor.setBaseline("a1", card());
    const channel = new InMemoryChannel();
    const degraded = card({ groundedAccuracy: 0.4, safetyPassRate: 0.5 });
    const result = runDriftScan({ monitor, channel, targets: () => [target("a1", degraded)] });
    expect(result.regressions).toBe(1);
    expect(channel.for("on-call")).toHaveLength(1);
    expect(channel.for("on-call")[0].subject).toContain("DRIFT");
    // Body names the regressed dimension with baseline/observed values.
    expect(channel.for("on-call")[0].body).toMatch(/baseline 1 -> observed 0\.\d/);
    expect(channel.for("on-call")[0].body).not.toContain("undefined");
  });

  it("skips agents without a baseline", () => {
    const monitor = new BehavioralMonitor();
    const channel = new InMemoryChannel();
    const result = runDriftScan({ monitor, channel, targets: () => [target("never-promoted", card())] });
    expect(result.scanned).toBe(0);
  });

  it("routes notifications to a custom recipient", () => {
    const monitor = new BehavioralMonitor();
    monitor.setBaseline("a1", card());
    const channel = new InMemoryChannel();
    const degraded = card({ safetyPassRate: 0.2 });
    runDriftScan({ monitor, channel, targets: () => [target("a1", degraded)], recipient: "sre" });
    expect(channel.for("sre")).toHaveLength(1);
  });

  it("scans multiple agents in deterministic order", () => {
    const monitor = new BehavioralMonitor();
    monitor.setBaseline("b", card());
    monitor.setBaseline("a", card());
    const channel = new InMemoryChannel();
    const result = runDriftScan({
      monitor, channel,
      targets: () => [target("b", card()), target("a", card())],
    });
    expect(result.reports.map((r) => r.agentId)).toEqual(["a", "b"]);
  });

  it("uses a custom clock for notification timestamps", () => {
    const monitor = new BehavioralMonitor();
    monitor.setBaseline("a1", card());
    const channel = new InMemoryChannel();
    runDriftScan({
      monitor, channel,
      targets: () => [target("a1", card({ groundedAccuracy: 0.3 }))],
      now: () => "2026-06-08T15:00:00.000Z",
    });
    expect(channel.sent[0].timestamp).toBe("2026-06-08T15:00:00.000Z");
  });
});

describe("driftScanJob", () => {
  it("builds a scheduler job that runs the scan", async () => {
    const monitor = new BehavioralMonitor();
    monitor.setBaseline("a1", card());
    const channel = new InMemoryChannel();
    const job = driftScanJob("drift-scan", 1000, {
      monitor, channel, targets: () => [target("a1", card({ safetyPassRate: 0.1 }))],
    });
    let t = 0;
    const scheduler = new Scheduler(() => t);
    scheduler.schedule(job);
    t = 1000;
    const runs = await scheduler.tick();
    expect(runs[0].status).toBe("succeeded");
    expect(runs[0].detail).toContain("1 regression");
  });
});
