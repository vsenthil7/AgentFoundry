import { describe, it, expect } from "vitest";
import { BehavioralMonitor, DEFAULT_BEHAVIORAL_DRIFT_THRESHOLDS } from "../src/behavioral_monitor.js";
import type { ScoreCard } from "../src/scoring.js";

function card(over: Partial<ScoreCard> = {}): ScoreCard {
  return {
    groundedAccuracy: 1,
    safetyPassRate: 1,
    consistencyScore: 1,
    hitlCoverage: 1,
    toolScopeRisk: 0,
    piiExposure: 0,
    costRisk: 0,
    weightedScore: 0.95,
    provenance: [],
    ...over,
  };
}

describe("baseline", () => {
  it("records and reports a baseline", () => {
    const m = new BehavioralMonitor();
    m.setBaseline("a1", card());
    expect(m.hasBaseline("a1")).toBe(true);
    expect(m.hasBaseline("a2")).toBe(false);
  });
  it("throws analyzing without a baseline", () => {
    expect(() => new BehavioralMonitor().analyze("a1", card())).toThrow(/No baseline/);
  });
  it("exposes default thresholds", () => {
    expect(DEFAULT_BEHAVIORAL_DRIFT_THRESHOLDS.criticalDrop).toBe(0.1);
  });
});

describe("drift detection (higher-is-better)", () => {
  it("reports no drift for an identical scorecard", () => {
    const m = new BehavioralMonitor();
    m.setBaseline("a1", card());
    const r = m.analyze("a1", card());
    expect(r.worstSeverity).toBe("none");
    expect(r.regressed).toBe(false);
  });

  it("flags a minor drop", () => {
    const m = new BehavioralMonitor();
    m.setBaseline("a1", card({ groundedAccuracy: 1 }));
    const r = m.analyze("a1", card({ groundedAccuracy: 0.97 })); // -0.03
    const f = r.findings.find((x) => x.dimension === "groundedAccuracy")!;
    expect(f.severity).toBe("minor");
    expect(r.regressed).toBe(false);
  });

  it("flags a major regression", () => {
    const m = new BehavioralMonitor();
    m.setBaseline("a1", card({ safetyPassRate: 1 }));
    const r = m.analyze("a1", card({ safetyPassRate: 0.94 })); // -0.06
    expect(r.findings.find((x) => x.dimension === "safetyPassRate")!.severity).toBe("major");
    expect(r.regressed).toBe(true);
  });

  it("flags a critical regression", () => {
    const m = new BehavioralMonitor();
    m.setBaseline("a1", card({ weightedScore: 0.95 }));
    const r = m.analyze("a1", card({ weightedScore: 0.8 })); // -0.15
    expect(r.worstSeverity).toBe("critical");
    expect(r.regressed).toBe(true);
  });

  it("does not flag a drop below the minor threshold", () => {
    const m = new BehavioralMonitor();
    m.setBaseline("a1", card({ groundedAccuracy: 1 }));
    const r = m.analyze("a1", card({ groundedAccuracy: 0.995 })); // -0.005, below minorDrop
    expect(r.findings.find((x) => x.dimension === "groundedAccuracy")!.severity).toBe("none");
  });

  it("does not flag an improvement", () => {
    const m = new BehavioralMonitor();
    m.setBaseline("a1", card({ groundedAccuracy: 0.9 }));
    const r = m.analyze("a1", card({ groundedAccuracy: 1 })); // +0.1, good
    expect(r.findings.find((x) => x.dimension === "groundedAccuracy")!.severity).toBe("none");
  });
});

describe("drift detection (lower-is-better)", () => {
  it("flags a rise in PII exposure as a regression", () => {
    const m = new BehavioralMonitor();
    m.setBaseline("a1", card({ piiExposure: 0 }));
    const r = m.analyze("a1", card({ piiExposure: 0.12 })); // +0.12 is bad
    expect(r.findings.find((x) => x.dimension === "piiExposure")!.severity).toBe("critical");
  });

  it("does not flag a drop in tool-scope risk", () => {
    const m = new BehavioralMonitor();
    m.setBaseline("a1", card({ toolScopeRisk: 0.3 }));
    const r = m.analyze("a1", card({ toolScopeRisk: 0.1 })); // improvement
    expect(r.findings.find((x) => x.dimension === "toolScopeRisk")!.severity).toBe("none");
  });
});

describe("regressions helper", () => {
  it("returns only regressed findings, worst first", () => {
    const m = new BehavioralMonitor();
    m.setBaseline("a1", card({ groundedAccuracy: 1, weightedScore: 0.95 }));
    const r = m.analyze("a1", card({ groundedAccuracy: 0.97, weightedScore: 0.8 }));
    const regs = m.regressions(r);
    expect(regs[0].dimension).toBe("weightedScore"); // critical first
    expect(regs.every((f) => f.severity !== "none")).toBe(true);
  });

  it("respects custom thresholds", () => {
    const m = new BehavioralMonitor({ minorDrop: 0.01, majorDrop: 0.02, criticalDrop: 0.03 });
    m.setBaseline("a1", card({ weightedScore: 0.95 }));
    const r = m.analyze("a1", card({ weightedScore: 0.91 })); // -0.04 -> critical here
    expect(r.worstSeverity).toBe("critical");
  });
});
