import { describe, it, expect, beforeEach } from "vitest";
import {
  TraceStore,
  IncidentLog,
  detectDrift,
  regressionGate,
  DRIFT_THRESHOLDS,
  type RuntimeTrace,
} from "../src/monitoring.js";
import type { AttackResult } from "../src/redteam.js";

function trace(over: Partial<RuntimeTrace> = {}): RuntimeTrace {
  return {
    agentId: "acme-support-bot",
    version: "1.0.0",
    timestamp: "2026-06-08T00:00:00.000Z",
    groundedAccuracy: 1,
    safetyPassRate: 1,
    tokenCost: 100,
    latencyMs: 200,
    ...over,
  };
}

function attack(id: string, passed: boolean): AttackResult {
  return { attackId: id, class: "prompt_injection", passed, output: "", mapping: {}, flaked: false };
}

describe("TraceStore", () => {
  let store: TraceStore;
  beforeEach(() => (store = new TraceStore()));

  it("ingests and counts traces", () => {
    store.ingest(trace());
    store.ingest(trace());
    expect(store.count()).toBe(2);
  });

  it("returns traces for an agent in timestamp order", () => {
    store.ingest(trace({ timestamp: "2026-06-08T02:00:00.000Z" }));
    store.ingest(trace({ timestamp: "2026-06-08T01:00:00.000Z" }));
    const all = store.forAgent("acme-support-bot");
    expect(all[0].timestamp < all[1].timestamp).toBe(true);
  });

  it("filters by agent id", () => {
    store.ingest(trace());
    store.ingest(trace({ agentId: "other" }));
    expect(store.forAgent("acme-support-bot")).toHaveLength(1);
  });

  it("returns latest trace or null", () => {
    expect(store.latest("acme-support-bot")).toBeNull();
    store.ingest(trace({ timestamp: "2026-06-08T01:00:00.000Z" }));
    store.ingest(trace({ timestamp: "2026-06-08T03:00:00.000Z" }));
    expect(store.latest("acme-support-bot")?.timestamp).toBe(
      "2026-06-08T03:00:00.000Z",
    );
  });
});

describe("drift detection", () => {
  it("reports no drift when stable", () => {
    const d = detectDrift(trace(), trace());
    expect(d.drifted).toBe(false);
    expect(d.reasons).toHaveLength(0);
  });

  it("detects grounded-accuracy drop", () => {
    const d = detectDrift(trace(), trace({ groundedAccuracy: 0.8 }));
    expect(d.drifted).toBe(true);
    expect(d.reasons.join()).toContain("grounded-accuracy dropped");
  });

  it("detects safety pass rate drop", () => {
    const d = detectDrift(trace(), trace({ safetyPassRate: 0.9 }));
    expect(d.drifted).toBe(true);
    expect(d.reasons.join()).toContain("safety pass rate dropped");
  });

  it("detects a large cost increase", () => {
    const d = detectDrift(trace(), trace({ tokenCost: 200 }));
    expect(d.drifted).toBe(true);
    expect(d.reasons.join()).toContain("token cost rose");
  });

  it("handles a zero-cost baseline without dividing by zero", () => {
    const d = detectDrift(trace({ tokenCost: 0 }), trace({ tokenCost: 100 }));
    expect(d.costDelta).toBe(0);
  });

  it("a small drop within threshold is not flagged", () => {
    const small = DRIFT_THRESHOLDS.groundedAccuracyDrop / 2;
    const d = detectDrift(trace(), trace({ groundedAccuracy: 1 - small }));
    expect(d.drifted).toBe(false);
  });
});

describe("regression gate", () => {
  it("blocks when a previously-defended attack now leaks", () => {
    const baseline = [attack("a", true), attack("b", true)];
    const current = [attack("a", true), attack("b", false)];
    const r = regressionGate(baseline, current);
    expect(r.regressed).toBe(true);
    expect(r.newlyLeaking).toEqual(["b"]);
  });

  it("does not block when an attack improves", () => {
    const baseline = [attack("a", false)];
    const current = [attack("a", true)];
    const r = regressionGate(baseline, current);
    expect(r.regressed).toBe(false);
    expect(r.newlyDefended).toEqual(["a"]);
  });

  it("ignores brand-new attacks not in the baseline", () => {
    const baseline = [attack("a", true)];
    const current = [attack("a", true), attack("new", false)];
    const r = regressionGate(baseline, current);
    expect(r.regressed).toBe(false);
  });

  it("reports no regression when nothing changed", () => {
    const baseline = [attack("a", true), attack("b", true)];
    const r = regressionGate(baseline, baseline);
    expect(r.regressed).toBe(false);
    expect(r.newlyLeaking).toHaveLength(0);
    expect(r.newlyDefended).toHaveLength(0);
  });
});

describe("incident log", () => {
  it("captures and retrieves incidents per agent", () => {
    const log = new IncidentLog();
    log.capture({
      agentId: "acme-support-bot",
      kind: "regression",
      detail: "attack b regressed",
      timestamp: "2026-06-08T00:00:00.000Z",
    });
    log.capture({
      agentId: "other",
      kind: "drift",
      detail: "ga drop",
      timestamp: "2026-06-08T00:00:00.000Z",
    });
    expect(log.forAgent("acme-support-bot")).toHaveLength(1);
    expect(log.all()).toHaveLength(2);
  });
});
