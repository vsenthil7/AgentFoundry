// S114 — Marketplace browse screen (any authed user).
// Surfaces the S10 Marketplace engine over HTTP (GET /marketplace): the
// platform-wide pack catalog (agent templates / eval packs / red-team packs)
// with publisher, certification tier, and install count. A client-side kind
// filter narrows the catalog. Read-only / browse-only this sprint.

import { useEffect, useMemo, useState } from "react";
import {
  AuthClient,
  AuthApiError,
  type AuthSession,
  type MarketplacePack,
  type PackKind,
  type CertificationTier,
} from "../auth/authClient.js";
import { Card, Table, Badge, Banner, type Column, type BadgeTone } from "../ui/components.js";

export interface MarketplaceScreenProps {
  client: AuthClient;
  session: AuthSession;
}

const TIER_TONE: Record<CertificationTier, BadgeTone> = {
  none: "neutral",
  bronze: "warn",
  silver: "info",
  gold: "success",
};

const KIND_LABEL: Record<PackKind, string> = {
  agent_template: "Agent template",
  eval_pack: "Eval pack",
  redteam_pack: "Red-team pack",
};

export type KindFilter = PackKind | "all";

const FILTERS: ReadonlyArray<{ id: KindFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "agent_template", label: "Agent templates" },
  { id: "eval_pack", label: "Eval packs" },
  { id: "redteam_pack", label: "Red-team packs" },
];

// Filter the catalog by kind; "all" returns everything unchanged.
export function filterByKind(packs: MarketplacePack[], kind: KindFilter): MarketplacePack[] {
  return kind === "all" ? packs : packs.filter((p) => p.kind === kind);
}

export function MarketplaceScreen({ client, session }: MarketplaceScreenProps) {
  const [packs, setPacks] = useState<MarketplacePack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");

  useEffect(() => {
    let live = true;
    client
      .browseMarketplace(session.token)
      .then((c) => {
        if (!live) return;
        setPacks(c.packs);
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof AuthApiError ? err.message : "Request failed — try again.");
      });
    return () => {
      live = false;
    };
  }, [client, session.token]);

  const visible = useMemo(() => filterByKind(packs ?? [], kind), [packs, kind]);

  const columns: ReadonlyArray<Column<MarketplacePack>> = [
    { key: "name", header: "Pack", render: (p) => p.name },
    { key: "kind", header: "Kind", render: (p) => <Badge tone="neutral">{KIND_LABEL[p.kind]}</Badge> },
    { key: "publisher", header: "Publisher", render: (p) => <span className="af-market__mono">{p.publisher}</span> },
    { key: "version", header: "Version", align: "right", render: (p) => <span className="af-market__mono">{p.version}</span> },
    {
      key: "tier",
      header: "Tier",
      align: "right",
      render: (p) => (
        <Badge tone={TIER_TONE[p.certificationTier]} data-testid={`pack-tier-${p.id}`}>
          {p.certificationTier.toUpperCase()}
        </Badge>
      ),
    },
    { key: "installs", header: "Installs", align: "right", render: (p) => <span data-testid={`pack-installs-${p.id}`}>{p.installs}</span> },
  ];

  return (
    <div className="af-market" data-testid="marketplace-screen">
      <Card title="Marketplace">
        {error && <Banner tone="danger" data-testid="marketplace-error" className="af-market__banner">{error}</Banner>}
        <p className="af-market__note">
          Publishable, interoperable packs — agent templates, eval suites, and red-team suites — each carrying a certification tier as a trust signal.
        </p>

        <div className="af-market__filters" role="group" aria-label="Filter by pack kind">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={"af-market__filter" + (kind === f.id ? " af-market__filter--active" : "")}
              aria-pressed={kind === f.id}
              onClick={() => setKind(f.id)}
              data-testid={`market-filter-${f.id}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {packs === null && !error ? (
          <p data-testid="marketplace-loading" className="af-market__loading">Loading catalog…</p>
        ) : (
          <Table<MarketplacePack> columns={columns} rows={visible} rowKey={(p) => p.id} empty="No packs match this filter." />
        )}
      </Card>
    </div>
  );
}
