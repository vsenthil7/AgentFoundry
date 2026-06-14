// S112 — Status history / trend screen (admin + ops).
// The live consolidated status is shown on the HealthDashboard (S102); this
// screen surfaces the *trend over time* from GET /status/history (S75): the
// improving/stable/worsening trend, the current state, and the fraction of
// recorded samples spent in each platform state. Read-only.

import { useEffect, useState } from "react";
import {
  AuthClient,
  AuthApiError,
  type AuthSession,
  type StatusHistorySummary,
  type StatusTrend,
  type PlatformState,
} from "../auth/authClient.js";
import { Card, Badge, Banner, type BadgeTone } from "../ui/components.js";

export interface StatusHistoryScreenProps {
  client: AuthClient;
  session: AuthSession;
}

const TREND_TONE: Record<StatusTrend, BadgeTone> = {
  improving: "success",
  stable: "neutral",
  worsening: "danger",
};

const STATE_TONE: Record<PlatformState, BadgeTone> = {
  healthy: "success",
  degraded: "warn",
  down: "danger",
};

// Fraction (0..1) -> integer-percent label (e.g. 0.5 -> "50%").
export function pctLabel(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function StatusHistoryScreen({ client, session }: StatusHistoryScreenProps) {
  const [summary, setSummary] = useState<StatusHistorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    client
      .getStatusHistory(session.token)
      .then((s) => {
        if (!live) return;
        setSummary(s);
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof AuthApiError ? err.message : "Request failed — try again.");
      });
    return () => {
      live = false;
    };
  }, [client, session.token]);

  if (error) {
    return (
      <div className="af-status" data-testid="status-screen">
        <Banner tone="danger" data-testid="status-error">{error}</Banner>
      </div>
    );
  }
  if (summary === null) {
    return (
      <div className="af-status" data-testid="status-screen">
        <p data-testid="status-loading" className="af-status__loading">Loading status history…</p>
      </div>
    );
  }

  if (summary.samples === 0) {
    return (
      <div className="af-status" data-testid="status-screen">
        <Card title="Platform status trend">
          <p className="af-status__empty" data-testid="status-empty">No status samples recorded yet.</p>
        </Card>
      </div>
    );
  }

  const bars: ReadonlyArray<{ label: string; state: PlatformState; fraction: number }> = [
    { label: "Healthy", state: "healthy", fraction: summary.healthyFraction },
    { label: "Degraded", state: "degraded", fraction: summary.degradedFraction },
    { label: "Down", state: "down", fraction: summary.downFraction },
  ];

  return (
    <div className="af-status" data-testid="status-screen">
      <Card
        title="Platform status trend"
        actions={<Badge tone={TREND_TONE[summary.trend]} data-testid="status-trend">{summary.trend.toUpperCase()}</Badge>}
      >
        <p className="af-status__current">
          Current state{" "}
          {summary.current && (
            <Badge tone={STATE_TONE[summary.current]} data-testid="status-current">{summary.current.toUpperCase()}</Badge>
          )}
          <span className="af-status__samples" data-testid="status-samples">over {summary.samples} samples</span>
        </p>

        <div className="af-status__bars">
          {bars.map((b) => (
            <div className="af-status__bar-row" key={b.state}>
              <span className="af-status__bar-label">{b.label}</span>
              <div className="af-status__track">
                <div
                  className={`af-status__fill af-status__fill--${b.state}`}
                  style={{ width: pctLabel(b.fraction) }}
                  data-testid={`status-fraction-${b.state}`}
                />
              </div>
              <span className="af-status__bar-pct">{pctLabel(b.fraction)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
