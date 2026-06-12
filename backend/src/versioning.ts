// S25 — Agent versioning, diff & rollback.
// Computes a structural diff between two agent designs (nodes, edges, SDLC,
// purpose) and supports rolling a deployed agent back to a prior approved
// version. Diffs are deterministic and explainable for change review.

import type { AgentDesign, GraphNode } from "./types.js";

export type ChangeKind = "added" | "removed" | "modified";

export interface FieldChange {
  path: string;
  kind: ChangeKind;
  before?: unknown;
  after?: unknown;
}

export interface DesignDiff {
  from: string; // version
  to: string;
  changes: FieldChange[];
  nodesSummary: { added: string[]; removed: string[]; modified: string[] };
  hasChanges: boolean;
}

function nodeMap(design: AgentDesign): Map<string, GraphNode> {
  return new Map(design.nodes.map((n) => [n.id, n]));
}

function nodeEquals(a: GraphNode, b: GraphNode): boolean {
  return (
    a.type === b.type &&
    a.label === b.label &&
    JSON.stringify(a.config) === JSON.stringify(b.config)
  );
}

export function diffDesigns(before: AgentDesign, after: AgentDesign): DesignDiff {
  const changes: FieldChange[] = [];

  // Purpose.
  if (before.purpose !== after.purpose) {
    changes.push({ path: "purpose", kind: "modified", before: before.purpose, after: after.purpose });
  }
  // Name.
  if (before.name !== after.name) {
    changes.push({ path: "name", kind: "modified", before: before.name, after: after.name });
  }

  // SDLC fields (compare each scalar field deterministically).
  const sdlcFields: (keyof AgentDesign["sdlc"])[] = [
    "version",
    "owner",
    "riskTier",
    "costCenter",
    "lifecycleState",
  ];
  for (const f of sdlcFields) {
    if (before.sdlc[f] !== after.sdlc[f]) {
      changes.push({ path: `sdlc.${f}`, kind: "modified", before: before.sdlc[f], after: after.sdlc[f] });
    }
  }
  // Tool permissions + data access (compare serialized).
  if (JSON.stringify(before.sdlc.toolPermissions) !== JSON.stringify(after.sdlc.toolPermissions)) {
    changes.push({ path: "sdlc.toolPermissions", kind: "modified", before: before.sdlc.toolPermissions, after: after.sdlc.toolPermissions });
  }
  if (JSON.stringify(before.sdlc.dataAccessProfile) !== JSON.stringify(after.sdlc.dataAccessProfile)) {
    changes.push({ path: "sdlc.dataAccessProfile", kind: "modified", before: before.sdlc.dataAccessProfile, after: after.sdlc.dataAccessProfile });
  }

  // Nodes.
  const beforeNodes = nodeMap(before);
  const afterNodes = nodeMap(after);
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const id of [...afterNodes.keys()].sort()) {
    if (!beforeNodes.has(id)) {
      added.push(id);
      changes.push({ path: `node.${id}`, kind: "added", after: afterNodes.get(id) });
    } else if (!nodeEquals(beforeNodes.get(id)!, afterNodes.get(id)!)) {
      modified.push(id);
      changes.push({ path: `node.${id}`, kind: "modified", before: beforeNodes.get(id), after: afterNodes.get(id) });
    }
  }
  for (const id of [...beforeNodes.keys()].sort()) {
    if (!afterNodes.has(id)) {
      removed.push(id);
      changes.push({ path: `node.${id}`, kind: "removed", before: beforeNodes.get(id) });
    }
  }

  // Edges (compare serialized sets).
  const beforeEdges = before.edges.map((e) => `${e.from}->${e.to}`).sort();
  const afterEdges = after.edges.map((e) => `${e.from}->${e.to}`).sort();
  if (JSON.stringify(beforeEdges) !== JSON.stringify(afterEdges)) {
    changes.push({ path: "edges", kind: "modified", before: beforeEdges, after: afterEdges });
  }

  return {
    from: before.sdlc.version,
    to: after.sdlc.version,
    changes,
    nodesSummary: { added, removed, modified },
    hasChanges: changes.length > 0,
  };
}

// ---- Version store + rollback ----

export interface VersionedDesign {
  readonly version: string;
  readonly design: AgentDesign;
  readonly approved: boolean;
  readonly createdAt: string;
}

export class RollbackError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "RollbackError";
  }
}

export class VersionHistory {
  private readonly versions = new Map<string, VersionedDesign>();
  private readonly order: string[] = [];
  private readonly now: () => string;

  constructor(now: () => string = () => new Date(0).toISOString()) {
    this.now = now;
  }

  record(design: AgentDesign, approved: boolean): VersionedDesign {
    const v: VersionedDesign = Object.freeze({
      version: design.sdlc.version,
      design,
      approved,
      createdAt: this.now(),
    });
    if (!this.versions.has(v.version)) this.order.push(v.version);
    this.versions.set(v.version, v);
    return v;
  }

  get(version: string): VersionedDesign | null {
    return this.versions.get(version) ?? null;
  }

  list(): VersionedDesign[] {
    return this.order.map((v) => this.versions.get(v)!);
  }

  // Diff a version against the immediately previous recorded version.
  diffAgainstPrevious(version: string): DesignDiff | null {
    const idx = this.order.indexOf(version);
    if (idx <= 0) return null;
    const prev = this.versions.get(this.order[idx - 1])!;
    const cur = this.versions.get(version)!;
    return diffDesigns(prev.design, cur.design);
  }

  // Roll back to a prior APPROVED version. Returns the design to redeploy.
  rollbackTo(version: string): AgentDesign {
    const target = this.versions.get(version);
    if (!target) throw new RollbackError(`Version not found: ${version}`);
    if (!target.approved) {
      throw new RollbackError(`Cannot roll back to unapproved version: ${version}`);
    }
    return target.design;
  }

  // The latest approved version, or null.
  latestApproved(): VersionedDesign | null {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const v = this.versions.get(this.order[i])!;
      if (v.approved) return v;
    }
    return null;
  }
}
