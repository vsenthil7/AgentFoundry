import { describe, it, expect } from "vitest";
import {
  acmeSupportBot,
  acmeGroundedModelTable,
  StubModel,
  compileGraph,
  DeterministicCaseGenerator,
  runEvalSuite,
  runBattle,
  computeScoreCard,
  requestPromotion,
  exportManifest,
  roundTripIsLossless,
} from "../src/index.js";

describe("StubModel adapter", () => {
  it("returns fallback for unknown input", () => {
    const m = new StubModel({}, { fallback: "nope" });
    expect(m.complete({ systemPrompt: "", input: "x" }).output).toBe("nope");
  });
  it("returns direct table hit", () => {
    const m = new StubModel({ hi: "hello" });
    expect(m.complete({ systemPrompt: "", input: "hi" }).output).toBe("hello");
  });
  it("marks grounded when context supplied", () => {
    const m = new StubModel();
    const r = m.complete({ systemPrompt: "", input: "x", groundingContext: ["c"] });
    expect(r.grounded).toBe(true);
  });
  it("uses a custom id", () => {
    expect(new StubModel({}, { id: "custom" }).id).toBe("custom");
  });
});

describe("GOLDEN THREAD — Acme Support Bot end-to-end", () => {
  it("walks compose -> eval -> battle -> score -> approve -> export green", () => {
    // 1. Compose + compile
    const design = acmeSupportBot();
    const compiled = compileGraph(design);
    expect(compiled.valid).toBe(true);

    // 2. Declare purpose -> auto-generate evals
    const cases = new DeterministicCaseGenerator().generate(design);
    expect(cases.length).toBeGreaterThanOrEqual(3);

    // 3. Run evals WITH grounding (Foundry IQ wired)
    const model = new StubModel(acmeGroundedModelTable(), {
      fallback: "I don't know.",
    });
    const evalRun = runEvalSuite(design, cases, model, { useGrounding: true });

    // 4. Battle Mode with a guardrail present -> defends
    const attacks = runBattle(design, model, { designId: design.id });
    expect(attacks.every((a) => a.passed)).toBe(true);

    // 5. Score (deterministic)
    const card = computeScoreCard({
      design,
      evalRun,
      attacks,
      repeatedPassRates: [evalRun.passRate, evalRun.passRate],
    });

    // 6. Human promotion gate
    const outcome = requestPromotion(design, card, {
      id: "reviewer@acme.test",
      decision: "approved",
    });
    expect(outcome.state).toBe("approved");

    // 7. Export + round-trip fidelity
    const manifest = exportManifest(design, cases);
    expect(roundTripIsLossless(manifest)).toBe(true);
  });

  it("remove-the-source: toggling Foundry IQ off measurably lowers grounded accuracy", () => {
    const design = acmeSupportBot();
    const cases = new DeterministicCaseGenerator().generate(design);
    const model = new StubModel(acmeGroundedModelTable(), {
      fallback: "I don't know.",
    });
    const on = runEvalSuite(design, cases, model, { useGrounding: true });
    const off = runEvalSuite(design, cases, model, { useGrounding: false });
    expect(on.groundedAccuracy).toBeGreaterThan(off.groundedAccuracy);
  });
});
