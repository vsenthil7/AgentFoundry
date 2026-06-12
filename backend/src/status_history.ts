// S72 — Platform status history.
// Retains a bounded series of consolidated platform-status reports (S45) over
// time and derives a simple trend (improving / stable / worsening) plus uptime
// of the platform state itself. Turns the point-in-time operator view into a
// short-horizon time series for dashboards and post-incident review.

import type { PlatformStatusReport, PlatformState } from "./platform_status.js";

export type StatusTrend = "improving" | "stable" | "worsening";

const RANK: Record<PlatformState, number> = { healthy: 0, degraded: 1, down: 2 };

export interface StatusHistorySummary {
  samples: number;
  current: PlatformState | null;
  trend: StatusTrend;
  // Fraction of samples in each state.
  healthyFraction: number;
  degradedFraction: number;
  downFraction: number;
}

export class PlatformStatusHistory {
  private readonly reports: PlatformStatusReport[] = [];
  private readonly maxSamples: number;

  constructor(maxSamples = 100) {
    if (maxSamples <= 0) throw new Error("maxSamples must be positive.");
    this.maxSamples = maxSamples;
  }

  record(report: PlatformStatusReport): void {
    this.reports.push(report);
    while (this.reports.length > this.maxSamples) {
      this.reports.shift();
    }
  }

  list(): readonly PlatformStatusReport[] {
    return this.reports;
  }

  count(): number {
    return this.reports.length;
  }

  summary(): StatusHistorySummary {
    const n = this.reports.length;
    if (n === 0) {
      return { samples: 0, current: null, trend: "stable", healthyFraction: 0, degradedFraction: 0, downFraction: 0 };
    }

    let healthy = 0;
    let degraded = 0;
    let down = 0;
    for (const r of this.reports) {
      if (r.state === "healthy") healthy++;
      else if (r.state === "degraded") degraded++;
      else down++;
    }

    const current = this.reports[n - 1].state;
    const first = this.reports[0].state;
    // Trend: compare current rank to first rank (lower rank = healthier).
    let trend: StatusTrend = "stable";
    if (RANK[current] < RANK[first]) trend = "improving";
    else if (RANK[current] > RANK[first]) trend = "worsening";

    return {
      samples: n,
      current,
      trend,
      healthyFraction: healthy / n,
      degradedFraction: degraded / n,
      downFraction: down / n,
    };
  }
}
