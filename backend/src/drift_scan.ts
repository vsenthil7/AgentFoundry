// S44 — Scheduled drift scan.
// Bridges the behavioral monitor (S41), the scheduler (S26), and notification
// channels (S16): a job that periodically re-scores deployed agents against their
// approved baselines and notifies on regressions. This is the continuous quality
// red-teaming the roadmap describes, complementing the usage-anomaly path (S36/S38).

import type { BehavioralMonitor, BehavioralDriftReport } from "./behavioral_monitor.js";
import type { NotificationChannel } from "./notifications.js";
import type { JobDefinition } from "./scheduler.js";
import type { ScoreCard } from "./scoring.js";

export interface DriftScanTarget {
  agentId: string;
  tenantId: string;
  // Re-score the agent now (a real system runs the eval suite; here it's injected).
  rescore: () => ScoreCard;
}

export interface DriftScanDeps {
  monitor: BehavioralMonitor;
  channel: NotificationChannel;
  // Enumerate the deployed agents to scan.
  targets: () => DriftScanTarget[];
  // Recipient for regression notifications.
  recipient?: string;
  now?: () => string;
}

export interface DriftScanResult {
  scanned: number;
  regressions: number;
  reports: BehavioralDriftReport[];
}

// Run a drift scan once across all targets, notifying on regressions.
export function runDriftScan(deps: DriftScanDeps): DriftScanResult {
  const now = deps.now ?? (() => new Date(0).toISOString());
  const recipient = deps.recipient ?? "on-call";
  const reports: BehavioralDriftReport[] = [];
  let regressions = 0;

  const targets = [...deps.targets()].sort((a, b) => a.agentId.localeCompare(b.agentId));
  for (const target of targets) {
    // Skip agents without an approved baseline (never promoted).
    if (!deps.monitor.hasBaseline(target.agentId)) continue;
    const report = deps.monitor.analyze(target.agentId, target.rescore());
    reports.push(report);
    if (report.regressed) {
      regressions++;
      // A regressed report always has a finding at the worst severity.
      const worst = report.findings.find((f) => f.severity === report.worstSeverity)!;
      deps.channel.send({
        to: recipient,
        subject: `[DRIFT] ${target.agentId} regressed (${report.worstSeverity})`,
        body: `${worst.dimension}: baseline ${worst.baseline} -> observed ${worst.observed} (delta ${worst.delta.toFixed(3)}).`,
        timestamp: now(),
      });
    }
  }

  return { scanned: reports.length, regressions, reports };
}

// Build a scheduler job that runs the drift scan on an interval.
export function driftScanJob(
  id: string,
  intervalMs: number,
  deps: DriftScanDeps,
): JobDefinition {
  return {
    id,
    intervalMs,
    task: () => {
      const result = runDriftScan(deps);
      return `scanned ${result.scanned} agent(s), ${result.regressions} regression(s)`;
    },
  };
}
