// S45 — Consolidated platform status report.
// A single operator-facing view that composes signals from across the platform:
// health (S42), agent registry counts (S7), review backlog (S16), drift
// regressions (S41/S44), and billing totals (S37). Pure assembly over injected
// providers so it stays decoupled and deterministic.

export type PlatformState = "healthy" | "degraded" | "down";

export interface PlatformStatusInputs {
  health: { state: PlatformState; healthyCount: number; totalComponents: number };
  agents: { total: number; deployed: number; retired: number };
  reviews: { pending: number };
  drift: { agentsScanned: number; regressions: number };
  billing: { tenantsBilled: number; periodTotalMinor: number; currency: string };
  // Optional SLA rollup; when present, breaches escalate state and add a flag.
  sla?: { evaluated: number; breaches: number };
  // Optional config-drift rollup; when present, drifted tenants escalate state.
  configDrift?: { scanned: number; drifted: number };
}

export interface PlatformStatusReport {
  state: PlatformState;
  summary: string;
  health: PlatformStatusInputs["health"];
  agents: PlatformStatusInputs["agents"];
  reviews: PlatformStatusInputs["reviews"];
  drift: PlatformStatusInputs["drift"];
  billing: PlatformStatusInputs["billing"];
  // Operator attention flags, most severe first.
  flags: string[];
  generatedAt: string;
}

export class PlatformStatus {
  private readonly now: () => string;

  constructor(now: () => string = () => new Date(0).toISOString()) {
    this.now = now;
  }

  assemble(inputs: PlatformStatusInputs): PlatformStatusReport {
    const flags: string[] = [];

    // Most severe signals first.
    if (inputs.health.state === "down") {
      flags.push("PLATFORM DOWN: a critical component is unavailable.");
    } else if (inputs.health.state === "degraded") {
      flags.push("Platform degraded: a non-critical component is unhealthy.");
    }
    if (inputs.drift.regressions > 0) {
      flags.push(`${inputs.drift.regressions} agent(s) regressed against baseline.`);
    }
    const slaBreaches = inputs.sla?.breaches ?? 0;
    if (slaBreaches > 0) {
      flags.push(`${slaBreaches} agent(s) breached SLA.`);
    }
    const configDrifted = inputs.configDrift?.drifted ?? 0;
    if (configDrifted > 0) {
      flags.push(`${configDrifted} tenant(s) drifted from config profile.`);
    }
    if (inputs.reviews.pending > 0) {
      flags.push(`${inputs.reviews.pending} promotion(s) awaiting review.`);
    }

    // Overall state is driven by health, escalated by drift regressions, SLA
    // breaches, or config drift.
    let state: PlatformState = inputs.health.state;
    if (state === "healthy" && (inputs.drift.regressions > 0 || slaBreaches > 0 || configDrifted > 0)) {
      state = "degraded";
    }

    const dollars = (inputs.billing.periodTotalMinor / 100).toFixed(2);
    const summary =
      `${state.toUpperCase()} · ${inputs.agents.deployed}/${inputs.agents.total} agents deployed · ` +
      `${inputs.reviews.pending} pending review(s) · ${inputs.drift.regressions} regression(s) · ` +
      `${dollars} ${inputs.billing.currency} billed`;

    return {
      state,
      summary,
      health: inputs.health,
      agents: inputs.agents,
      reviews: inputs.reviews,
      drift: inputs.drift,
      billing: inputs.billing,
      flags,
      generatedAt: this.now(),
    };
  }
}
