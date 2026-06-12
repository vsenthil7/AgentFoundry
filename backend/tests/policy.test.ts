import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluatePolicy,
  validatePolicy,
  PolicyRegistry,
  PolicyValidationError,
  BASELINE_POLICY,
  HIGH_RISK_POLICY,
  type Policy,
  type PolicyContext,
} from "../src/policy.js";
import type { ScoreCard } from "../src/scoring.js";
import type { CoverageMatrix } from "../src/redteam.js";

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

const fullyMapped: CoverageMatrix = { byClass: {}, fullyMapped: true };
const notMapped: CoverageMatrix = { byClass: {}, fullyMapped: false };

function ctx(over: Partial<PolicyContext> = {}): PolicyContext {
  return { card: card(), coverage: fullyMapped, riskTier: "high", ...over };
}

describe("validatePolicy", () => {
  it("accepts a valid policy", () => {
    expect(() => validatePolicy(BASELINE_POLICY)).not.toThrow();
  });
  it("rejects a policy with no id/version", () => {
    expect(() => validatePolicy({ id: "", version: "", appliesToTiers: [], rules: [] })).toThrow(
      PolicyValidationError,
    );
  });
  it("rejects a policy with no rules", () => {
    expect(() =>
      validatePolicy({ id: "p", version: "1", appliesToTiers: [], rules: [] }),
    ).toThrow(PolicyValidationError);
  });
  it("rejects duplicate rule ids", () => {
    const p: Policy = {
      id: "p",
      version: "1",
      appliesToTiers: [],
      rules: [
        { id: "r", metric: "weightedScore", operator: "gte", threshold: 0.8, description: "", severity: "hard" },
        { id: "r", metric: "safetyPassRate", operator: "gte", threshold: 0.9, description: "", severity: "hard" },
      ],
    };
    expect(() => validatePolicy(p)).toThrow(PolicyValidationError);
  });
});

describe("evaluatePolicy — baseline", () => {
  it("passes a strong scorecard", () => {
    const e = evaluatePolicy(BASELINE_POLICY, ctx());
    expect(e.passed).toBe(true);
    expect(e.hardFailures).toHaveLength(0);
  });

  it("fails on low weighted score (hard)", () => {
    const e = evaluatePolicy(BASELINE_POLICY, ctx({ card: card({ weightedScore: 0.5 }) }));
    expect(e.passed).toBe(false);
    expect(e.hardFailures.map((r) => r.ruleId)).toContain("min-weighted");
  });

  it("fails on PII exposure (hard)", () => {
    const e = evaluatePolicy(BASELINE_POLICY, ctx({ card: card({ piiExposure: 1 }) }));
    expect(e.passed).toBe(false);
    expect(e.hardFailures.map((r) => r.ruleId)).toContain("no-pii");
  });

  it("records a soft failure without blocking", () => {
    const e = evaluatePolicy(BASELINE_POLICY, ctx({ coverage: notMapped }));
    expect(e.passed).toBe(true); // coverage rule is soft
    expect(e.softFailures.map((r) => r.ruleId)).toContain("coverage");
  });
});

describe("evaluatePolicy — operators", () => {
  function oneRule(operator: Policy["rules"][0]["operator"], threshold: number, metricVal: number) {
    const p: Policy = {
      id: "p",
      version: "1",
      appliesToTiers: [],
      rules: [{ id: "r", metric: "weightedScore", operator, threshold, description: "", severity: "hard" }],
    };
    return evaluatePolicy(p, ctx({ card: card({ weightedScore: metricVal }) })).results[0].passed;
  }

  it("gte", () => { expect(oneRule("gte", 0.8, 0.8)).toBe(true); expect(oneRule("gte", 0.8, 0.7)).toBe(false); });
  it("gt", () => { expect(oneRule("gt", 0.8, 0.81)).toBe(true); expect(oneRule("gt", 0.8, 0.8)).toBe(false); });
  it("lte", () => { expect(oneRule("lte", 0.8, 0.8)).toBe(true); expect(oneRule("lte", 0.8, 0.9)).toBe(false); });
  it("lt", () => { expect(oneRule("lt", 0.8, 0.7)).toBe(true); expect(oneRule("lt", 0.8, 0.8)).toBe(false); });
  it("eq", () => { expect(oneRule("eq", 0.5, 0.5)).toBe(true); expect(oneRule("eq", 0.5, 0.6)).toBe(false); });
  it("neq", () => { expect(oneRule("neq", 0.5, 0.6)).toBe(true); expect(oneRule("neq", 0.5, 0.5)).toBe(false); });
});

describe("evaluatePolicy — all metrics readable", () => {
  it("reads every metric path", () => {
    const metrics: Policy["rules"][0]["metric"][] = [
      "weightedScore", "groundedAccuracy", "safetyPassRate", "consistencyScore",
      "hitlCoverage", "toolScopeRisk", "piiExposure", "costRisk", "coverageFullyMapped",
    ];
    const p: Policy = {
      id: "p", version: "1", appliesToTiers: [],
      rules: metrics.map((m) => ({ id: m, metric: m, operator: "gte" as const, threshold: 0, description: "", severity: "soft" as const })),
    };
    const e = evaluatePolicy(p, ctx());
    expect(e.results).toHaveLength(metrics.length);
  });
});

describe("PolicyRegistry", () => {
  let reg: PolicyRegistry;
  beforeEach(() => (reg = new PolicyRegistry()));

  it("registers and gets a policy", () => {
    reg.register(BASELINE_POLICY);
    expect(reg.get("baseline")?.id).toBe("baseline");
    expect(reg.get("ghost")).toBeNull();
  });

  it("validates on register", () => {
    expect(() => reg.register({ id: "x", version: "1", appliesToTiers: [], rules: [] })).toThrow(
      PolicyValidationError,
    );
  });

  it("selects a tier-scoped policy over an unscoped one", () => {
    reg.register(BASELINE_POLICY);
    reg.register(HIGH_RISK_POLICY);
    expect(reg.selectForTier("high")?.id).toBe("high-risk");
    expect(reg.selectForTier("low")?.id).toBe("baseline");
  });

  it("returns null when no policy matches", () => {
    expect(reg.selectForTier("low")).toBeNull();
  });

  it("high-risk policy enforces grounding + HITL", () => {
    reg.register(HIGH_RISK_POLICY);
    const policy = reg.selectForTier("critical")!;
    const e = evaluatePolicy(policy, ctx({ card: card({ groundedAccuracy: 0.5 }), riskTier: "critical" }));
    expect(e.passed).toBe(false);
    expect(e.hardFailures.map((r) => r.ruleId)).toContain("min-grounding");
  });
});
