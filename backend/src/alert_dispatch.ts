// S38 — Alert dispatch.
// Routes usage alerts (S36) to notification channels (S16) so they actually
// reach an operator. Deduplicates repeat alerts within a window and routes by
// severity to different recipients (e.g. warnings -> ops, critical -> on-call).

import type { UsageAlert, AlertSeverity } from "./usage_alerts.js";
import type { NotificationChannel } from "./notifications.js";

export interface AlertRouting {
  // Recipient per severity.
  recipients: Record<AlertSeverity, string>;
}

export const DEFAULT_ALERT_ROUTING: AlertRouting = {
  recipients: { info: "ops", warning: "ops", critical: "on-call" },
};

export interface DispatchResult {
  dispatched: number;
  suppressed: number;
}

export class AlertDispatcher {
  private readonly channel: NotificationChannel;
  private readonly routing: AlertRouting;
  private readonly now: () => string;
  // Dedup keys already dispatched (tenant:resource:kind:severity).
  private readonly seen = new Set<string>();

  constructor(
    channel: NotificationChannel,
    routing: AlertRouting = DEFAULT_ALERT_ROUTING,
    now: () => string = () => new Date(0).toISOString(),
  ) {
    this.channel = channel;
    this.routing = routing;
    this.now = now;
  }

  private key(a: UsageAlert): string {
    return `${a.tenantId}:${a.resource}:${a.kind}:${a.severity}`;
  }

  // Dispatch a batch of alerts; suppresses duplicates already seen.
  dispatch(alerts: UsageAlert[]): DispatchResult {
    let dispatched = 0;
    let suppressed = 0;
    // Deterministic order: severity (critical first) then resource.
    const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
    const sorted = [...alerts].sort(
      (a, b) => order[a.severity] - order[b.severity] || a.resource.localeCompare(b.resource),
    );
    for (const alert of sorted) {
      const k = this.key(alert);
      if (this.seen.has(k)) {
        suppressed++;
        continue;
      }
      this.seen.add(k);
      this.channel.send({
        to: this.routing.recipients[alert.severity],
        subject: `[${alert.severity.toUpperCase()}] ${alert.kind} · ${alert.tenantId}/${alert.resource}`,
        body: alert.message,
        timestamp: this.now(),
      });
      dispatched++;
    }
    return { dispatched, suppressed };
  }

  // Clear dedup state (e.g. at the start of a new evaluation window).
  resetWindow(): void {
    this.seen.clear();
  }
}
