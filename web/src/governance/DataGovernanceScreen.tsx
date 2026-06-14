// S113 — Data residency & retention screen (admin).
// Surfaces the S19 DataGovernance engine over HTTP (GET /governance/data): the
// tenant's allowed residency regions, the record count per region (residency
// report), and the retention policy (days per data class; 0/absent = indefinite).
// Read-only. Wired through the injectable AuthClient + design-system primitives.

import { useEffect, useState } from "react";
import {
  AuthClient,
  AuthApiError,
  type AuthSession,
  type DataGovernanceView,
  type DataRegion,
} from "../auth/authClient.js";
import { Card, Table, Badge, Banner, type Column } from "../ui/components.js";

export interface DataGovernanceScreenProps {
  client: AuthClient;
  session: AuthSession;
}

const ALL_REGIONS: DataRegion[] = ["us", "eu", "uk", "apac"];

interface RegionRow {
  region: DataRegion;
  records: number;
  allowed: boolean;
}

interface RetentionRow {
  dataClass: string;
  days: number;
}

// Build the residency rows: every region the tenant has records in OR allows,
// each annotated with its record count and whether it is an allowed region.
export function residencyRows(view: DataGovernanceView): RegionRow[] {
  const regions = new Set<DataRegion>(view.allowedRegions);
  for (const r of Object.keys(view.residency)) regions.add(r as DataRegion);
  return ALL_REGIONS.filter((r) => regions.has(r)).map((region) => ({
    region,
    records: view.residency[region] ?? 0,
    allowed: view.allowedRegions.includes(region),
  }));
}

export function retentionRows(view: DataGovernanceView): RetentionRow[] {
  return Object.entries(view.retentionDays)
    .map(([dataClass, days]) => ({ dataClass, days }))
    .sort((a, b) => a.dataClass.localeCompare(b.dataClass));
}

export function DataGovernanceScreen({ client, session }: DataGovernanceScreenProps) {
  const [view, setView] = useState<DataGovernanceView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    client
      .getDataGovernance(session.token)
      .then((v) => {
        if (!live) return;
        setView(v);
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
      <div className="af-gov" data-testid="governance-screen">
        <Banner tone="danger" data-testid="governance-error">{error}</Banner>
      </div>
    );
  }
  if (view === null) {
    return (
      <div className="af-gov" data-testid="governance-screen">
        <p data-testid="governance-loading" className="af-gov__loading">Loading data governance…</p>
      </div>
    );
  }

  const regionColumns: ReadonlyArray<Column<RegionRow>> = [
    { key: "region", header: "Region", render: (r) => r.region.toUpperCase() },
    { key: "records", header: "Records", align: "right", render: (r) => <span data-testid={`gov-records-${r.region}`}>{r.records}</span> },
    {
      key: "allowed",
      header: "Residency",
      align: "right",
      render: (r) => (
        <Badge tone={r.allowed ? "success" : "danger"} data-testid={`gov-allowed-${r.region}`}>
          {r.allowed ? "ALLOWED" : "NOT ALLOWED"}
        </Badge>
      ),
    },
  ];

  const retentionColumns: ReadonlyArray<Column<RetentionRow>> = [
    { key: "class", header: "Data class", render: (r) => <span className="af-gov__mono">{r.dataClass}</span> },
    {
      key: "days",
      header: "Retention",
      align: "right",
      render: (r) =>
        r.days > 0 ? (
          <span data-testid={`gov-retention-${r.dataClass}`}>{r.days} days</span>
        ) : (
          <Badge tone="neutral" data-testid={`gov-retention-${r.dataClass}`}>INDEFINITE</Badge>
        ),
    },
  ];

  return (
    <div className="af-gov" data-testid="governance-screen">
      <Card title="Data residency">
        <p className="af-gov__note">
          Allowed regions for this tenant's data and where records currently reside. Placement outside an allowed region is rejected at write time.
        </p>
        <Table<RegionRow> columns={regionColumns} rows={residencyRows(view)} rowKey={(r) => r.region} empty="No residency regions configured." />
      </Card>

      <Card title="Retention policy">
        <p className="af-gov__note">
          How long each data class is retained before deterministic purge. Indefinite classes are never auto-purged.
        </p>
        <Table<RetentionRow> columns={retentionColumns} rows={retentionRows(view)} rowKey={(r) => r.dataClass} empty="No retention policy configured." />
      </Card>
    </div>
  );
}
