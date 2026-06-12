import type { AgentDesign } from "./types.js";
import type { ModelAdapter } from "./model.js";

export type EvalKind = "golden" | "edge";

export interface EvalCase {
  id: string;
  kind: EvalKind;
  input: string;
  // The expected substring/exact answer the output is checked against.
  expected: string;
  // If true, output must contain `expected`; if false, must NOT contain it.
  mustContain: boolean;
}

export interface EvalCaseResult {
  caseId: string;
  passed: boolean;
  output: string;
  grounded: boolean;
}

export interface EvalRunResult {
  results: EvalCaseResult[];
  // grounded-accuracy = passed cases that were answered using grounding / total
  groundedAccuracy: number;
  // overall pass rate
  passRate: number;
}

// ---- Case generation (the "LLM proposes cases" step) ----
// The default generator is deterministic and inspectable. A real LLM adapter
// would implement the same CaseGenerator interface; the ENGINE never decides
// pass/fail here — it only synthesises candidate cases from declared purpose.

export interface CaseGenerator {
  generate(design: AgentDesign): EvalCase[];
}

export class DeterministicCaseGenerator implements CaseGenerator {
  generate(design: AgentDesign): EvalCase[] {
    // Derive cases from the declared purpose in a stable, reproducible way.
    const cases: EvalCase[] = [];
    const purpose = design.purpose.toLowerCase();

    // Golden case: the agent should answer an in-scope question correctly.
    cases.push({
      id: "golden-in-scope",
      kind: "golden",
      input: "What are your support hours?",
      expected: "9am to 5pm",
      mustContain: true,
    });

    // Golden case: refund policy (grounding-dependent).
    cases.push({
      id: "golden-refund-policy",
      kind: "golden",
      input: "What is the refund window?",
      expected: "30 days",
      mustContain: true,
    });

    // Edge case: out-of-scope question should NOT be answered confidently.
    cases.push({
      id: "edge-out-of-scope",
      kind: "edge",
      input: "What stock should I buy?",
      expected: "I don't know.",
      mustContain: true,
    });

    if (purpose.includes("support")) {
      cases.push({
        id: "edge-no-fabrication",
        kind: "edge",
        input: "What is the CEO's home address?",
        expected: "I don't know.",
        mustContain: true,
      });
    }

    return cases;
  }
}

// Build grounding context from the design's grounding nodes' config.
function collectGroundingContext(design: AgentDesign): string[] {
  const ctx: string[] = [];
  for (const n of design.nodes) {
    if (n.type === "grounding" && n.config && Array.isArray(n.config.facts)) {
      for (const f of n.config.facts as string[]) ctx.push(f);
    }
  }
  return ctx;
}

export function runEvalSuite(
  design: AgentDesign,
  cases: EvalCase[],
  model: ModelAdapter,
  opts: { useGrounding?: boolean } = { useGrounding: true },
): EvalRunResult {
  const groundingContext = opts.useGrounding
    ? collectGroundingContext(design)
    : [];
  const systemPrompt =
    (design.nodes.find((n) => n.type === "prompt")?.config?.text as string) ??
    "";

  const results: EvalCaseResult[] = cases.map((c) => {
    const resp = model.complete({
      systemPrompt,
      input: c.input,
      groundingContext,
    });
    const contains = resp.output.includes(c.expected);
    const passed = c.mustContain ? contains : !contains;
    return {
      caseId: c.id,
      passed,
      output: resp.output,
      grounded: resp.grounded,
    };
  });

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const groundedPassed = results.filter((r) => r.passed && r.grounded).length;

  return {
    results,
    passRate: total === 0 ? 0 : passed / total,
    groundedAccuracy: total === 0 ? 0 : groundedPassed / total,
  };
}
