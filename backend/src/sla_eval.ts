// S54 — Scheduled SLA evaluation.
// A scheduler job (S26) that periodically evaluates each tracked agent's SLA over
// a rolling window (S51) and dispatches a breach alert (S16) when realized uptime
// falls below target. Complements drift (S44) and usage (S38) alerting with
// availability alerting.

import type { SlaTracker, SlaReport } from "./sla.js";
import type { NotificationChannel } from "./notifications.js";
import type { JobDefinition } from "./scheduler.js";

export interface SlaEvalTarget {
  agentId: string;
}

export interface SlaEvalDeps {
  tracker: SlaTracker;
  channel: NotificationChannel;
  targets: () => SlaEvalTarget[];
  // Window length to evaluate, ending at `nowMs`.
  windowMs: number;
  // Current time in epoch ms (injectable).
  nowMs: () => number;
  recipient?: string;
  notifyTimestamp?: () => string;
}

export interface SlaEvalResult {
  evaluated: number;
  breaches: number;
  reports: SlaReport[];
}

// Evaluate all targets once; alert on each breach.
export function runSlaEvaluation(deps: SlaEvalDeps): SlaEvalResult {
  const end = deps.nowMs();
  const start = end - deps.windowMs;
  const recipient = deps.recipient ?? "on-call";
  const ts = deps.notifyTimestamp ?? (() => new Date(end).toISOString());

  const reports: SlaReport[] = [];
  let breaches = 0;
  const targets = [...deps.targets()].sort((a, b) => a.agentId.localeCompare(b.agentId));

  for (const target of targets) {
    const report = deps.tracker.report(target.agentId, start, end);
    reports.push(report);
    if (report.breached) {
      breaches++;
      deps.channel.send({
        to: recipient,
        subject: `[SLA] ${target.agentId} breached SLA`,
        body:
          `Uptime ${(report.uptime * 100).toFixed(4)}% < target ${(report.target * 100).toFixed(2)}% ` +
          `over ${Math.round(report.windowMs / 3600_000)}h; error budget ${Math.round(report.errorBudgetMsRemaining / 60_000)}min.`,
        timestamp: ts(),
      });
    }
  }

  return { evaluated: reports.length, breaches, reports };
}

export function slaEvaluationJob(
  id: string,
  intervalMs: number,
  deps: SlaEvalDeps,
): JobDefinition {
  return {
    id,
    intervalMs,
    task: () => {
      const result = runSlaEvaluation(deps);
      return `evaluated ${result.evaluated} agent(s), ${result.breaches} SLA breach(es)`;
    },
  };
}
