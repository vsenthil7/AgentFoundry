// S102 — Tenant-health / observability dashboard (admin + ops).
// Composes the consolidated platform status (GET /status) with the API audit
// summary (GET /audit/api) into a single operator view: overall state, agent
// deployment, pending reviews, drift regressions, billing, operator flags, and
// API error-rate / latency. Wired through the injectable AuthClient.

import { useEffect, useState } from "react";
import {
  AuthClient,
  AuthApiError,
  type AuthSession,
  type PlatformStatusReport,
  type PlatformState,
  type AuditTrail,
} from "../auth/authClient.js";
import { Card, Badge, Banner, type BadgeTone } from "../ui/components.js";

export interface HealthDashboardProps {
  client: AuthClient;
  session: AuthSession;
}

const STATE_TONE: Record<PlatformState, BadgeTone> = {
  healthy: "success",
  degraded: "warn",
  down: "danger",
};

function pct(n: number, d: number): number {
  if (d <= 0) return 0;
  return Math.round((n / d) * 100);
}

function avgLatency(trail: AuditTrail): number {
  if (trail.calls.length === 0) return 0;
  const total = trail.calls.reduce((s, c) => s + c.latencyMs, 0);
  return Math.round(total / trail.calls.length);
}

export function HealthDashboard({ client, session }: HealthDashboardProps) {
  const [status, setStatus] = useState<PlatformStatusReport | null>(null);
  const [audit, setAudit] = useState<AuditTrail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([client.getStatus(session.token), client.getAuditTrail(session.token)])
      .then(([s, a]) => {
        if (!live) return;
        setStatus(s);
        setAudit(a);
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
      <div className="af-dash" data-testid="dashboard-screen">
        <Banner tone="danger" data-testid="dashboard-error">{error}</Banner>
      </div>
    );
  }
  if (status === null || audit === null) {
    return (
      <div className="af-dash" data-testid="dashboard-screen">
        <p data-testid="dashboard-loading" className="af-dash__loading">Loading platform health…</p>
      </div>
    );
  }

  const deployedPct = pct(status.agents.deployed, status.agents.total);
  const billingDollars = (status.billing.periodTotalMinor / 100).toFixed(2);
  const errorRatePct = (audit.summary.errorRate * 100).toFixed(1);

  return (
    <div className="af-dash" data-testid="dashboard-screen">
      <Card
        title="Platform health"
        actions={<Badge tone={STATE_TONE[status.state]} data-testid="dash-state">{status.state.toUpperCase()}</Badge>}
      >
        <p className="af-dash__summary" data-testid="dash-summary">{status.summary}</p>

        <div className="af-dash__bar" data-testid="dash-deployed">
          <div className="af-dash__bar-head">
            <span>Agents deployed</span>
            <span>{status.agents.deployed} / {status.agents.total} ({deployedPct}%)</span>
          </div>
          <div className="af-dash__track">
            <div className="af-dash__fill" style={{ width: `${deployedPct}%` }} />
          </div>
        </div>

        <div className="af-dash__bar" data-testid="dash-health">
          <div className="af-dash__bar-head">
            <span>Healthy components</span>
            <span>{status.health.healthyCount} / {status.health.totalComponents}</span>
          </div>
          <div className="af-dash__track">
            <div className="af-dash__fill" style={{ width: `${pct(status.health.healthyCount, status.health.totalComponents)}%` }} />
          </div>
        </div>
      </Card>

      <div className="af-dash__cards">
        <Card title="Pending reviews">
          <div className="af-dash__metric" data-testid="dash-reviews">{status.reviews.pending}</div>
          <span className="af-dash__metric-sub">awaiting human promotion</span>
        </Card>
        <Card title="Drift regressions">
          <div className={"af-dash__metric" + (status.drift.regressions > 0 ? " af-dash__metric--bad" : "")} data-testid="dash-regressions">
            {status.drift.regressions}
          </div>
          <span className="af-dash__metric-sub">of {status.drift.agentsScanned} scanned</span>
        </Card>
        <Card title="Billing (period)">
          <div className="af-dash__metric" data-testid="dash-billing">{billingDollars} {status.billing.currency}</div>
          <span className="af-dash__metric-sub">{status.billing.tenantsBilled} tenant(s)</span>
        </Card>
      </div>

      <Card title="API traffic">
        <div className="af-dash__apirow">
          <div>
            <div className={"af-dash__metric" + (audit.summary.errors > 0 ? " af-dash__metric--bad" : "")} data-testid="dash-errorrate">{errorRatePct}%</div>
            <span className="af-dash__metric-sub">error rate · {audit.summary.errors}/{audit.summary.total} calls</span>
          </div>
          <div>
            <div className="af-dash__metric" data-testid="dash-latency">{avgLatency(audit)}ms</div>
            <span className="af-dash__metric-sub">avg latency</span>
          </div>
        </div>
      </Card>

      {status.flags.length > 0 && (
        <Card title="Operator attention" data-testid="dash-flags">
          {status.flags.map((f, i) => (
            <Banner key={i} tone={i === 0 && status.state === "down" ? "danger" : "warn"} className="af-dash__flag" data-testid={`dash-flag-${i}`}>
              {f}
            </Banner>
          ))}
        </Card>
      )}
      {status.flags.length === 0 && (
        <Banner tone="success" data-testid="dash-allclear" className="af-dash__flag">
          No operator flags — platform nominal.
        </Banner>
      )}
    </div>
  );
}
