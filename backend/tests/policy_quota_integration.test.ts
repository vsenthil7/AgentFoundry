import { describe, it, expect } from "vitest";
import {
  acmeSupportBot,
  acmeGroundedModelTable,
  StubModel,
  DeterministicCaseGenerator,
  runEvalSuite,
  runBattle,
  computeScoreCard,
  buildCoverageMatrix,
  evaluatePolicy,
  PolicyRegistry,
  BASELINE_POLICY,
  HIGH_RISK_POLICY,
  QuotaManager,
  QuotaExceededError,
  RateLimiter,
} from "../src/index.js";

// S23/S24 integration: policy-as-code decides promotion (replacing the hardcoded
// threshold), and quotas + rate limits gate platform usage per tenant.

describe("Policy-as-code drives promotion", () => {
  function scoreAcme() {
    const design = acmeSupportBot();
    const model = new StubModel(acmeGroundedModelTable(), { fallback: "I don't know." });
    const cases = new DeterministicCaseGenerator().generate(design);
    const evalRun = runEvalSuite(design, cases, model, { useGrounding: true });
    const attacks = runBattle(design, model, { designId: design.id });
    return computeScoreCard({
      design,
      evalRun,
      attacks,
      repeatedPassRates: [evalRun.passRate, evalRun.passRate],
    });
  }

  it("the well-built Acme bot passes the high-risk policy", () => {
    const reg = new PolicyRegistry();
    reg.register(BASELINE_POLICY);
    reg.register(HIGH_RISK_POLICY);
    const policy = reg.selectForTier("high")!;
    const e = evaluatePolicy(policy, {
      card: scoreAcme(),
      coverage: buildCoverageMatrix(),
      riskTier: "high",
    });
    expect(e.passed).toBe(true);
  });

  it("a custom stricter policy can block what the baseline allows", () => {
    const strict = {
      id: "strict",
      version: "1.0.0",
      appliesToTiers: [],
      rules: [
        { id: "perfect-score", metric: "weightedScore" as const, operator: "gte" as const, threshold: 0.99, description: "≥0.99", severity: "hard" as const },
      ],
    };
    const e = evaluatePolicy(strict, {
      card: scoreAcme(), // ~0.92
      coverage: buildCoverageMatrix(),
      riskTier: "high",
    });
    expect(e.passed).toBe(false);
  });
});

describe("Quotas + rate limits gate platform usage", () => {
  it("a tenant cannot exceed its agent quota", () => {
    const q = new QuotaManager(() => Date.parse("2026-06-08T00:00:00.000Z"));
    q.setLimits("t1", { limits: { agents: 2 } });
    q.record("t1", "agents");
    q.record("t1", "agents");
    expect(() => q.record("t1", "agents")).toThrow(QuotaExceededError);
  });

  it("rate limiting throttles burst API traffic per tenant", () => {
    let t = 0;
    const rl = new RateLimiter({ capacity: 2, refillPerSecond: 1 }, () => t);
    expect(rl.consume("tenant:t1").allowed).toBe(true);
    expect(rl.consume("tenant:t1").allowed).toBe(true);
    expect(rl.consume("tenant:t1").allowed).toBe(false); // throttled
    t = 1000;
    expect(rl.consume("tenant:t1").allowed).toBe(true); // refilled
  });
});
