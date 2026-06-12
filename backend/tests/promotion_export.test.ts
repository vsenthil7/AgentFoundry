import { describe, it, expect } from "vitest";
import { requestPromotion } from "../src/promotion.js";
import { computeScoreCard } from "../src/scoring.js";
import {
  exportManifest,
  roundTripIsLossless,
  serializeManifest,
  deserializeManifest,
} from "../src/export.js";
import { DeterministicCaseGenerator } from "../src/eval.js";
import { acmeSupportBot } from "../src/seed.js";
import type { AttackResult } from "../src/redteam.js";

const perfectAttacks: AttackResult[] = [
  { attackId: "a", class: "prompt_injection", passed: true, output: "", mapping: {}, flaked: false },
  { attackId: "b", class: "pii_exfiltration", passed: true, output: "", mapping: {}, flaked: false },
];

function passingCard() {
  return computeScoreCard({
    design: acmeSupportBot(),
    evalRun: { results: [], groundedAccuracy: 1, passRate: 1 },
    attacks: perfectAttacks,
    repeatedPassRates: [1, 1],
  });
}

describe("promotion gate — no self-promotion", () => {
  it("blocks promotion when threshold not met", () => {
    const design = acmeSupportBot();
    const card = computeScoreCard({
      design,
      evalRun: { results: [], groundedAccuracy: 0, passRate: 0 },
      attacks: [
        { attackId: "a", class: "prompt_injection", passed: false, output: "", mapping: {}, flaked: false },
      ],
      piiExposed: true,
    });
    const outcome = requestPromotion(design, card, {
      id: "reviewer@acme.test",
      decision: "approved",
    });
    expect(outcome.state).toBe("threshold_failed");
  });

  it("requires human approval even when threshold passes", () => {
    const design = acmeSupportBot();
    const outcome = requestPromotion(design, passingCard(), {
      id: "reviewer@acme.test",
      decision: "rejected",
    });
    expect(outcome.state).toBe("human_rejected");
  });

  it("approves when threshold passes and human approves", () => {
    const design = acmeSupportBot();
    const outcome = requestPromotion(design, passingCard(), {
      id: "reviewer@acme.test",
      decision: "approved",
    });
    expect(outcome.state).toBe("approved");
  });

  it("produces an immutable (frozen) approval record", () => {
    const design = acmeSupportBot();
    const outcome = requestPromotion(design, passingCard(), {
      id: "reviewer@acme.test",
      decision: "approved",
    });
    if (outcome.state !== "approved") throw new Error("expected approved");
    expect(Object.isFrozen(outcome.record)).toBe(true);
    expect(() => {
      // @ts-expect-error testing immutability at runtime
      outcome.record.reviewer = "tampered";
    }).toThrow();
  });
});

describe("export round-trip fidelity", () => {
  it("serialize -> deserialize -> serialize is byte-identical", () => {
    const design = acmeSupportBot();
    const cases = new DeterministicCaseGenerator().generate(design);
    const manifest = exportManifest(design, cases);
    expect(roundTripIsLossless(manifest)).toBe(true);
  });

  it("re-imported manifest preserves the agent design", () => {
    const design = acmeSupportBot();
    const cases = new DeterministicCaseGenerator().generate(design);
    const manifest = exportManifest(design, cases);
    const back = deserializeManifest(serializeManifest(manifest));
    expect(back.agent.id).toBe(design.id);
    expect(back.agent.nodes.length).toBe(design.nodes.length);
    expect(back.evalSuite.length).toBe(cases.length);
    expect(back.redTeamSuite.length).toBeGreaterThan(0);
  });
});
