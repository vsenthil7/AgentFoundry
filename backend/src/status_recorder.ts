// S74 — Scheduled status recorder.
// A scheduler job (S26) that periodically assembles the consolidated platform
// status (S45) and records it into the status history (S72), so the trend builds
// automatically without manual sampling. Optionally alerts (S16) when the
// recorded state is not healthy.

import type { PlatformStatus, PlatformStatusInputs } from "./platform_status.js";
import type { PlatformStatusHistory } from "./status_history.js";
import type { NotificationChannel } from "./notifications.js";
import type { JobDefinition } from "./scheduler.js";

export interface StatusRecorderDeps {
  status: PlatformStatus;
  history: PlatformStatusHistory;
  // Gather the current inputs to assemble a status report.
  collect: () => PlatformStatusInputs;
  // Optional alerting when the recorded state is degraded/down.
  channel?: NotificationChannel;
  recipient?: string;
  now?: () => string;
}

export interface StatusRecordResult {
  state: string;
  flags: number;
  totalSamples: number;
}

export function runStatusRecord(deps: StatusRecorderDeps): StatusRecordResult {
  const report = deps.status.assemble(deps.collect());
  deps.history.record(report);

  if (deps.channel && report.state !== "healthy") {
    const now = deps.now ?? (() => new Date(0).toISOString());
    deps.channel.send({
      to: deps.recipient ?? "on-call",
      subject: `[STATUS] platform ${report.state}`,
      // A non-healthy state always carries at least one flag.
      body: report.flags.join(" "),
      timestamp: now(),
    });
  }

  return { state: report.state, flags: report.flags.length, totalSamples: deps.history.count() };
}

export function statusRecorderJob(
  id: string,
  intervalMs: number,
  deps: StatusRecorderDeps,
): JobDefinition {
  return {
    id,
    intervalMs,
    task: () => {
      const r = runStatusRecord(deps);
      return `recorded status=${r.state} (${r.flags} flag(s)); ${r.totalSamples} sample(s) in history`;
    },
  };
}
