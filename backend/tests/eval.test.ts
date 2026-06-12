import { describe, it, expect } from "vitest";
import {
  DeterministicCaseGenerator,
  runEvalSuite,
} from "../src/eval.js";
import { StubModel } from "../src/model.js";
import { acmeSupportBot, acmeGroundedModelTable } from "../src/seed.js";

const gen = new DeterministicCaseGenerator();

describe("DeterministicCaseGenerator", () => {
  it("generates stable cases from the declared purpose", () => {
    const a = gen.generate(acmeSupportBot());
    const b = gen.generate(acmeSupportBot());
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(3);
  });

  it("adds a no-fabrication edge case for support agents", () => {
    const cases = gen.generate(acmeSupportBot());
    expect(cases.map((c) => c.id)).toContain("edge-no-fabrication");
  });
});

describe("runEvalSuite — functional", () => {
  it("passes golden cases when grounding is wired", () => {
    const design = acmeSupportBot();
    const model = new StubModel(acmeGroundedModelTable());
    const cases = gen.generate(design);
    const result = runEvalSuite(design, cases, model, { useGrounding: true });
    const refund = result.results.find((r) => r.caseId === "golden-refund-policy");
    expect(refund?.passed).toBe(true);
    expect(result.groundedAccuracy).toBeGreaterThan(0);
  });
});

describe("remove-the-source test (Foundry IQ)", () => {
  it("grounded accuracy measurably drops when grounding is disabled", () => {
    const design = acmeSupportBot();
    const model = new StubModel(acmeGroundedModelTable());
    const cases = gen.generate(design);

    const withGrounding = runEvalSuite(design, cases, model, {
      useGrounding: true,
    });
    const withoutGrounding = runEvalSuite(design, cases, model, {
      useGrounding: false,
    });

    // This is the measured "wiring grounding lowers hallucination" demo.
    expect(withGrounding.groundedAccuracy).toBeGreaterThan(
      withoutGrounding.groundedAccuracy,
    );
  });
});
