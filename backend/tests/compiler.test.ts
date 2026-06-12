import { describe, it, expect } from "vitest";
import { compileGraph } from "../src/compiler.js";
import { acmeSupportBot } from "../src/seed.js";
import type { AgentDesign } from "../src/types.js";

describe("compileGraph — valid paths", () => {
  it("compiles the seed Acme bot to a valid topo order", () => {
    const r = compileGraph(acmeSupportBot());
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
    expect(r.order.length).toBe(acmeSupportBot().nodes.length);
  });

  it("produces a deterministic order across runs", () => {
    const a = compileGraph(acmeSupportBot());
    const b = compileGraph(acmeSupportBot());
    expect(a.order).toEqual(b.order);
  });
});

describe("compileGraph — negative paths", () => {
  it("rejects an empty graph", () => {
    const d: AgentDesign = { ...acmeSupportBot(), nodes: [], edges: [] };
    const r = compileGraph(d);
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("EMPTY_GRAPH");
  });

  it("rejects a missing purpose", () => {
    const r = compileGraph({ ...acmeSupportBot(), purpose: "  " });
    expect(r.issues.map((i) => i.code)).toContain("MISSING_PURPOSE");
  });

  it("rejects a graph with no model node", () => {
    const d = acmeSupportBot();
    const r = compileGraph({
      ...d,
      nodes: d.nodes.filter((n) => n.type !== "model"),
    });
    expect(r.issues.map((i) => i.code)).toContain("MISSING_MODEL");
  });

  it("detects a circular dependency", () => {
    const d = acmeSupportBot();
    const r = compileGraph({
      ...d,
      edges: [
        { from: "model-1", to: "prompt-1" },
        { from: "prompt-1", to: "model-1" },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("CYCLE_DETECTED");
  });

  it("detects a self-loop as a cycle", () => {
    const d = acmeSupportBot();
    const r = compileGraph({ ...d, edges: [{ from: "model-1", to: "model-1" }] });
    expect(r.issues.map((i) => i.code)).toContain("CYCLE_DETECTED");
  });

  it("rejects an edge to an unknown node", () => {
    const d = acmeSupportBot();
    const r = compileGraph({
      ...d,
      edges: [...d.edges, { from: "model-1", to: "ghost" }],
    });
    expect(r.issues.map((i) => i.code)).toContain("INVALID_EDGE");
  });

  it("detects duplicate node ids", () => {
    const d = acmeSupportBot();
    const r = compileGraph({ ...d, nodes: [...d.nodes, d.nodes[0]] });
    expect(r.issues.map((i) => i.code)).toContain("DUPLICATE_NODE_ID");
  });

  it("requires grounding for high risk tier", () => {
    const d = acmeSupportBot({ withGrounding: false, withGuardrail: true });
    const r = compileGraph(d);
    expect(r.issues.map((i) => i.code)).toContain("MISSING_GROUNDING");
  });

  it("requires a HITL gate when a write/send permission exists", () => {
    const d = acmeSupportBot();
    const r = compileGraph({
      ...d,
      nodes: d.nodes.filter((n) => n.type !== "hitl"),
    });
    expect(r.issues.map((i) => i.code)).toContain("MISSING_HITL_FOR_WRITE");
  });

  it("flags an unsafe send permission at low risk tier", () => {
    const d = acmeSupportBot({ withGrounding: false, withGuardrail: false });
    const r = compileGraph({
      ...d,
      sdlc: { ...d.sdlc, riskTier: "low" },
    });
    expect(r.issues.map((i) => i.code)).toContain("UNSAFE_TOOL_PERMISSION");
  });
});
