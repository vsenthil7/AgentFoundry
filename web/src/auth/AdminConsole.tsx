// S83 (web) — Admin operator cockpit: tenant users, API audit trail, circuit
// breakers, run replay. Renders for admins only (AuthGate gates it). Each panel
// reads a backend endpoint through the injectable AuthClient, so it is
// unit-testable in jsdom with a fake.
//
// S101: rebuilt on the design system (Tabs / Card / Table / Badge / Banner /
// Button). Every data-testid and behaviour is preserved so the AdminConsole
// component suite and the Playwright auth.spec stay green.

import { useEffect, useState } from "react";
import {
  AuthClient,
  AuthApiError,
  type AuthSession,
  type SessionUser,
  type AuditTrail,
  type BreakerView,
  type RunRecord,
  type ReplayResult,
} from "./authClient.js";
import { Card, Tabs, Table, Badge, Banner, Button, type Column } from "../ui/components.js";

type Tab = "users" | "audit" | "breakers" | "runs";

export function AdminConsole({ client, session }: { client: AuthClient; session: AuthSession }) {
  const [tab, setTab] = useState<Tab>("users");
  return (
    <Card className="af-cockpit" data-testid="admin-console">
      <Tabs
        active={tab}
        onChange={(id) => setTab(id as Tab)}
        items={[
          { id: "users", label: <span data-testid="tab-users">Users</span> },
          { id: "audit", label: <span data-testid="tab-audit">API audit</span> },
          { id: "breakers", label: <span data-testid="tab-breakers">Circuit breakers</span> },
          { id: "runs", label: <span data-testid="tab-runs">Run replay</span> },
        ]}
      />
      <div className="af-cockpit__body">
        {tab === "users" && <UsersPanel client={client} session={session} />}
        {tab === "audit" && <AuditPanel client={client} session={session} />}
        {tab === "breakers" && <BreakersPanel client={client} session={session} />}
        {tab === "runs" && <RunsPanel client={client} session={session} />}
      </div>
    </Card>
  );
}

