import type {
  AgentDesign,
  CompileResult,
  GraphIssue,
  GraphNode,
} from "./types.js";

// The graph compiler is fully deterministic: same input -> same issues in the
// same order. It rejects cycles, invalid wiring, and unsafe SDLC combinations.

function detectDuplicateIds(nodes: GraphNode[]): GraphIssue[] {
  const seen = new Set<string>();
  const issues: GraphIssue[] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) {
      issues.push({
        code: "DUPLICATE_NODE_ID",
        message: `Duplicate node id: ${n.id}`,
        nodeId: n.id,
      });
    }
    seen.add(n.id);
  }
  return issues;
}

function validateEdges(design: AgentDesign): GraphIssue[] {
  const ids = new Set(design.nodes.map((n) => n.id));
  const issues: GraphIssue[] = [];
  for (const e of design.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) {
      issues.push({
        code: "INVALID_EDGE",
        message: `Edge references unknown node: ${e.from} -> ${e.to}`,
      });
    }
    if (e.from === e.to) {
      issues.push({
        code: "CYCLE_DETECTED",
        message: `Self-loop on node: ${e.from}`,
        nodeId: e.from,
      });
    }
  }
  return issues;
}

// Kahn's algorithm. Returns null order if a cycle exists.
function topoSort(design: AgentDesign): string[] | null {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of design.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of design.edges) {
    // Edges are validated by validateEdges before compile reaches here, so both
    // endpoints are guaranteed present in the indegree map.
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  }
  // Deterministic: process ids in sorted order.
  const queue = [...indeg.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id)!.sort()) {
      indeg.set(next, indeg.get(next)! - 1);
      if (indeg.get(next) === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }
  return order.length === design.nodes.length ? order : null;
}

function validateSdlc(design: AgentDesign): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const hasHitl = design.nodes.some((n) => n.type === "hitl");
  const hasWriteOrSend = design.sdlc.toolPermissions.some(
    (p) => p.scope === "write" || p.scope === "send",
  );
  if (hasWriteOrSend && !hasHitl) {
    issues.push({
      code: "MISSING_HITL_FOR_WRITE",
      message:
        "Agent has write/send tool permissions but no human-in-the-loop gate.",
    });
  }
  // Unsafe permission: a send-scoped tool on a low risk tier is disallowed.
  for (const p of design.sdlc.toolPermissions) {
    if (p.scope === "send" && design.sdlc.riskTier === "low") {
      issues.push({
        code: "UNSAFE_TOOL_PERMISSION",
        message: `Send-scope tool '${p.toolId}' not allowed at low risk tier.`,
      });
    }
  }
  return issues;
}

function validateStructure(design: AgentDesign): GraphIssue[] {
  const issues: GraphIssue[] = [];
  if (design.nodes.length === 0) {
    issues.push({ code: "EMPTY_GRAPH", message: "Graph has no nodes." });
  }
  if (!design.purpose || design.purpose.trim().length === 0) {
    issues.push({
      code: "MISSING_PURPOSE",
      message: "Agent purpose must be declared before evaluation.",
    });
  }
  if (!design.nodes.some((n) => n.type === "model")) {
    issues.push({ code: "MISSING_MODEL", message: "Graph has no model node." });
  }
  return issues;
}

// Grounding required for high/critical risk tiers (anti-hallucination policy).
function validateGrounding(design: AgentDesign): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const needsGrounding =
    design.sdlc.riskTier === "high" || design.sdlc.riskTier === "critical";
  const hasGrounding = design.nodes.some((n) => n.type === "grounding");
  if (needsGrounding && !hasGrounding) {
    issues.push({
      code: "MISSING_GROUNDING",
      message: `Risk tier '${design.sdlc.riskTier}' requires a grounding source.`,
    });
  }
  return issues;
}

export function compileGraph(design: AgentDesign): CompileResult {
  const issues: GraphIssue[] = [
    ...validateStructure(design),
    ...detectDuplicateIds(design.nodes),
    ...validateEdges(design),
    ...validateGrounding(design),
    ...validateSdlc(design),
  ];

  let order: string[] = [];
  // Only attempt topo sort if edges are structurally sound (no unknown endpoints).
  const hasInvalidEdge = issues.some((i) => i.code === "INVALID_EDGE");
  if (design.nodes.length > 0 && !hasInvalidEdge) {
    const sorted = topoSort(design);
    if (sorted === null) {
      if (!issues.some((i) => i.code === "CYCLE_DETECTED")) {
        issues.push({
          code: "CYCLE_DETECTED",
          message: "Graph contains a circular dependency.",
        });
      }
    } else {
      order = sorted;
    }
  }

  return { valid: issues.length === 0, issues, order };
}
