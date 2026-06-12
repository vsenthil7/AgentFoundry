// S51 — SLA / uptime tracking.
// Records per-agent availability windows (up/down transitions) against a target
// availability (e.g. 99.9%), computes realized uptime over a measurement period,
// and flags SLA breaches. Deterministic via explicit timestamps.

export type AvailabilityState = "up" | "down";

export interface SlaTarget {
  // Target availability as a fraction (e.g. 0.999 = three nines).
  target: number;
}

export interface SlaReport {
  agentId: string;
  windowMs: number;
  upMs: number;
  downMs: number;
  uptime: number; // realized fraction
  target: number;
  breached: boolean;
  errorBudgetMsRemaining: number; // allowed downtime - actual downtime
}

interface Transition {
  atMs: number;
  state: AvailabilityState;
}

export class SlaTrackerError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SlaTrackerError";
  }
}

export class SlaTracker {
  // agentId -> ordered transitions.
  private readonly transitions = new Map<string, Transition[]>();
  private readonly targets = new Map<string, number>();

  // Set the SLA target for an agent (defaults to 0.99 if never set).
  setTarget(agentId: string, target: SlaTarget): void {
    if (target.target <= 0 || target.target > 1) {
      throw new SlaTrackerError("SLA target must be in (0, 1].");
    }
    this.targets.set(agentId, target.target);
  }

  // Record an availability transition. Transitions must be non-decreasing in time.
  record(agentId: string, state: AvailabilityState, atMs: number): void {
    const arr = this.transitions.get(agentId) ?? [];
    const last = arr[arr.length - 1];
    if (last && atMs < last.atMs) {
      throw new SlaTrackerError("Transitions must be recorded in time order.");
    }
    arr.push({ atMs, state });
    this.transitions.set(agentId, arr);
  }

  // Compute the SLA report over [startMs, endMs]. Assumes "up" before the first
  // transition unless the first transition is at startMs.
  report(agentId: string, startMs: number, endMs: number): SlaReport {
    if (endMs <= startMs) throw new SlaTrackerError("endMs must be after startMs.");
    const target = this.targets.get(agentId) ?? 0.99;
    const arr = this.transitions.get(agentId) ?? [];

    const windowMs = endMs - startMs;
    let downMs = 0;
    // Walk the window, accumulating downtime.
    let cursor = startMs;
    let state: AvailabilityState = "up";

    // Establish the state at startMs from the last transition at/just before it.
    for (const t of arr) {
      if (t.atMs <= startMs) state = t.state;
    }

    for (const t of arr) {
      if (t.atMs <= startMs || t.atMs >= endMs) continue;
      if (state === "down") downMs += t.atMs - cursor;
      cursor = t.atMs;
      state = t.state;
    }
    // Final segment to endMs.
    if (state === "down") downMs += endMs - cursor;

    const upMs = windowMs - downMs;
    const uptime = upMs / windowMs;
    const allowedDownMs = Math.round(windowMs * (1 - target));
    return {
      agentId,
      windowMs,
      upMs,
      downMs,
      uptime,
      target,
      breached: uptime < target,
      errorBudgetMsRemaining: allowedDownMs - downMs,
    };
  }
}