function useAsync<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    load()
      .then((d) => live && setData(d))
      .catch((err) => live && setError(err instanceof AuthApiError ? err.message : "Request failed"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

function UsersPanel({ client, session }: { client: AuthClient; session: AuthSession }) {
  const { data, error } = useAsync<{ users: SessionUser[] }>(() => client.listUsers(session.token), [session.token]);
  return (
    <div data-testid="users-panel">
      <h3 className="af-cockpit__h">Tenant users</h3>
      {error && <Banner tone="danger">{error}</Banner>}
      {data === null && !error && <p className="af-cockpit__loading">Loading…</p>}
      {data &&
        data.users.map((u) => (
          <div key={u.id} className="af-cockpit__row" data-testid="user-row">
            <span>{u.email}</span>
            <span className="af-cockpit__roles">
              {u.roles.map((r) => (
                <Badge key={r} tone="brand">{r}</Badge>
              ))}
            </span>
          </div>
        ))}
    </div>
  );
}

function AuditPanel({ client, session }: { client: AuthClient; session: AuthSession }) {
  const { data, error } = useAsync<AuditTrail>(() => client.getAuditTrail(session.token), [session.token]);
  return (
    <div data-testid="audit-panel">
      <h3 className="af-cockpit__h">API call audit trail</h3>
      {error && <Banner tone="danger">{error}</Banner>}
      {data === null && !error && <p className="af-cockpit__loading">Loading…</p>}
      {data && (
        <>
          <div className="af-cockpit__summary">
            <span>{data.summary.total} calls · {data.summary.errors} errors</span>
            <Badge tone={data.summary.errors ? "danger" : "success"}>
              {(data.summary.errorRate * 100).toFixed(1)}% error rate
            </Badge>
          </div>
          {data.calls.length === 0 && <p className="af-cockpit__loading">No calls recorded.</p>}
          {data.calls.slice(-25).reverse().map((c) => (
            <div key={c.seq} className="af-cockpit__line" data-testid="audit-row">
              <span className="af-cockpit__seq">#{c.seq}</span>
              <span>{c.method} {c.path}</span>
              <Badge tone={c.status >= 400 ? "danger" : "success"}>{c.status} · {c.latencyMs}ms · {c.actor}</Badge>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function BreakersPanel({ client, session }: { client: AuthClient; session: AuthSession }) {
  const [refresh, setRefresh] = useState(0);
  const { data, error } = useAsync<BreakerView>(() => client.getBreakers(session.token), [session.token, refresh]);
  const [resetError, setResetError] = useState<string | null>(null);

  const doReset = async (agentId: string) => {
    setResetError(null);
    try {
      await client.resetBreaker(session.token, agentId);
      setRefresh((n) => n + 1);
    } catch (err) {
      setResetError(err instanceof AuthApiError ? err.message : "Reset failed");
    }
  };

  return (
    <div data-testid="breakers-panel">
      <h3 className="af-cockpit__h">Circuit breakers (runtime containment)</h3>
      {error && <Banner tone="danger">{error}</Banner>}
      {resetError && <Banner tone="danger">{resetError}</Banner>}
      {data === null && !error && <p className="af-cockpit__loading">Loading…</p>}
      {data && (
        <>
          {data.tripped.length === 0 ? (
            <Banner tone="success" data-testid="no-tripped">All agents healthy — no breakers tripped.</Banner>
          ) : (
            data.tripped.map((agentId) => (
              <div key={agentId} className="af-cockpit__row" data-testid="tripped-row">
                <span className="af-cockpit__tripped">⛔ {agentId} — suspended</span>
                <Button variant="danger" data-testid={`reset-${agentId}`} onClick={() => doReset(agentId)}>Reset</Button>
              </div>
            ))
          )}
          <h3 className="af-cockpit__h" style={{ marginTop: 16 }}>Transition history</h3>
          {data.transitions.length === 0 && <p className="af-cockpit__loading">No transitions yet.</p>}
          {data.transitions.slice(-20).reverse().map((t, i) => (
            <div key={i} className="af-cockpit__line" data-testid="transition-row">
              <span>{t.agentId}: {t.from} → {t.to}</span>
              <span className="af-cockpit__reason">{t.reason}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function RunsPanel({ client, session }: { client: AuthClient; session: AuthSession }) {
  const { data, error } = useAsync<{ runs: RunRecord[] }>(() => client.getRuns(session.token), [session.token]);
  const [replays, setReplays] = useState<Record<number, ReplayResult>>({});
  const [replayError, setReplayError] = useState<string | null>(null);

  const doReplay = async (seq: number) => {
    setReplayError(null);
    try {
      const r = await client.replayRun(session.token, seq);
      setReplays((prev) => ({ ...prev, [seq]: r }));
    } catch (err) {
      setReplayError(err instanceof AuthApiError ? err.message : "Replay failed");
    }
  };

  return (
    <div data-testid="runs-panel">
      <h3 className="af-cockpit__h">Agent run replay</h3>
      {error && <Banner tone="danger">{error}</Banner>}
      {replayError && <Banner tone="danger">{replayError}</Banner>}
      {data === null && !error && <p className="af-cockpit__loading">Loading…</p>}
      {data && data.runs.length === 0 && <p className="af-cockpit__loading">No runs recorded.</p>}
      {data &&
        data.runs.map((r) => {
          const replay = replays[r.seq];
          return (
            <div key={r.seq} className="af-cockpit__runrow" data-testid="run-row">
              <span className="af-cockpit__seq">#{r.seq} {r.agentId}@{r.version}</span>
              <span className="af-cockpit__runin">in: {r.input}</span>
              <Badge tone={r.verdict.safe ? "success" : "danger"}>
                {r.verdict.safe ? "SAFE" : `UNSAFE [${r.verdict.categories.join(", ")}]`}
              </Badge>
              <Button variant="ghost" data-testid={`replay-${r.seq}`} className="af-cockpit__replaybtn" onClick={() => doReplay(r.seq)}>Replay</Button>
              {replay && (
                <Badge
                  tone={replay.reproduced ? "success" : "danger"}
                  data-testid={`replay-result-${r.seq}`}
                  className="af-cockpit__replayresult"
                >
                  {replay.reproduced ? "✓ decision reproduced" : `⚠ diverged: ${replay.divergence}`}
                </Badge>
              )}
            </div>
          );
        })}
    </div>
  );
}
