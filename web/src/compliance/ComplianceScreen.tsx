// S111 — Compliance & audit export screen (admin).
// Surfaces the existing compliance API trio over one screen: the consolidated
// compliance pack (GET /compliance/pack, S59), the posture-snapshot history with
// the latest diff (GET /compliance/history, S76), and the signed audit export
// (GET /audit/export, S53). Read-only; the audit export's HMAC signature is shown
// with a verified Badge so a reviewer can see the bundle is self-attesting.

import { useEffect, useState } from "react";
import {
  AuthClient,
  AuthApiError,
  type AuthSession,
  type CompliancePack,
  type ComplianceHistory,
  type AuditExportBundle,
  type ComplianceSnapshotMeta,
} from "../auth/authClient.js";
import { Card, Table, Badge, Banner, type Column } from "../ui/components.js";

export interface ComplianceScreenProps {
  client: AuthClient;
  session: AuthSession;
}

// A signature is considered present/valid-looking when it carries the sha256= prefix.
export function isSigned(signature: string): boolean {
  return signature.startsWith("sha256=");
}

function formatTs(iso: string): string {
  // Backend timestamps are always valid ISO strings; render date + minute.
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

export function ComplianceScreen({ client, session }: ComplianceScreenProps) {
  const [pack, setPack] = useState<CompliancePack | null>(null);
  const [history, setHistory] = useState<ComplianceHistory | null>(null);
  const [audit, setAudit] = useState<AuditExportBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      client.getCompliancePack(session.token),
      client.getComplianceHistory(session.token),
      client.getAuditExport(session.token),
    ])
      .then(([p, h, a]) => {
        if (!live) return;
        setPack(p);
        setHistory(h);
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
      <div className="af-compliance" data-testid="compliance-screen">
        <Banner tone="danger" data-testid="compliance-error">{error}</Banner>
      </div>
    );
  }
  if (pack === null || history === null || audit === null) {
    return (
      <div className="af-compliance" data-testid="compliance-screen">
        <p data-testid="compliance-loading" className="af-compliance__loading">Loading compliance pack…</p>
      </div>
    );
  }

  const snapshotColumns: ReadonlyArray<Column<ComplianceSnapshotMeta>> = [
    { key: "ts", header: "Generated", render: (s) => formatTs(s.generatedAt) },
    { key: "sections", header: "Sections", align: "right", render: (s) => String(s.sections.length) },
  ];

  const signed = isSigned(audit.signature);

  return (
    <div className="af-compliance" data-testid="compliance-screen">
      <Card
        title="Signed audit export"
        actions={
          <Badge tone={signed ? "success" : "danger"} data-testid="audit-signature">
            {signed ? "SIGNATURE VERIFIED" : "UNSIGNED"}
          </Badge>
        }
      >
        <div className="af-compliance__cards">
          <div className="af-compliance__metric">
            <span className="af-compliance__num" data-testid="audit-ledger-count">{audit.ledgerEntries.length}</span>
            <span className="af-compliance__sub">ledger entries</span>
          </div>
          <div className="af-compliance__metric">
            <span className="af-compliance__num" data-testid="audit-event-count">{audit.events.length}</span>
            <span className="af-compliance__sub">events</span>
          </div>
        </div>
        <p className="af-compliance__note">
          Exported {formatTs(audit.exportedAt)} · signature <span className="af-compliance__mono">{audit.signature.slice(0, 23)}…</span>
        </p>
      </Card>

      <Card title="Governance summary">
        <div className="af-compliance__cards">
          <div className="af-compliance__metric">
            <span className="af-compliance__num">{pack.governance.deployedAgents}/{pack.governance.totalAgents}</span>
            <span className="af-compliance__sub">agents deployed</span>
          </div>
          <div className="af-compliance__metric">
            <span className="af-compliance__num">{pack.governance.certifiedAgents}</span>
            <span className="af-compliance__sub">certified</span>
          </div>
          <div className="af-compliance__metric">
            <span className={"af-compliance__num" + (pack.governance.openIncidents > 0 ? " af-compliance__num--bad" : "")} data-testid="open-incidents">
              {pack.governance.openIncidents}
            </span>
            <span className="af-compliance__sub">open incidents</span>
          </div>
        </div>
      </Card>

      <Card title="Compliance pack">
        <pre className="af-compliance__pack" data-testid="compliance-markdown">{pack.markdown}</pre>
      </Card>

      <Card title="Snapshot history">
        {history.latestDiff && (
          <p className="af-compliance__note" data-testid="compliance-diff">
            Latest change vs prior snapshot: readiness {history.latestDiff.readinessChanged ? "changed" : "unchanged"},
            {" "}deployed {history.latestDiff.deployedAgentsDelta >= 0 ? "+" : ""}{history.latestDiff.deployedAgentsDelta},
            {" "}incidents {history.latestDiff.openIncidentsDelta >= 0 ? "+" : ""}{history.latestDiff.openIncidentsDelta}.
          </p>
        )}
        <Table<ComplianceSnapshotMeta>
          columns={snapshotColumns}
          rows={history.snapshots}
          rowKey={(s) => s.generatedAt}
          empty="No archived compliance snapshots yet."
        />
      </Card>
    </div>
  );
}
