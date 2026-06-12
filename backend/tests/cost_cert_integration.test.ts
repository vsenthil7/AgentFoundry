import { describe, it, expect } from "vitest";
import {
  acmeSupportBot,
  acmeGroundedModelTable,
  StubModel,
  DeterministicCaseGenerator,
  runEvalSuite,
  runBattle,
  buildCoverageMatrix,
  computeScoreCard,
  computeRunCost,
  enforceBudget,
  certify,
  type CostModel,
  type Budget,
} from "../src/index.js";

// S9 integration: a scored agent earns a certification tier and stays within
// its budget — the cost + trust signals layered on the Golden Thread.

describe("Cost governance + certification integration", () => {
  const model = new StubModel(acmeGroundedModelTable(), { fallback: "I don't know." });
  const design = acmeSupportBot();
  const cases = new DeterministicCaseGenerator().generate(design);

  function scoreIt() {
    const evalRun = runEvalSuite(design, cases, model, { useGrounding: true });
    const attacks = runBattle(design, model, { designId: design.id });
    return computeScoreCard({
      design,
      evalRun,
      attacks,
      repeatedPassRates: [evalRun.passRate, evalRun.passRate],
    });
  }

  it("a well-built grounded+guarded agent earns at least silver", () => {
    const card = scoreIt();
    const cert = certify({
      card,
      coverage: buildCoverageMatrix(),
      costEfficient: true,
    });
    expect(["silver", "gold"]).toContain(cert.tier);
    expect(cert.badges.find((b) => b.id === "human_gated")?.earned).toBe(true);
    expect(cert.badges.find((b) => b.id === "fully_mapped_redteam")?.earned).toBe(true);
  });

  it("a run stays within budget and the cost feeds certification", () => {
    const costModel: CostModel = { pricePer1kTokens: 2, pricePerToolCall: 0.5 };
    const budget: Budget = { perRunLimit: 10, totalLimit: 100 };
    const runCost = computeRunCost(1500, 2, costModel); // 3 + 1 = 4
    const verdict = enforceBudget(budget, 0, runCost.total);
    expect(verdict.state).toBe("ok");

    const card = scoreIt();
    const cert = certify({
      card,
      coverage: buildCoverageMatrix(),
      costEfficient: verdict.state === "ok",
    });
    expect(cert.badges.find((b) => b.id === "cost_efficient")?.earned).toBe(true);
  });

  it("an over-budget run revokes the cost-efficient badge", () => {
    const budget: Budget = { perRunLimit: 1, totalLimit: 10 };
    const verdict = enforceBudget(budget, 0, 5); // exceeds per-run limit
    expect(verdict.state).toBe("per_run_exceeded");

    const card = scoreIt();
    const cert = certify({
      card,
      coverage: buildCoverageMatrix(),
      costEfficient: verdict.state === "ok",
    });
    expect(cert.badges.find((b) => b.id === "cost_efficient")?.earned).toBe(false);
  });
});
