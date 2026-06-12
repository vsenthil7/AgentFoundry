// S43 — Platform health.
// Aggregates the health of platform subsystems into a single report (the kind a
// /healthz or status page consumes). Each probe is a small function returning a
// component status; the aggregate is degraded if any component is degraded and
// down if any critical component is down.

export type ComponentState = "healthy" | "degraded" | "down";

export interface ComponentHealth {
  name: string;
  state: ComponentState;
  detail?: string;
  critical: boolean; // a down critical component makes the whole platform "down"
}

export interface HealthReport {
  state: ComponentState;
  components: ComponentHealth[];
  healthyCount: number;
  checkedAt: string;
}

export type HealthProbe = () => ComponentHealth;

const STATE_RANK: Record<ComponentState, number> = { healthy: 0, degraded: 1, down: 2 };

export class HealthAggregator {
  private readonly probes: HealthProbe[] = [];
  private readonly now: () => string;

  constructor(now: () => string = () => new Date(0).toISOString()) {
    this.now = now;
  }

  register(probe: HealthProbe): this {
    this.probes.push(probe);
    return this;
  }

  report(): HealthReport {
    const components = this.probes
      .map((p) => p())
      .sort((a, b) => a.name.localeCompare(b.name));

    let state: ComponentState = "healthy";
    for (const c of components) {
      // A down critical component fails the whole platform.
      if (c.state === "down" && c.critical) {
        state = "down";
        break;
      }
      // Otherwise track the worst non-fatal state (degraded).
      if (STATE_RANK[c.state] > STATE_RANK[state] && c.state !== "down") {
        state = c.state;
      }
      // A down non-critical component degrades (not fails) the platform.
      if (c.state === "down" && !c.critical) {
        state = "degraded";
      }
    }

    return {
      state,
      components,
      healthyCount: components.filter((c) => c.state === "healthy").length,
      checkedAt: this.now(),
    };
  }
}

// ---- Standard probes for AgentFoundry subsystems ----

export interface ReplicationStatusLike {
  primaryUp: boolean;
  healthyReplicas: number;
  replicaCount: number;
  lag: number;
}

export function replicationProbe(status: () => ReplicationStatusLike): HealthProbe {
  return () => {
    const s = status();
    if (!s.primaryUp && s.healthyReplicas === 0) {
      return { name: "storage", state: "down", critical: true, detail: "no healthy node" };
    }
    if (!s.primaryUp) {
      return { name: "storage", state: "degraded", critical: true, detail: "primary down; serving from replica" };
    }
    if (s.lag > 0 || s.healthyReplicas < s.replicaCount) {
      return { name: "storage", state: "degraded", critical: true, detail: `lag=${s.lag}, replicas ${s.healthyReplicas}/${s.replicaCount}` };
    }
    return { name: "storage", state: "healthy", critical: true };
  };
}

export function queueDepthProbe(name: string, depth: () => number, warnAt: number): HealthProbe {
  return () => {
    const d = depth();
    return {
      name,
      state: d > warnAt ? "degraded" : "healthy",
      critical: false,
      detail: `depth=${d}`,
    };
  };
}
