import { describe, it, expect } from "vitest";
import {
  acmeSupportBot,
  acmeGroundedModelTable,
  StubModel,
  DeterministicCaseGenerator,
  exportManifest,
  runEvalSuite,
  runBattle,
  computeScoreCard,
  certify,
  buildCoverageMatrix,
  Marketplace,
  type AgentTemplatePack,
} from "../src/index.js";

// §F interoperability: a published pack is consumed and runs END-TO-END,
// producing the same scores as the original — proving the pack is the real
// artifact, not a cosmetic listing.

describe("Marketplace interoperability — real end-to-end pack", () => {
  it("publish -> consume -> run consumed manifest reproduces the score", () => {
    const design = acmeSupportBot();
    const cases = new DeterministicCaseGenerator().generate(design);
    const model = new StubModel(acmeGroundedModelTable(), { fallback: "I don't know." });

    // Score the original to derive a certification tier for the pack.
    const evalRun = runEvalSuite(design, cases, model, { useGrounding: true });
    const attacks = runBattle(design, model, { designId: design.id });
    const card = computeScoreCard({
      design,
      evalRun,
      attacks,
      repeatedPassRates: [evalRun.passRate, evalRun.passRate],
    });
    const cert = certify({ card, coverage: buildCoverageMatrix(), costEfficient: true });

    // Publish as an agent-template pack carrying its earned tier.
    const mp = new Marketplace();
    const pack: AgentTemplatePack = {
      id: "pack-acme",
      kind: "agent_template",
      name: "Acme Support Template",
      publisher: "acme",
      version: "1.0.0",
      certificationTier: cert.tier,
      publishedAt: new Date(0).toISOString(),
      manifest: exportManifest(design, cases),
    };
    mp.publish(pack);

    // A different consumer pulls the pack and runs it from the manifest alone.
    const consumed = mp.consume("pack-acme");
    expect(consumed.kind).toBe("agent_template");
    if (consumed.kind !== "agent_template") throw new Error("wrong kind");

    const consumerModel = new StubModel(acmeGroundedModelTable(), {
      fallback: "I don't know.",
    });
    const consumedEval = runEvalSuite(
      consumed.manifest.agent,
      [...consumed.manifest.evalSuite],
      consumerModel,
      { useGrounding: true },
    );
    const consumedAttacks = runBattle(
      consumed.manifest.agent,
      consumerModel,
      { designId: consumed.manifest.agent.id },
      [...consumed.manifest.redTeamSuite],
    );
    const consumedCard = computeScoreCard({
      design: consumed.manifest.agent,
      evalRun: consumedEval,
      attacks: consumedAttacks,
      repeatedPassRates: [consumedEval.passRate, consumedEval.passRate],
    });

    // The consumed pack reproduces the original's score exactly.
    expect(consumedCard.weightedScore).toBe(card.weightedScore);
    expect(consumedCard.groundedAccuracy).toBe(card.groundedAccuracy);
    expect(mp.installCount("pack-acme")).toBe(1);
  });

  it("a high-tier-only catalog hides an unproven pack", () => {
    const mp = new Marketplace();
    const cases = new DeterministicCaseGenerator().generate(acmeSupportBot());
    mp.publish({
      id: "pack-unproven",
      kind: "eval_pack",
      name: "Unproven",
      publisher: "anon",
      version: "0.1.0",
      certificationTier: "none",
      publishedAt: new Date(0).toISOString(),
      cases,
    });
    expect(mp.browse({ minTier: "silver" })).toHaveLength(0);
    expect(mp.browse()).toHaveLength(1);
  });
});
