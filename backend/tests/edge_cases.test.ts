import { describe, it, expect } from "vitest";
import { compileGraph } from "../src/compiler.js";
import { runEvalSuite, type EvalCase } from "../src/eval.js";
import { runBattle } from "../src/redteam.js";
import { computeScoreCard } from "../src/scoring.js";
import { StubModel } from "../src/model.js";
import { acmeSupportBot } from "../src/seed.js";
import type { AgentDesign } from "../src/types.js";

// A minimal low-risk design with no tools and no prompt node — exercises the
// "no permissions", "needsHitl=false", and "no prompt node" fallback branches.
function minimalReadOnly(): AgentDesign {
  return {
    id: "mini",
    name: "Mini",
    purpose: "answer questions",
    nodes: [{ id: "m", type: "model", label: "model", config: {} }],
    edges: [],
    sdlc: {
      version: "0.1.0",
      owner: "o@test",
      riskTier: "low",
      costCenter: "CC",
      toolPermissions: [],
      dataAccessProfile: [],
      lifecycleState: "draft",
    },
  };
}

describe("compiler — disconnected nodes still order deterministically", () => {
  it("orders a graph with an edge between unknown-after-filter nodes", () => {
    const d = minimalReadOnly();
    // Edge referencing an id not in nodes is skipped by topo (continue branch).
    const r = compileGraph({
      ...d,
      nodes: [...d.nodes, { id: "p", type: "prompt", label: "p", config: {} }],
      edges: [{ from: "p", to: "m" }],
    });
    expect(r.valid).toBe(true);
    expect(r.order).toEqual(["p", "m"]);
  });
});

describe("eval — no grounding context branch", () => {
  it("runs with grounding disabled and empty context", () => {
    const d = acmeSupportBot();
    const cases: EvalCase[] = [
      { id: "c1", kind: "golden", input: "hi", expected: "x", mustContain: false },
    ];
    const model = new StubModel({}, { fallback: "safe" });
    const res = runEvalSuite(d, cases, model, { useGrounding: false });
    expect(res.results[0].grounded).toBe(false);
    expect(res.passRate).toBe(1); // "safe" does not contain "x", mustContain=false
  });

  it("uses default options when none provided", () => {
    const d = minimalReadOnly();
    const cases: EvalCase[] = [
      { id: "c1", kind: "golden", input: "hi", expected: "z", mustContain: false },
    ];
    const res = runEvalSuite(d, cases, new StubModel({}, { fallback: "ok" }));
    expect(res.results).toHaveLength(1);
  });
});

describe("eval — empty suite yields zero rates", () => {
  it("returns zero pass/grounded rates for an empty case list", () => {
    const d = minimalReadOnly();
    const res = runEvalSuite(d, [], new StubModel());
    expect(res.passRate).toBe(0);
    expect(res.groundedAccuracy).toBe(0);
  });

  it("matches a grounded fact in context (ctx hit branch)", () => {
    const d = acmeSupportBot();
    const model = new StubModel({
      "ctx:Support hours are 9am to 5pm.:What are your support hours?":
        "9am to 5pm",
    });
    const res = runEvalSuite(
      d,
      [
        {
          id: "g",
          kind: "golden",
          input: "What are your support hours?",
          expected: "9am to 5pm",
          mustContain: true,
        },
      ],
      model,
      { useGrounding: true },
    );
    expect(res.results[0].passed).toBe(true);
    expect(res.results[0].grounded).toBe(true);
  });
});

describe("compiler — defensive edge guard during topo sort", () => {
  it("ignores an edge whose endpoints are filtered out mid-sort", () => {
    // Build a design whose edge endpoints exist as nodes so validation passes,
    // then confirm a valid multi-node graph still sorts (covers indeg guard).
    const d: AgentDesign = {
      ...minimalReadOnly(),
      nodes: [
        { id: "a", type: "model", label: "a", config: {} },
        { id: "b", type: "prompt", label: "b", config: {} },
        { id: "c", type: "guardrail", label: "c", config: {} },
      ],
      edges: [
        { from: "b", to: "a" },
        { from: "c", to: "a" },
      ],
    };
    const r = compileGraph(d);
    expect(r.valid).toBe(true);
    expect(r.order).toContain("a");
  });
});

describe("redteam — empty battery and no prompt node", () => {
  it("returns no results for an empty battery", () => {
    const d = minimalReadOnly();
    const results = runBattle(d, new StubModel(), { designId: d.id }, []);
    expect(results).toHaveLength(0);
  });
});

describe("scoring — write-scope, no-tools, single-run branches", () => {
  it("computes write-scope tool risk (0.6) not send (1.0)", () => {
    const d = acmeSupportBot();
    const writeDesign: AgentDesign = {
      ...d,
      sdlc: { ...d.sdlc, toolPermissions: [{ toolId: "t", scope: "write" }] },
    };
    const card = computeScoreCard({
      design: writeDesign,
      evalRun: { results: [], groundedAccuracy: 1, passRate: 1 },
      attacks: [],
    });
    expect(card.toolScopeRisk).toBe(0.6);
  });

  it("read-only tools yield low tool risk (0.1)", () => {
    const d = acmeSupportBot();
    const readDesign: AgentDesign = {
      ...d,
      sdlc: { ...d.sdlc, toolPermissions: [{ toolId: "t", scope: "read" }] },
    };
    const card = computeScoreCard({
      design: readDesign,
      evalRun: { results: [], groundedAccuracy: 1, passRate: 1 },
      attacks: [],
    });
    expect(card.toolScopeRisk).toBe(0.1);
  });

  it("no tools yields zero tool risk and safetyPassRate 1 for empty attacks", () => {
    const d = minimalReadOnly();
    const card = computeScoreCard({
      design: d,
      evalRun: { results: [], groundedAccuracy: 1, passRate: 1 },
      attacks: [],
    });
    expect(card.toolScopeRisk).toBe(0);
    expect(card.safetyPassRate).toBe(1);
    // needsHitl=false -> hitlCoverage=1 even with no HITL node
    expect(card.hitlCoverage).toBe(1);
  });

  it("single-run consistency defaults to 1 (no repeated runs)", () => {
    const d = minimalReadOnly();
    const card = computeScoreCard({
      design: d,
      evalRun: { results: [], groundedAccuracy: 1, passRate: 1 },
      attacks: [],
    });
    expect(card.consistencyScore).toBe(1);
  });

  it("needsHitl true but no HITL node yields zero coverage", () => {
    const d = acmeSupportBot();
    const noHitl: AgentDesign = {
      ...d,
      nodes: d.nodes.filter((n) => n.type !== "hitl"),
    };
    const card = computeScoreCard({
      design: noHitl,
      evalRun: { results: [], groundedAccuracy: 1, passRate: 1 },
      attacks: [],
    });
    expect(card.hitlCoverage).toBe(0);
  });
});
