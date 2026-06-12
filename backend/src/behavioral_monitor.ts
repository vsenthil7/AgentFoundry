// S42 — Agent behavioral anomaly detection.
// Detects quality/safety regressions and behavioral drift in a deployed agent by
// comparing live scorecards against the approved baseline. Distinct from usage
// anomalies (S36): this watches the agent's *behavior*, not its consumption.

import type { ScoreCard } from "./scoring.js";

export type DriftDimension =
  | "groundedAccuracy"
  | "safetyPassRate"
  | "consistencyScore"
  | "weightedScore"
  | "piiExposure"
  | "toolScopeRisk";

export type BehavioralDriftSeverity = "none" | "minor" | "major" | "critical";

export interface BehavioralDriftFinding {
  dimension: DriftDimension;
  baseline: number;
  observed: number;
  delta: number; // observed - baseline
  severity: BehavioralDriftSeverity;
}

export interface BehavioralDriftReport {
  agentId: string;
  findings: BehavioralDriftFinding[];
  worstSeverity: BehavioralDriftSeverity;
  regressed: boolean; // true if any major/critical regression
}

export interface BehavioralDriftThresholds {
  // Drop (for "higher is better" metrics) that triggers each severity.
  minorDrop: number;
  majorDrop: number;
  criticalDrop: number;
}

export const DEFAULT_BEHAVIORAL_DRIFT_THRESHOLDS: BehavioralDriftThresholds = {
  minorDrop: 0.02,
  majorDrop: 0.05,
  criticalDrop: 0.1,
};

// Metrics where lower is better (a RISE is the regression).
const LOWER_IS_BETTER: Set<DriftDimension> = new Set(["piiExposure", "toolScopeRisk"]);

const SEVERITY_RANK: Record<BehavioralDriftSeverity, number> = { none: 0, minor: 1, major: 2, critical: 3 };

function severityFor(adverseDelta: number, t: BehavioralDriftThresholds): BehavioralDriftSeverity {
  // adverseDelta is the magnitude of regression (always >= 0 when bad).
  if (adverseDelta >= t.criticalDrop) return "critical";
  if (adverseDelta >= t.majorDrop) return "major";
  if (adverseDelta >= t.minorDrop) return "minor";
  return "none";
}

export class BehavioralMonitor {
  private readonly thresholds: BehavioralDriftThresholds;
  // agentId -> approved baseline scorecard.
  private readonly baselines = new Map<string, ScoreCard>();

  constructor(thresholds: BehavioralDriftThresholds = DEFAULT_BEHAVIORAL_DRIFT_THRESHOLDS) {
    this.thresholds = thresholds;
  }

  // Record the approved baseline (captured at promotion time).
  setBaseline(agentId: string, card: ScoreCard): void {
    this.baselines.set(agentId, card);
  }

  hasBaseline(agentId: string): boolean {
    return this.baselines.has(agentId);
  }

  // Compare a live scorecard against the baseline and report drift.
  analyze(agentId: string, observed: ScoreCard): BehavioralDriftReport {
    const baseline = this.baselines.get(agentId);
    if (!baseline) {
      throw new Error(`No baseline recorded for agent: ${agentId}`);
    }

    const dimensions: DriftDimension[] = [
      "groundedAccuracy",
      "safetyPassRate",
      "consistencyScore",
      "weightedScore",
      "piiExposure",
      "toolScopeRisk",
    ];

    const findings: BehavioralDriftFinding[] = dimensions.map((dim) => {
      const b = baseline[dim];
      const o = observed[dim];
      const delta = o - b;
      // Adverse change: a drop for higher-is-better, a rise for lower-is-better.
      const adverse = LOWER_IS_BETTER.has(dim) ? delta : -delta;
      const severity = adverse > 0 ? severityFor(adverse, this.thresholds) : "none";
      return { dimension: dim, baseline: b, observed: o, delta, severity };
    });

    const worstSeverity = findings.reduce<BehavioralDriftSeverity>(
      (worst, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst] ? f.severity : worst),
      "none",
    );
    const regressed = SEVERITY_RANK[worstSeverity] >= SEVERITY_RANK["major"];

    return { agentId, findings, worstSeverity, regressed };
  }

  // Only the findings that represent a regression (severity > none), worst first.
  regressions(report: BehavioralDriftReport): BehavioralDriftFinding[] {
    return report.findings
      .filter((f) => f.severity !== "none")
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  }
}
