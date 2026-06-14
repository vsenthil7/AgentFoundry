// S106 — Secrets & connectors read screen (admin).
// Surfaces the S17 vault over HTTP: per-tenant secret *handles* (masked, never
// plaintext) and connector references (MCP / OpenAPI / A2A). Read-only in this
// sprint — creation/rotation is a documented follow-up. Wired through the
// injectable AuthClient and built on the design-system primitives.

import { useEffect, useState } from "react";
import {
  AuthClient,
  AuthApiError,
  type AuthSession,
  type MaskedSecret,
  type ConnectorDef,
  type ConnectorKind,
} from "../auth/authClient.js";
import { Card, Table, Badge, Banner, type Column, type BadgeTone } from "../ui/components.js";

export interface SecretsScreenProps {
  client: AuthClient;
  session: AuthSession;
}

const KIND_TONE: Record<ConnectorKind, BadgeTone> = {
  mcp: "brand",
  openapi: "info",
  a2a: "neutral",
};

function formatCreated(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toISOString().slice(0, 10);
}

export function SecretsScreen({ client, session }: SecretsScreenProps) {
  const [secrets, setSecrets] = useState<MaskedSecret[] | null>(null);
  const [connectors, setConnectors] = useState<ConnectorDef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([client.listSecrets(session.token), client.listConnectors(session.token)])
      .then(([s, c]) => {
        if (!live) return;
        setSecrets(s.secrets);
        setConnectors(c.connectors);
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof AuthApiError ? err.message : "Request failed — try again.");
      });
    return () => {
      live = false;
    };
  }, [client, session.token]);

  const secretColumns: ReadonlyArray<Column<MaskedSecret>> = [
    { key: "name", header: "Name", render: (s) => s.name },
    { key: "id", header: "ID", render: (s) => <span className="af-secrets__mono">{s.id}</span> },
    { key: "masked", header: "Value", render: (s) => <span className="af-secrets__mono" data-testid={`secret-masked-${s.id}`}>{s.masked}</span> },
    { key: "created", header: "Created", align: "right", render: (s) => formatCreated(s.createdAt) },
  ];

  const connectorColumns: ReadonlyArray<Column<ConnectorDef>> = [
    { key: "name", header: "Name", render: (c) => c.name },
    { key: "kind", header: "Kind", render: (c) => <Badge tone={KIND_TONE[c.kind]}>{c.kind.toUpperCase()}</Badge> },
    { key: "endpoint", header: "Endpoint", render: (c) => <span className="af-secrets__mono">{c.endpoint}</span> },
    { key: "secret", header: "Secret", align: "right", render: (c) => <span className="af-secrets__mono">{c.secretId}</span> },
  ];

  return (
    <div className="af-secrets" data-testid="secrets-screen">
      <Card title="Secrets">
        {error && <Banner tone="danger" data-testid="secrets-error" className="af-secrets__banner">{error}</Banner>}
        <p className="af-secrets__note">
          Values are masked — plaintext is never returned over the API and is resolved only at connector use time.
        </p>
        {secrets === null && !error ? (
          <p data-testid="secrets-loading" className="af-secrets__loading">Loading secrets…</p>
        ) : (
          <Table<MaskedSecret> columns={secretColumns} rows={secrets ?? []} rowKey={(s) => s.id} empty="No secrets stored for this tenant." />
        )}
      </Card>

      <Card title="Connectors">
        {connectors === null && !error ? (
          <p data-testid="connectors-loading" className="af-secrets__loading">Loading connectors…</p>
        ) : (
          <Table<ConnectorDef> columns={connectorColumns} rows={connectors ?? []} rowKey={(c) => c.id} empty="No connectors registered for this tenant." />
        )}
      </Card>
    </div>
  );
}
