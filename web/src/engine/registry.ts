import type { AgentDesign, LifecycleState } from "./types.js";
import type { ApprovalRecord } from "./promotion.js";

// S7 — Agent registry & lifecycle.
// An enterprise inventory of every agent: ownership, status, risk tier, version
// history, lineage, retirement. The lifecycle is a guarded state machine; only
// legal transitions are permitted, and every transition is recorded immutably.

export interface LineageEntry {
  readonly version: string;
  readonly fromState: LifecycleState;
  readonly toState: LifecycleState;
  readonly actor: string;
  readonly timestamp: string;
  readonly note?: string;
}

export interface RegistryRecord {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly riskTier: AgentDesign["sdlc"]["riskTier"];
  readonly costCenter: string;
  readonly currentVersion: string;
  readonly state: LifecycleState;
  readonly design: AgentDesign;
  readonly versions: readonly string[];
  readonly lineage: readonly LineageEntry[];
  readonly approval?: ApprovalRecord;
}

// Legal lifecycle transitions. Anything not listed is rejected.
const TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  draft: ["in_review", "retired"],
  in_review: ["approved", "draft", "retired"],
  approved: ["exported", "draft", "retired"],
  exported: ["deployed", "draft", "retired"],
  deployed: ["retired", "draft"],
  retired: [], // terminal
};

export class IllegalTransitionError extends Error {
  constructor(from: LifecycleState, to: LifecycleState) {
    super(`Illegal lifecycle transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`Agent not found in registry: ${id}`);
    this.name = "NotFoundError";
  }
}

export class DuplicateAgentError extends Error {
  constructor(id: string) {
    super(`Agent already registered: ${id}`);
    this.name = "DuplicateAgentError";
  }
}

export function canTransition(
  from: LifecycleState,
  to: LifecycleState,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export class AgentRegistry {
  private readonly store = new Map<string, RegistryRecord>();
  private readonly now: () => string;

  constructor(now: () => string = () => new Date(0).toISOString()) {
    this.now = now;
  }

  register(design: AgentDesign, actor: string): RegistryRecord {
    if (this.store.has(design.id)) throw new DuplicateAgentError(design.id);
    const record: RegistryRecord = Object.freeze({
      id: design.id,
      name: design.name,
      owner: design.sdlc.owner,
      riskTier: design.sdlc.riskTier,
      costCenter: design.sdlc.costCenter,
      currentVersion: design.sdlc.version,
      state: design.sdlc.lifecycleState,
      design,
      versions: Object.freeze([design.sdlc.version]),
      lineage: Object.freeze([
        Object.freeze({
          version: design.sdlc.version,
          fromState: design.sdlc.lifecycleState,
          toState: design.sdlc.lifecycleState,
          actor,
          timestamp: this.now(),
          note: "registered",
        }),
      ]),
    });
    this.store.set(design.id, record);
    return record;
  }

  get(id: string): RegistryRecord {
    const r = this.store.get(id);
    if (!r) throw new NotFoundError(id);
    return r;
  }

  has(id: string): boolean {
    return this.store.has(id);
  }

  list(filter?: {
    state?: LifecycleState;
    owner?: string;
    riskTier?: AgentDesign["sdlc"]["riskTier"];
  }): RegistryRecord[] {
    let records = [...this.store.values()];
    if (filter?.state) records = records.filter((r) => r.state === filter.state);
    if (filter?.owner) records = records.filter((r) => r.owner === filter.owner);
    if (filter?.riskTier)
      records = records.filter((r) => r.riskTier === filter.riskTier);
    // Deterministic ordering by id.
    return records.sort((a, b) => a.id.localeCompare(b.id));
  }

  transition(
    id: string,
    to: LifecycleState,
    actor: string,
    opts: { note?: string; approval?: ApprovalRecord } = {},
  ): RegistryRecord {
    const current = this.get(id);
    if (!canTransition(current.state, to)) {
      throw new IllegalTransitionError(current.state, to);
    }
    const entry: LineageEntry = Object.freeze({
      version: current.currentVersion,
      fromState: current.state,
      toState: to,
      actor,
      timestamp: this.now(),
      note: opts.note,
    });
    const updated: RegistryRecord = Object.freeze({
      ...current,
      state: to,
      approval: opts.approval ?? current.approval,
      lineage: Object.freeze([...current.lineage, entry]),
    });
    this.store.set(id, updated);
    return updated;
  }

  // Publish a new version of an existing agent. Resets state to draft and
  // records the new version in history + lineage.
  publishVersion(
    id: string,
    newDesign: AgentDesign,
    actor: string,
  ): RegistryRecord {
    const current = this.get(id);
    if (newDesign.id !== id) {
      throw new Error(`Version design id mismatch: ${newDesign.id} != ${id}`);
    }
    if (current.versions.includes(newDesign.sdlc.version)) {
      throw new Error(`Version already exists: ${newDesign.sdlc.version}`);
    }
    const entry: LineageEntry = Object.freeze({
      version: newDesign.sdlc.version,
      fromState: current.state,
      toState: "draft",
      actor,
      timestamp: this.now(),
      note: `published version ${newDesign.sdlc.version}`,
    });
    const updated: RegistryRecord = Object.freeze({
      ...current,
      currentVersion: newDesign.sdlc.version,
      state: "draft",
      design: newDesign,
      versions: Object.freeze([...current.versions, newDesign.sdlc.version]),
      lineage: Object.freeze([...current.lineage, entry]),
    });
    this.store.set(id, updated);
    return updated;
  }

  retire(id: string, actor: string, note?: string): RegistryRecord {
    return this.transition(id, "retired", actor, { note: note ?? "retired" });
  }

  // Cost-center rollup for governance reporting.
  costRollup(): Record<string, number> {
    const rollup: Record<string, number> = {};
    for (const r of this.store.values()) {
      rollup[r.costCenter] = (rollup[r.costCenter] ?? 0) + 1;
    }
    return rollup;
  }
}
