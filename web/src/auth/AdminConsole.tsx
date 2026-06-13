// S83 (web) — Admin console: tenant users, API audit trail, circuit breakers.
// Renders for admins only (AuthGate gates it). Each panel reads a backend endpoint
// through the injectable AuthClient, so it is unit-testable in jsdom with a fake.

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

type Tab = "users" | "audit" | "breakers" | "runs";

export function AdminConsole({ client, session }: { client: AuthClient; session: AuthSession }) {
  const [tab, setTab] = useState<Tab>("users");
  return (
    <div className="panel" data-testid="admin-console" style={{ marginBottom: 16 }}>
      <div className="controls" style={{ marginBottom: 12 }}>
        <button data-testid="tab-users" className={tab === "users" ? "primary" : ""} onClick={() => setTab("users")}>
          Users
        </button>
        <button data-testid="tab-audit" className={tab === "audit" ? "primary" : ""} onClick={() => setTab("audit")}>
          API audit
        </button>
        <button data-testid="tab-breakers" className={tab === "breakers" ? "primary" : ""} onClick={() => setTab("breakers")}>
          Circuit breakers
        </button>
        <button data-testid="tab-runs" className={tab === "runs" ? "primary" : ""} onClick={() => setTab("runs")}>
          Run replay
        </button>
      </div>
      {tab === "users" && <UsersPanel client={client} session={session} />}
      {tab === "audit" && <AuditPanel client={client} session={session} />}
      {tab === "breakers" && <BreakersPanel client={client} session={session} />}
      {tab === "runs" && <RunsPanel client={client} session={session} />}
    </div>
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
      <h2>Tenant users</h2>
      {error && <div className="banner fail">{error}</div>}
      {data === null && !error && <div className="log">Loading…</div>}
      {data &&
        data.users.map((u) => (
          <div key={u.id} className="metric" data-testid="user-row">
            <span>{u.email}</span>
            <span className="v" style={{ color: "var(--blue)" }}>
              {u.roles.join(", ")}
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
      <h2>API call audit trail</h2>
      {error && <div className="banner fail">{error}</div>}
      {data === null && !error && <div className="log">Loading…</div>}
      {data && (
        <>
          <div className="metric">
            <span>
              {data.summary.total} calls · {data.summary.errors} errors
            </span>
            <span className="v" style={{ color: data.summary.errors ? "var(--danger)" : "var(--accent)" }}>
              {(data.summary.errorRate * 100).toFixed(1)}% error rate
            </span>
          </div>
          {data.calls.length === 0 && <div className="log">No calls recorded.</div>}
          {data.calls.slice(-25).reverse().map((c) => (
            <div key={c.seq} className="attack" data-testid="audit-row">
              <span className="ids" style={{ marginLeft: 0, color: "var(--ink-dim)" }}>
                #{c.seq}
              </span>
              <span>
                {c.method} {c.path}
              </span>
              <span
                className="badge"
                style={{ marginLeft: "auto", color: c.status >= 400 ? "var(--danger)" : "var(--accent)" }}
              >
                {c.status} · {c.latencyMs}ms · {c.actor}
              </span>
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
      <h2>Circuit breakers (runtime containment)</h2>
      {error && <div className="banner fail">{error}</div>}
      {resetError && <div className="banner fail">{resetError}</div>}
      {data === null && !error && <div className="log">Loading…</div>}
      {data && (
        <>
          {data.tripped.length === 0 ? (
            <div className="banner pass" data-testid="no-tripped">
              All agents healthy — no breakers tripped.
            </div>
          ) : (
            data.tripped.map((agentId) => (
              <div key={agentId} className="metric" data-testid="tripped-row">
                <span style={{ color: "var(--danger)" }}>⛔ {agentId} — suspended</span>
                <button className="danger" data-testid={`reset-${agentId}`} onClick={() => doReset(agentId)}>
                  Reset
                </button>
              </div>
            ))
          )}
          <h2 style={{ marginTop: 16 }}>Transition history</h2>
          {data.transitions.length === 0 && <div className="log">No transitions yet.</div>}
          {data.transitions.slice(-20).reverse().map((t, i) => (
            <div key={i} className="attack" data-testid="transition-row">
              <span>
                {t.agentId}: {t.from} → {t.to}
              </span>
              <span className="ids">{t.reason}</span>
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
      <h2>Agent run replay</h2>
      {error && <div className="banner fail">{error}</div>}
      {replayError && <div className="banner fail">{replayError}</div>}
      {data === null && !error && <div className="log">Loading…</div>}
      {data && data.runs.length === 0 && <div className="log">No runs recorded.</div>}
      {data &&
        data.runs.map((r) => {
          const replay = replays[r.seq];
          return (
            <div key={r.seq} className="attack" data-testid="run-row" style={{ flexWrap: "wrap" }}>
              <span className="ids" style={{ marginLeft: 0, color: "var(--ink-dim)" }}>
                #{r.seq} {r.agentId}@{r.version}
              </span>
              <span style={{ flexBasis: "100%", color: "var(--ink-dim)", fontSize: 12 }}>
                in: {r.input}
              </span>
              <span
                className="badge"
                style={{ color: r.verdict.safe ? "var(--accent)" : "var(--danger)" }}
              >
                {r.verdict.safe ? "SAFE" : `UNSAFE [${r.verdict.categories.join(", ")}]`}
              </span>
              <button data-testid={`replay-${r.seq}`} style={{ marginLeft: "auto" }} onClick={() => doReplay(r.seq)}>
                Replay
              </button>
              {replay && (
                <span
                  className="badge"
                  data-testid={`replay-result-${r.seq}`}
                  style={{ flexBasis: "100%", color: replay.reproduced ? "var(--accent)" : "var(--danger)" }}
                >
                  {replay.reproduced ? "✓ decision reproduced" : `⚠ diverged: ${replay.divergence}`}
                </span>
              )}
            </div>
          );
        })}
    </div>
  );
}
