// S78 (web) — AuthGate: login / registration / admin shell around the console.
// Holds session state in memory and renders one of: the auth screens (logged out),
// or the authenticated console with a session bar + (for admins) a user-admin panel.
//
// S95: the auth screens are redesigned on the design-system primitives (Button,
// Field, Input, Banner) as a branded, centered auth card with inline validation
// and a password-strength hint on register. All data-testids are preserved so the
// component tests and Playwright auth.spec stay green.

import { useState } from "react";
import { AuthClient, AuthApiError, type AuthSession } from "./authClient.js";
import { AuthedApp } from "../AuthedApp.js";
import { Button, Field, Input, Banner } from "../ui/components.js";

type Mode = "login" | "register";

export interface AuthGateProps {
  client?: AuthClient;
  // The authenticated application to render once logged in.
  children: (session: AuthSession, logout: () => void) => React.ReactNode;
}

// A small, dependency-free password-strength read-out for the register screen.
export function passwordStrength(pw: string): { label: string; tone: "danger" | "warn" | "success" } {
  if (pw.length < 8) return { label: "Too short — use at least 8 characters", tone: "danger" };
  let score = 0;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length >= 12) score++;
  if (score >= 3) return { label: "Strong password", tone: "success" };
  if (score >= 1) return { label: "Okay — mix case, numbers & symbols to strengthen", tone: "warn" };
  return { label: "Weak — mix case, numbers & symbols", tone: "warn" };
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

  // S89: one-click demo sign-in. Fills the known seeded admin credentials and
  // submits immediately, so a reviewer never has to type or hunt for them.
  const useDemoAccount = async () => {
    setError(null);
    setBusy(true);
    try {
      const s = await client.login({ email: "owner@acme.test", password: "demo-password-123" });
      setEmail("owner@acme.test");
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
      <AuthedApp client={client} session={session} logout={logout}>
        {children(session, logout)}
      </AuthedApp>
    );
  }

  const showStrength = mode === "register" && password.length > 0;
  const strength = showStrength ? passwordStrength(password) : null;

  return (
    <div className="af-root af-auth" data-testid="auth-screen">
      <div className="af-auth__card">
        <div className="af-auth__brand">
          <span className="af-auth__mark">AF</span>
          <span className="af-auth__brandname">AgentFoundry</span>
        </div>
        <h1 className="af-auth__title">
          {mode === "login" ? "Sign in to your tenant" : "Create a tenant & admin"}
        </h1>
        <p className="af-auth__subtitle">
          {mode === "login"
            ? "Agent design, evaluation, safety & lifecycle governance."
            : "The first user of a new tenant becomes its administrator."}
        </p>

        {mode === "register" && (
          <>
            <Field label="Tenant ID" htmlFor="f-tenantId">
              <Input id="f-tenantId" data-testid="f-tenantId" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="acme" />
            </Field>
            <Field label="Tenant name" htmlFor="f-tenantName">
              <Input id="f-tenantName" data-testid="f-tenantName" value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Acme Inc." />
            </Field>
          </>
        )}
        <Field label="Email" htmlFor="f-email">
          <Input id="f-email" data-testid="f-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </Field>
        <Field
          label="Password"
          htmlFor="f-password"
          hint={strength ? <span data-testid="pw-strength" className={`af-auth__strength af-auth__strength--${strength.tone}`}>{strength.label}</span> : undefined}
        >
          <Input id="f-password" data-testid="f-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>

        {error && (
          <Banner tone="danger" data-testid="auth-error" className="af-auth__error">
            {error}
          </Banner>
        )}

        <Button variant="primary" block disabled={busy} onClick={submit} data-testid="auth-submit">
          {mode === "login" ? "Sign in" : "Register"}
        </Button>

        {mode === "login" && (
          <Button variant="secondary" block disabled={busy} onClick={useDemoAccount} data-testid="auth-demo" className="af-auth__demo">
            Use demo account (owner@acme.test)
          </Button>
        )}

        <button
          type="button"
          className="af-auth__toggle af-focusable"
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
  );
}
