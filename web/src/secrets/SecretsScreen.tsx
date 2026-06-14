// S106 + S115 — Secrets & connectors screen (admin).
// S106 surfaced the S17 vault read-only (masked handles + connector references).
// S115 promotes it to full management: create a secret (value entered once, never
// re-fetched), rotate a secret's value, and delete a secret (blocked by the API
// when a connector still references it). Plaintext is never returned by the API.

import { useCallback, useEffect, useState } from "react";
import {
  AuthClient,
  AuthApiError,
  type AuthSession,
  type MaskedSecret,
  type ConnectorDef,
  type ConnectorKind,
} from "../auth/authClient.js";
import { Card, Table, Badge, Banner, Button, type Column, type BadgeTone } from "../ui/components.js";

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add-secret form state.
  const [showAdd, setShowAdd] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");

  // Rotate state — the id currently being rotated + its new value.
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [rotateValue, setRotateValue] = useState("");

  const load = useCallback(async () => {
    const [s, c] = await Promise.all([
      client.listSecrets(session.token),
      client.listConnectors(session.token),
    ]);
    setSecrets(s.secrets);
    setConnectors(c.connectors);
  }, [client, session.token]);

  useEffect(() => {
    let live = true;
    load()
      .catch((err) => {
        if (!live) return;
        setError(err instanceof AuthApiError ? err.message : "Request failed — try again.");
      });
    return () => {
      live = false;
    };
  }, [load]);

  const reportAction = (err: unknown) => {
    setActionError(err instanceof AuthApiError ? err.message : "Request failed — try again.");
  };

  const onAdd = async () => {
    setActionError(null);
    setBusy(true);
    try {
      await client.createSecret(session.token, { id: newId.trim(), name: newName.trim(), value: newValue });
      setShowAdd(false);
      setNewId("");
      setNewName("");
      setNewValue("");
      await load();
    } catch (err) {
      reportAction(err);
    } finally {
      setBusy(false);
    }
  };

  const onRotate = async (id: string) => {
    setActionError(null);
    setBusy(true);
    try {
      await client.rotateSecret(session.token, id, rotateValue);
      setRotateId(null);
      setRotateValue("");
      await load();
    } catch (err) {
      reportAction(err);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setActionError(null);
    setBusy(true);
    try {
      await client.deleteSecret(session.token, id);
      await load();
    } catch (err) {
      reportAction(err);
    } finally {
      setBusy(false);
    }
  };

  const secretColumns: ReadonlyArray<Column<MaskedSecret>> = [
    { key: "name", header: "Name", render: (s) => s.name },
    { key: "id", header: "ID", render: (s) => <span className="af-secrets__mono">{s.id}</span> },
    { key: "masked", header: "Value", render: (s) => <span className="af-secrets__mono" data-testid={`secret-masked-${s.id}`}>{s.masked}</span> },
    { key: "created", header: "Created", align: "right", render: (s) => formatCreated(s.createdAt) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (s) => (
        <span className="af-secrets__row-actions">
          <button type="button" className="af-secrets__link" onClick={() => { setRotateId(s.id); setRotateValue(""); setActionError(null); }} data-testid={`secret-rotate-${s.id}`} disabled={busy}>
            Rotate
          </button>
          <button type="button" className="af-secrets__link af-secrets__link--danger" onClick={() => onDelete(s.id)} data-testid={`secret-delete-${s.id}`} disabled={busy}>
            Delete
          </button>
        </span>
      ),
    },
  ];

  const connectorColumns: ReadonlyArray<Column<ConnectorDef>> = [
    { key: "name", header: "Name", render: (c) => c.name },
    { key: "kind", header: "Kind", render: (c) => <Badge tone={KIND_TONE[c.kind]}>{c.kind.toUpperCase()}</Badge> },
    { key: "endpoint", header: "Endpoint", render: (c) => <span className="af-secrets__mono">{c.endpoint}</span> },
    { key: "secret", header: "Secret", align: "right", render: (c) => <span className="af-secrets__mono">{c.secretId}</span> },
  ];

  const addValid = newId.trim() !== "" && newName.trim() !== "" && newValue !== "";

  return (
    <div className="af-secrets" data-testid="secrets-screen">
      <Card
        title="Secrets"
        actions={
          !showAdd ? (
            <Button variant="primary" onClick={() => { setShowAdd(true); setActionError(null); }} data-testid="secret-add-open">Add secret</Button>
          ) : undefined
        }
      >
        {error && <Banner tone="danger" data-testid="secrets-error" className="af-secrets__banner">{error}</Banner>}
        {actionError && <Banner tone="danger" data-testid="secrets-action-error" className="af-secrets__banner">{actionError}</Banner>}
        <p className="af-secrets__note">
          Values are masked — plaintext is never returned over the API and is resolved only at connector use time. A secret's value is shown only here, at entry.
        </p>

        {showAdd && (
          <div className="af-secrets__form" data-testid="secret-add-form">
            <label className="af-secrets__field">
              <span>ID</span>
              <input value={newId} onChange={(e) => setNewId(e.target.value)} data-testid="secret-add-id" placeholder="openai-key" />
            </label>
            <label className="af-secrets__field">
              <span>Name</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="secret-add-name" placeholder="OpenAI API key" />
            </label>
            <label className="af-secrets__field">
              <span>Value</span>
              <input type="password" value={newValue} onChange={(e) => setNewValue(e.target.value)} data-testid="secret-add-value" placeholder="sk-…" />
            </label>
            <div className="af-secrets__form-actions">
              <Button variant="primary" onClick={onAdd} disabled={!addValid || busy} data-testid="secret-add-submit">Create</Button>
              <Button variant="ghost" onClick={() => { setShowAdd(false); setActionError(null); }} disabled={busy} data-testid="secret-add-cancel">Cancel</Button>
            </div>
          </div>
        )}

        {rotateId !== null && (
          <div className="af-secrets__form" data-testid="secret-rotate-form">
            <label className="af-secrets__field">
              <span>New value for <span className="af-secrets__mono">{rotateId}</span></span>
              <input type="password" value={rotateValue} onChange={(e) => setRotateValue(e.target.value)} data-testid="secret-rotate-value" placeholder="new value" />
            </label>
            <div className="af-secrets__form-actions">
              <Button variant="primary" onClick={() => onRotate(rotateId)} disabled={rotateValue === "" || busy} data-testid="secret-rotate-submit">Rotate</Button>
              <Button variant="ghost" onClick={() => { setRotateId(null); setRotateValue(""); }} disabled={busy} data-testid="secret-rotate-cancel">Cancel</Button>
            </div>
          </div>
        )}

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
