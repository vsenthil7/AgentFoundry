import { describe, it, expect } from "vitest";
import {
  PROMOTION_THRESHOLD,
  WEIGHTS,
  computeScoreCard,
  meetsPromotionThreshold,
  shouldQuarantine,
} from "../src/scoring.js";
import { acmeSupportBot } from "../src/seed.js";
import type { EvalRunResult } from "../src/eval.js";
import type { AttackResult } from "../src/redteam.js";

function perfectAttacks(): AttackResult[] {
  return [
    { attackId: "a", class: "prompt_injection", passed: true, output: "", mapping: {}, flaked: false },
    { attackId: "b", class: "pii_exfiltration", passed: true, output: "", mapping: {}, flaked: false },
  ];
}

describe("tamper test — score is computed, not theatrical", () => {
  it("computes the mathematically-correct weighted score from KNOWN inputs", () => {
    const design = acmeSupportBot();
    // KNOWN deterministic inputs:
    const evalRun: EvalRunResult = {
      results: [],
      groundedAccuracy: 1, // known
      passRate: 1,
    };
    const attacks = perfectAttacks(); // 2/2 defended -> safetyPassRate = 1
    const card = computeScoreCard({
      design,
      evalRun,
      attacks,
      repeatedPassRates: [1, 1], // consistency = 1
      piiExposed: false, // exposure = 0
      costRisk: 0, // cost risk = 0
    });

    // toolScopeRisk: design has a "send" permission -> risk = 1 -> (1-1)=0
    // Hand-compute the expected weighted score:
    const expected =
      WEIGHTS.groundedAccuracy * 1 +
      WEIGHTS.safetyPassRate * 1 +
      WEIGHTS.consistencyScore * 1 +
      WEIGHTS.hitlCoverage * 1 +
      WEIGHTS.toolScopeRisk * (1 - 1) +
      WEIGHTS.piiExposure * (1 - 0) +
      WEIGHTS.costRisk * (1 - 0);

    expect(card.weightedScore).toBeCloseTo(expected, 6);
    expect(card.toolScopeRisk).toBe(1);
  });

  it("a degraded KNOWN input produces a strictly lower KNOWN score", () => {
    const design = acmeSupportBot();
    const good = computeScoreCard({
      design,
      evalRun: { results: [], groundedAccuracy: 1, passRate: 1 },
      attacks: perfectAttacks(),
      repeatedPassRates: [1, 1],
    });
    const bad = computeScoreCard({
      design,
      evalRun: { results: [], groundedAccuracy: 0.2, passRate: 0.2 },
      attacks: [
        { attackId: "a", class: "prompt_injection", passed: false, output: "", mapping: {}, flaked: false },
        ...perfectAttacks(),
      ],
      repeatedPassRates: [1, 0.5],
    });
    expect(bad.weightedScore).toBeLessThan(good.weightedScore);
  });
});

describe("promotion threshold", () => {
  it("passes when weighted score meets threshold", () => {
    const design = acmeSupportBot();
    const card = computeScoreCard({
      design,
      evalRun: { results: [], groundedAccuracy: 1, passRate: 1 },
      attacks: perfectAttacks(),
      repeatedPassRates: [1, 1],
    });
    expect(card.weightedScore).toBeGreaterThanOrEqual(PROMOTION_THRESHOLD);
    expect(meetsPromotionThreshold(card)).toBe(true);
  });

  it("fails when safety collapses", () => {
    const design = acmeSupportBot();
    const card = computeScoreCard({
      design,
      evalRun: { results: [], groundedAccuracy: 0, passRate: 0 },
      attacks: [
        { attackId: "a", class: "prompt_injection", passed: false, output: "", mapping: {}, flaked: false },
        { attackId: "b", class: "pii_exfiltration", passed: false, output: "", mapping: {}, flaked: false },
      ],
      repeatedPassRates: [0, 1],
      piiExposed: true,
    });
    expect(meetsPromotionThreshold(card)).toBe(false);
  });
});

describe("provenance", () => {
  it("attaches a formula and inputs to every metric", () => {
    const design = acmeSupportBot();
    const card = computeScoreCard({
      design,
      evalRun: { results: [], groundedAccuracy: 1, passRate: 1 },
      attacks: perfectAttacks(),
    });
    for (const p of card.provenance) {
      expect(p.formula.length).toBeGreaterThan(0);
      expect(p.metric.length).toBeGreaterThan(0);
    }
  });
});

describe("flake quarantine", () => {
  it("quarantines a case that flips more than the flake threshold", () => {
    // 3 true, 2 false out of 5 -> flake rate 2/5 = 0.4 > 0.2
    expect(shouldQuarantine([true, false, true, false, true])).toBe(true);
  });
  it("does not quarantine a stable case", () => {
    expect(shouldQuarantine([true, true, true, true, true])).toBe(false);
  });
  it("handles empty outcomes", () => {
    expect(shouldQuarantine([])).toBe(false);
  });
});
