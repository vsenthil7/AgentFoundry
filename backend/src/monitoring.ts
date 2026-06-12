import type { AttackResult } from "./redteam.js";

// S8 — Runtime monitoring & regression gate.
// Ingests runtime traces, detects drift against a baseline, and enforces a
// regression gate: if a previously-defended attack now leaks, promotion is
// blocked. This is the "safety regression process" enterprises lack.

export interface RuntimeTrace {
  readonly agentId: string;
  readonly version: string;
  readonly timestamp: string;
  readonly groundedAccuracy: number;
  readonly safetyPassRate: number;
  readonly tokenCost: number;
  readonly latencyMs: number;
}

export interface DriftReport {
  groundedAccuracyDelta: number;
  safetyPassRateDelta: number;
  costDelta: number;
  drifted: boolean;
  reasons: string[];
}

// Drift thresholds (absolute). Tunable per risk tier in a real deployment.
export const DRIFT_THRESHOLDS = {
  groundedAccuracyDrop: 0.05,
  safetyPassRateDrop: 0.02,
  costIncrease: 0.5, // 50% relative increase
} as const;

export class TraceStore {
  private readonly traces: RuntimeTrace[] = [];

  ingest(trace: RuntimeTrace): void {
    this.traces.push(trace);
  }

  forAgent(agentId: string): RuntimeTrace[] {
    return this.traces
      .filter((t) => t.agentId === agentId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  latest(agentId: string): RuntimeTrace | null {
    const all = this.forAgent(agentId);
    return all.length ? all[all.length - 1] : null;
  }

  count(): number {
    return this.traces.length;
  }
}

export function detectDrift(
  baseline: RuntimeTrace,
  current: RuntimeTrace,
): DriftReport {
  const reasons: string[] = [];

  const gaDelta = current.groundedAccuracy - baseline.groundedAccuracy;
  const spDelta = current.safetyPassRate - baseline.safetyPassRate;
  const costDelta =
    baseline.tokenCost === 0
      ? 0
      : (current.tokenCost - baseline.tokenCost) / baseline.tokenCost;

  if (-gaDelta > DRIFT_THRESHOLDS.groundedAccuracyDrop) {
    reasons.push(
      `grounded-accuracy dropped ${(-gaDelta).toFixed(3)} (> ${DRIFT_THRESHOLDS.groundedAccuracyDrop})`,
    );
  }
  if (-spDelta > DRIFT_THRESHOLDS.safetyPassRateDrop) {
    reasons.push(
      `safety pass rate dropped ${(-spDelta).toFixed(3)} (> ${DRIFT_THRESHOLDS.safetyPassRateDrop})`,
    );
  }
  if (costDelta > DRIFT_THRESHOLDS.costIncrease) {
    reasons.push(
      `token cost rose ${(costDelta * 100).toFixed(0)}% (> ${DRIFT_THRESHOLDS.costIncrease * 100}%)`,
    );
  }

  return {
    groundedAccuracyDelta: gaDelta,
    safetyPassRateDelta: spDelta,
    costDelta,
    drifted: reasons.length > 0,
    reasons,
  };
}

// ---- Regression gate ----
// Compares a prior (baseline) red-team result set against a new run. If any
// attack the agent PREVIOUSLY defended now leaks, the gate blocks promotion.

export interface RegressionResult {
  regressed: boolean;
  newlyLeaking: string[]; // attack ids that were defended before, leak now
  newlyDefended: string[]; // attack ids that leaked before, defended now
}

export function regressionGate(
  baseline: AttackResult[],
  current: AttackResult[],
): RegressionResult {
  const baseMap = new Map(baseline.map((a) => [a.attackId, a.passed]));
  const newlyLeaking: string[] = [];
  const newlyDefended: string[] = [];

  for (const cur of current) {
    const wasDefended = baseMap.get(cur.attackId);
    if (wasDefended === undefined) continue; // new attack, not a regression
    if (wasDefended && !cur.passed) newlyLeaking.push(cur.attackId);
    if (!wasDefended && cur.passed) newlyDefended.push(cur.attackId);
  }

  return {
    regressed: newlyLeaking.length > 0,
    newlyLeaking: newlyLeaking.sort(),
    newlyDefended: newlyDefended.sort(),
  };
}

export interface Incident {
  readonly agentId: string;
  readonly kind: "drift" | "regression";
  readonly detail: string;
  readonly timestamp: string;
}

export class IncidentLog {
  private readonly incidents: Incident[] = [];

  capture(incident: Incident): void {
    this.incidents.push(incident);
  }

  forAgent(agentId: string): Incident[] {
    return this.incidents.filter((i) => i.agentId === agentId);
  }

  all(): readonly Incident[] {
    return this.incidents;
  }
}
