// S78 (web) — AuthGate: login / registration / admin shell around the console.
// Holds session state in memory and renders one of: the auth screens (logged out),
// or the authenticated console with a session bar + (for admins) a user-admin panel.

import { useState } from "react";
import { AuthClient, AuthApiError, type AuthSession } from "./authClient.js";
import { AdminConsole } from "./AdminConsole.js";

type Mode = "login" | "register";

export interface AuthGateProps {
  client?: AuthClient;
  // The authenticated application to render once logged in.
  children: (session: AuthSession, logout: () => void) => React.ReactNode;
}

export function AuthGate({ client = new AuthClient(), children }: AuthGateProps) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const s =
        mode === "login"
          ? await client.login({ email, password })
          : await client.register({ tenantId, tenantName, email, password });
      setSession(s);
      setPassword("");
    } catch (err) {
      if (err instanceof AuthApiError) setError(err.message);
      else setError("Network error — is the backend running?");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (session) {
      try {
        await client.logout(session.token);
      } catch {
        // Best-effort; clear local session regardless.
      }
    }
    setSession(null);
    setMode("login");
  };

  if (session) {
    return (
      <div className="app" data-testid="authed-shell">
        <SessionBar session={session} onLogout={logout} />
        {session.user.roles.includes("admin") && <AdminConsole client={client} session={session} />}
        {children(session, logout)}
      </div>
    );
  }

  return (
    <div className="app" data-testid="auth-screen">
      <header className="masthead">
        <h1>AgentFoundry</h1>
        <span className="tag">{mode === "login" ? "SIGN IN" : "REGISTER"}</span>
      </header>
      <div className="panel" style={{ maxWidth: 420, margin: "0 auto" }}>
        <h2>{mode === "login" ? "Sign in to your tenant" : "Create a tenant & admin"}</h2>
        {mode === "register" && (
          <>
            <Field label="Tenant ID" value={tenantId} onChange={setTenantId} testid="f-tenantId" />
            <Field label="Tenant name" value={tenantName} onChange={setTenantName} testid="f-tenantName" />
          </>
        )}
        <Field label="Email" value={email} onChange={setEmail} testid="f-email" type="email" />
        <Field label="Password" value={password} onChange={setPassword} testid="f-password" type="password" />
        {error && (
          <div className="banner fail" data-testid="auth-error">
            {error}
          </div>
        )}
        <div className="controls" style={{ marginTop: 16 }}>
          <button className="primary" disabled={busy} onClick={submit} data-testid="auth-submit">
            {busy ? "…" : mode === "login" ? "Sign in" : "Register"}
          </button>
          <button
            data-testid="auth-toggle"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testid: string;
  type?: string;
}) {
  return (
    <label style={{ display: "block", marginBottom: 10, fontFamily: "var(--mono)", fontSize: 12 }}>
      <span style={{ color: "var(--ink-dim)", display: "block", marginBottom: 4 }}>{props.label}</span>
      <input
        data-testid={props.testid}
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{
          width: "100%",
          background: "var(--panel-2)",
          color: "var(--ink)",
          border: "1px solid var(--line)",
          borderRadius: 5,
          padding: "8px 10px",
          fontFamily: "var(--mono)",
          fontSize: 13,
        }}
      />
    </label>
  );
}

function SessionBar({ session, onLogout }: { session: AuthSession; onLogout: () => void }) {
  return (
    <div
      className="metric"
      data-testid="session-bar"
      style={{ marginBottom: 16, alignItems: "center" }}
    >
      <span>
        Signed in as <strong>{session.user.email}</strong>{" "}
        <span style={{ color: "var(--accent)" }}>[{session.user.roles.join(", ")}]</span> · tenant{" "}
        {session.user.tenantId}
      </span>
      <button className="danger" onClick={onLogout} data-testid="logout-btn">
        Sign out
      </button>
    </div>
  );
}
