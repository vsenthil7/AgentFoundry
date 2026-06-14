// S110 — SLA / uptime screen (admin).
// Surfaces the S51 SlaTracker over HTTP (GET /sla): per-agent realized uptime
// against the target, error budget remaining, and a breach flag. Read-only.
// Wired through the injectable AuthClient and built on the design-system primitives.

import { useEffect, useState } from "react";
import {
  AuthClient,
  AuthApiError,
  type AuthSession,
  type SlaAgentRow,
} from "../auth/authClient.js";
import { Card, Table, Badge, Banner, type Column } from "../ui/components.js";

export interface SlaScreenProps {
  client: AuthClient;
  session: AuthSession;
}

// Fraction (0..1) -> percentage string with three decimals (e.g. 0.999 -> "99.900%").
export function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(3)}%`;
}

// Milliseconds -> a compact human duration (days / hours / minutes).
export function formatDuration(ms: number): string {
  const sign = ms < 0 ? "−" : "";
  const abs = Math.abs(ms);
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  const min = 60 * 1000;
  if (abs >= day) return `${sign}${(abs / day).toFixed(1)}d`;
  if (abs >= hour) return `${sign}${(abs / hour).toFixed(1)}h`;
  if (abs >= min) return `${sign}${(abs / min).toFixed(1)}m`;
  return `${sign}${abs}ms`;
}

export function SlaScreen({ client, session }: SlaScreenProps) {
  const [agents, setAgents] = useState<SlaAgentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    client
      .getSlaReport(session.token)
      .then((r) => {
        if (!live) return;
        setAgents(r.agents);
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof AuthApiError ? err.message : "Request failed — try again.");
      });
    return () => {
      live = false;
    };
  }, [client, session.token]);

  const columns: ReadonlyArray<Column<SlaAgentRow>> = [
    { key: "agent", header: "Agent", render: (a) => <span className="af-sla__mono">{a.agentId}</span> },
    {
      key: "uptime",
      header: "Uptime",
      align: "right",
      render: (a) => (
        <Badge tone={a.breached ? "danger" : "success"} data-testid={`sla-uptime-${a.agentId}`}>
          {formatPct(a.uptime)}
        </Badge>
      ),
    },
    { key: "target", header: "Target", align: "right", render: (a) => formatPct(a.target) },
    {
      key: "budget",
      header: "Error budget",
      align: "right",
      render: (a) => (
        <span className={a.errorBudgetMsRemaining < 0 ? "af-sla__over" : undefined}>
          {formatDuration(a.errorBudgetMsRemaining)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      render: (a) => (
        <Badge tone={a.breached ? "danger" : "success"}>{a.breached ? "BREACHED" : "MEETING SLA"}</Badge>
      ),
    },
  ];

  return (
    <div className="af-sla" data-testid="sla-screen">
      <Card title="SLA & uptime">
        {error && <Banner tone="danger" data-testid="sla-error" className="af-sla__banner">{error}</Banner>}
        <p className="af-sla__note">
          Realized availability per deployed agent against its target, with the remaining error budget for the measurement window.
        </p>
        {agents === null && !error ? (
          <p data-testid="sla-loading" className="af-sla__loading">Loading SLA report…</p>
        ) : (
          <Table<SlaAgentRow> columns={columns} rows={agents ?? []} rowKey={(a) => a.agentId} empty="No SLA-tracked agents for this tenant." />
        )}
      </Card>
    </div>
  );
}
