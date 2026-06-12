import { describe, it, expect, beforeEach } from "vitest";
import {
  diffDesigns,
  VersionHistory,
  RollbackError,
} from "../src/versioning.js";
import { acmeSupportBot } from "../src/seed.js";
import type { AgentDesign } from "../src/types.js";

function v(version: string, mut: (d: AgentDesign) => AgentDesign = (d) => d): AgentDesign {
  const base = acmeSupportBot();
  return mut({ ...base, sdlc: { ...base.sdlc, version } });
}

describe("diffDesigns", () => {
  it("reports no changes for identical designs", () => {
    const d = diffDesigns(v("1.0.0"), v("1.0.0"));
    expect(d.hasChanges).toBe(false);
    expect(d.changes).toHaveLength(0);
  });

  it("detects a purpose change", () => {
    const after = v("1.1.0", (d) => ({ ...d, purpose: "New purpose" }));
    const diff = diffDesigns(v("1.0.0"), after);
    expect(diff.changes.some((c) => c.path === "purpose")).toBe(true);
  });

  it("detects a name change", () => {
    const after = v("1.1.0", (d) => ({ ...d, name: "Renamed" }));
    expect(diffDesigns(v("1.0.0"), after).changes.some((c) => c.path === "name")).toBe(true);
  });

  it("detects SDLC field changes", () => {
    const after = v("2.0.0", (d) => ({ ...d, sdlc: { ...d.sdlc, version: "2.0.0", riskTier: "critical" } }));
    const diff = diffDesigns(v("1.0.0"), after);
    expect(diff.changes.some((c) => c.path === "sdlc.riskTier")).toBe(true);
    expect(diff.changes.some((c) => c.path === "sdlc.version")).toBe(true);
  });

  it("detects tool permission changes", () => {
    const after = v("1.1.0", (d) => ({ ...d, sdlc: { ...d.sdlc, toolPermissions: [{ toolId: "x", scope: "read" }] } }));
    expect(diffDesigns(v("1.0.0"), after).changes.some((c) => c.path === "sdlc.toolPermissions")).toBe(true);
  });

  it("detects data access profile changes", () => {
    const after = v("1.1.0", (d) => ({ ...d, sdlc: { ...d.sdlc, dataAccessProfile: ["new-source"] } }));
    expect(diffDesigns(v("1.0.0"), after).changes.some((c) => c.path === "sdlc.dataAccessProfile")).toBe(true);
  });

  it("detects added nodes", () => {
    const after = v("1.1.0", (d) => ({
      ...d,
      nodes: [...d.nodes, { id: "extra", type: "tool", label: "Extra", config: {} }],
    }));
    const diff = diffDesigns(v("1.0.0"), after);
    expect(diff.nodesSummary.added).toContain("extra");
  });

  it("detects removed nodes", () => {
    const before = v("1.0.0");
    const after = v("1.1.0", (d) => ({ ...d, nodes: d.nodes.filter((n) => n.type !== "guardrail") }));
    const diff = diffDesigns(before, after);
    expect(diff.nodesSummary.removed).toContain("guardrail-1");
  });

  it("detects modified nodes", () => {
    const after = v("1.1.0", (d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === "prompt-1" ? { ...n, config: { text: "changed" } } : n)),
    }));
    const diff = diffDesigns(v("1.0.0"), after);
    expect(diff.nodesSummary.modified).toContain("prompt-1");
  });

  it("detects edge changes", () => {
    const after = v("1.1.0", (d) => ({ ...d, edges: [...d.edges, { from: "hitl-1", to: "model-1" }] }));
    expect(diffDesigns(v("1.0.0"), after).changes.some((c) => c.path === "edges")).toBe(true);
  });

  it("records from/to versions", () => {
    const diff = diffDesigns(v("1.0.0"), v("2.0.0", (d) => ({ ...d, sdlc: { ...d.sdlc, version: "2.0.0" } })));
    expect(diff.from).toBe("1.0.0");
    expect(diff.to).toBe("2.0.0");
  });
});

describe("VersionHistory", () => {
  let h: VersionHistory;
  beforeEach(() => (h = new VersionHistory()));

  it("records and retrieves versions", () => {
    h.record(v("1.0.0"), true);
    expect(h.get("1.0.0")?.version).toBe("1.0.0");
    expect(h.get("ghost")).toBeNull();
  });

  it("lists versions in record order", () => {
    h.record(v("1.0.0"), true);
    h.record(v("1.1.0", (d) => ({ ...d, sdlc: { ...d.sdlc, version: "1.1.0" } })), false);
    expect(h.list().map((x) => x.version)).toEqual(["1.0.0", "1.1.0"]);
  });

  it("freezes recorded versions", () => {
    expect(Object.isFrozen(h.record(v("1.0.0"), true))).toBe(true);
  });

  it("overwrites metadata on re-record of same version without duplicating order", () => {
    h.record(v("1.0.0"), false);
    h.record(v("1.0.0"), true);
    expect(h.list()).toHaveLength(1);
    expect(h.get("1.0.0")?.approved).toBe(true);
  });

  it("diffs against the previous version", () => {
    h.record(v("1.0.0"), true);
    h.record(v("2.0.0", (d) => ({ ...d, purpose: "changed", sdlc: { ...d.sdlc, version: "2.0.0" } })), true);
    const diff = h.diffAgainstPrevious("2.0.0");
    expect(diff?.hasChanges).toBe(true);
  });

  it("returns null diff for the first version", () => {
    h.record(v("1.0.0"), true);
    expect(h.diffAgainstPrevious("1.0.0")).toBeNull();
  });

  it("rolls back to an approved version", () => {
    h.record(v("1.0.0"), true);
    expect(h.rollbackTo("1.0.0").sdlc.version).toBe("1.0.0");
  });

  it("refuses rollback to an unapproved version", () => {
    h.record(v("1.1.0", (d) => ({ ...d, sdlc: { ...d.sdlc, version: "1.1.0" } })), false);
    expect(() => h.rollbackTo("1.1.0")).toThrow(RollbackError);
  });

  it("refuses rollback to an unknown version", () => {
    expect(() => h.rollbackTo("9.9.9")).toThrow(RollbackError);
  });

  it("finds the latest approved version", () => {
    h.record(v("1.0.0"), true);
    h.record(v("1.1.0", (d) => ({ ...d, sdlc: { ...d.sdlc, version: "1.1.0" } })), false);
    expect(h.latestApproved()?.version).toBe("1.0.0");
  });

  it("returns null when no approved version exists", () => {
    h.record(v("1.0.0"), false);
    expect(h.latestApproved()).toBeNull();
  });
});
