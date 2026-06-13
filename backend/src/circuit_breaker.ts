// S82 — Agent circuit breaker (runtime containment).
// Monitoring (S8) *detects* problems; this module *contains* them. When a deployed
// agent's live signals breach configured thresholds, the breaker trips and the agent
// is suspended — a reversible, audited state change — so a misbehaving agent stops
// causing harm without waiting for a human. After a cooldown the breaker moves to
// half-open and lets a probe through; success closes it, failure re-trips.
//
// Fully deterministic: an injectable clock drives cooldown, decisions come from
// thresholds and counters, never from a model. Offline-safe and unit-testable.

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerThresholds {
  // Trip when, over the rolling window, any of these is breached.
  maxErrorRate: number; // 0..1
  maxSafetyViolationRate: number; // 0..1
  maxDriftSeverity: number; // 0..1 (e.g. from drift report)
  // Minimum observations before the breaker is allowed to trip (avoid tripping on n=1).
  minObservations: number;
  // How long (ms) the breaker stays open before moving to half-open.
  cooldownMs: number;
}

export const DEFAULT_THRESHOLDS: BreakerThresholds = {
  maxErrorRate: 0.2,
  maxSafetyViolationRate: 0.05,
  maxDriftSeverity: 0.5,
  minObservations: 5,
  cooldownMs: 60_000,
};

export interface Observation {
  ok: boolean; // request succeeded
  safetyViolation: boolean; // a guardrail/safety check failed
  driftSeverity: number; // 0..1 for this observation (0 if none)
}

export interface BreakerSnapshot {
  agentId: string;
  state: BreakerState;
  observations: number;
  errorRate: number;
  safetyViolationRate: number;
  maxDrift: number;
  trippedAt: number | null;
  lastReason: string | null;
}

export interface BreakerTransition {
  agentId: string;
  from: BreakerState;
  to: BreakerState;
  at: number;
  reason: string;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// One agent's breaker. The manager (below) owns many of these.
class AgentBreaker {
  state: BreakerState = "closed";
  private errors = 0;
  private safety = 0;
  private maxDriftSeen = 0;
  private total = 0;
  trippedAt: number | null = null;
  lastReason: string | null = null;

  constructor(
    readonly agentId: string,
    private readonly thresholds: BreakerThresholds,
  ) {}

  private reset(): void {
    this.errors = 0;
    this.safety = 0;
    this.maxDriftSeen = 0;
    this.total = 0;
  }

  errorRate(): number {
    return this.total === 0 ? 0 : round(this.errors / this.total);
  }
  safetyRate(): number {
    return this.total === 0 ? 0 : round(this.safety / this.total);
  }
  maxDrift(): number {
    return round(this.maxDriftSeen);
  }

  // Record an observation and return a transition if the state changed.
  record(obs: Observation, now: number): BreakerTransition | null {
    // If open, a request shouldn't normally be recorded (agent suspended), but if
    // the cooldown has elapsed we move to half-open first.
    if (this.state === "open" && this.trippedAt !== null && now - this.trippedAt >= this.thresholds.cooldownMs) {
      return this.transition("half_open", now, "cooldown elapsed; probing");
    }
    if (this.state === "open") {
      return null; // still cooling down; caller should not be sending traffic
    }

    this.total += 1;
    if (!obs.ok) this.errors += 1;
    if (obs.safetyViolation) this.safety += 1;
    if (obs.driftSeverity > this.maxDriftSeen) this.maxDriftSeen = obs.driftSeverity;

    if (this.state === "half_open") {
      // A single probe decides: clean closes, bad re-trips.
      if (obs.ok && !obs.safetyViolation && obs.driftSeverity <= this.thresholds.maxDriftSeverity) {
        const t = this.transition("closed", now, "probe succeeded");
        this.reset();
        return t;
      }
      return this.transition("open", now, "probe failed; re-tripping");
    }

    // closed: evaluate thresholds once we have enough observations.
    if (this.total >= this.thresholds.minObservations) {
      const reason = this.breachReason();
      if (reason !== null) {
        return this.transition("open", now, reason);
      }
    }
    return null;
  }

  private breachReason(): string | null {
    if (this.errorRate() > this.thresholds.maxErrorRate) {
      return `error rate ${this.errorRate()} > ${this.thresholds.maxErrorRate}`;
    }
    if (this.safetyRate() > this.thresholds.maxSafetyViolationRate) {
      return `safety-violation rate ${this.safetyRate()} > ${this.thresholds.maxSafetyViolationRate}`;
    }
    if (this.maxDrift() > this.thresholds.maxDriftSeverity) {
      return `drift severity ${this.maxDrift()} > ${this.thresholds.maxDriftSeverity}`;
    }
    return null;
  }

  private transition(to: BreakerState, now: number, reason: string): BreakerTransition {
    const from = this.state;
    this.state = to;
    this.lastReason = reason;
    if (to === "open") this.trippedAt = now;
    if (to === "closed") this.trippedAt = null;
    return { agentId: this.agentId, from, to, at: now, reason };
  }

  // Manual operator reset: force closed and clear counters.
  manualReset(now: number): BreakerTransition {
    const t = this.transition("closed", now, "manual reset by operator");
    this.reset();
    return t;
  }

  snapshot(): BreakerSnapshot {
    return {
      agentId: this.agentId,
      state: this.state,
      observations: this.total,
      errorRate: this.errorRate(),
      safetyViolationRate: this.safetyRate(),
      maxDrift: this.maxDrift(),
      trippedAt: this.trippedAt,
      lastReason: this.lastReason,
    };
  }
}

// Manages breakers for many agents and records the transition history.
export class CircuitBreakerManager {
  private readonly breakers = new Map<string, AgentBreaker>();
  private readonly history: BreakerTransition[] = [];

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly thresholds: BreakerThresholds = DEFAULT_THRESHOLDS,
  ) {}

  private breakerFor(agentId: string): AgentBreaker {
    let b = this.breakers.get(agentId);
    if (!b) {
      b = new AgentBreaker(agentId, this.thresholds);
      this.breakers.set(agentId, b);
    }
    return b;
  }

  // Record an agent observation; returns a transition if the breaker changed state.
  record(agentId: string, obs: Observation): BreakerTransition | null {
    const t = this.breakerFor(agentId).record(obs, this.now());
    if (t) this.history.push(t);
    return t;
  }

  // Whether the agent may currently serve traffic (closed or half-open probe).
  allows(agentId: string): boolean {
    const b = this.breakers.get(agentId);
    if (!b) return true; // unknown agent: not contained
    return b.state !== "open";
  }

  state(agentId: string): BreakerState {
    return this.breakers.get(agentId)?.state ?? "closed";
  }

  snapshot(agentId: string): BreakerSnapshot | null {
    return this.breakers.get(agentId)?.snapshot() ?? null;
  }

  // Operator action: manually reset (un-trip) an agent's breaker.
  reset(agentId: string): BreakerTransition | null {
    const b = this.breakers.get(agentId);
    if (!b) return null;
    const t = b.manualReset(this.now());
    this.history.push(t);
    return t;
  }

  // All transitions in order (defensive copy) — the audit trail of containment.
  transitions(): BreakerTransition[] {
    return [...this.history];
  }

  // Agents currently tripped open (operator dashboard).
  trippedAgents(): string[] {
    return [...this.breakers.values()]
      .filter((b) => b.state === "open")
      .map((b) => b.agentId)
      .sort((a, b) => a.localeCompare(b));
  }
}
