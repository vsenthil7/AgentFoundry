// S78 (web) — AuthGate: login / registration / admin shell around the console.
// Holds session state in memory and renders one of: the auth screens (logged out),
// or the authenticated console with a session bar + (for admins) a user-admin panel.
//
// S95: redesigned on the design system as a branded, centered auth card.
// S120: rebuilt as a two-panel enterprise sign-in — a left brand/hero panel with
// trust bullets and a right sign-in card that now offers SSO options above the
// email/password form. The Microsoft option maps to the REAL S117 Entra OIDC
// verifier; when the deployment has not configured Entra it shows an honest
// "SSO not configured" notice rather than faking a flow. Google / SAML are clearly
// marked (demo). Every existing data-testid is preserved so the component tests and
// Playwright auth.spec stay green.

import { useState } from "react";
import { AuthClient, AuthApiError, type AuthSession } from "./authClient.js";
import { AuthedApp } from "../AuthedApp.js";
import { Button, Field, Input, Banner } from "../ui/components.js";

type Mode = "login" | "register";

export interface AuthGateProps {
  client?: AuthClient;
  // The authenticated application to render once logged in.
  children: (session: AuthSession, logout: () => void) => React.ReactNode;
  // S120: which SSO providers are configured on this deployment. Defaults to
  // none configured — so on the offline/demo build the Microsoft button honestly
  // reports "not configured" instead of pretending to start an OIDC flow.
  ssoConfig?: SsoConfig;
}

// S120 — SSO provider option model. `configured` means a real IdP is wired on
// this deployment; `demo` marks a clearly-labelled placeholder (no real IdP).
export interface SsoConfig {
  microsoft?: boolean; // true when ENTRA_TENANT_ID / ENTRA_CLIENT_ID are set
}

export interface SsoOption {
  id: "microsoft" | "google" | "saml";
  label: string;
  configured: boolean;
  demo: boolean;
}

// Pure, fully-testable: derive the SSO option list from deployment config.
// Microsoft is "real" (S117 Entra verifier) when configured; Google/SAML are
// always demo placeholders in this build (honestly labelled, like SpoofVane).
export function ssoOptions(config: SsoConfig = {}): SsoOption[] {
  return [
    { id: "microsoft", label: "Continue with Microsoft", configured: !!config.microsoft, demo: false },
    { id: "google", label: "Continue with Google", configured: false, demo: true },
    { id: "saml", label: "Continue with SSO / SAML", configured: false, demo: true },
  ];
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

const TRUST_BULLETS: string[] = [
  "Deterministic gate decides pass/fail — the LLM only explains, never approves",
  "Battle-Mode red team mapped to OWASP LLM / MITRE ATLAS / NIST",
  "Tamper-evident, hash-chained audit ledger on every promotion",
  "EU-AI-Act-aware governance, certification tiers & lineage",
];

export function AuthGate({ client = new AuthClient(), children, ssoConfig = {} }: AuthGateProps) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setNotice(null);
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
    setNotice(null);
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

  // S120: SSO option click. Microsoft, when configured, redirects to the real
  // Entra authorize endpoint (the S117 verifier validates the returned token at
  // the server). When NOT configured — or for the demo Google/SAML options — we
  // show an honest notice rather than faking authentication.
  const onSso = (opt: SsoOption) => {
    setError(null);
    if (opt.id === "microsoft" && opt.configured) {
      window.location.assign("/auth/sso/microsoft/start");
      return;
    }
    if (opt.demo) {
      const name = opt.id === "google" ? "Google" : "SAML";
      setNotice(`${name} SSO is a demo placeholder on this deployment. Use email & password or the demo account below.`);
      return;
    }
    // Microsoft selected but not configured on this deployment.
    setNotice("Microsoft Entra SSO is not configured on this deployment. The verifier is built (set ENTRA_TENANT_ID / ENTRA_CLIENT_ID to enable it). Use email & password or the demo account below.");
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
  const options = ssoOptions(ssoConfig);

  return (
    <div className="af-root af-auth" data-testid="auth-screen">
      <div className="af-auth__split">
        {/* Left brand / hero panel */}
        <aside className="af-auth__hero" data-testid="auth-hero">
          <div className="af-auth__brand">
            <span className="af-auth__mark">AF</span>
            <span className="af-auth__brandname">AgentFoundry</span>
          </div>
          <h2 className="af-auth__herotitle">
            Build an agent and prove it safe — in one workflow.
          </h2>
          <p className="af-auth__herosub">
            The agent design, evaluation, safety &amp; lifecycle operating system.
            Design → Evaluate → Red&nbsp;Team → Approve → Export → Monitor.
          </p>
          <ul className="af-auth__bullets">
            {TRUST_BULLETS.map((b, i) => (
              <li key={i} className="af-auth__bullet" data-testid={`auth-bullet-${i}`}>
                <span className="af-auth__check" aria-hidden="true">✓</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </aside>

        {/* Right sign-in card */}
        <div className="af-auth__card">
          <h1 className="af-auth__title">
            {mode === "login" ? "Sign in to your tenant" : "Create a tenant & admin"}
          </h1>
          <p className="af-auth__subtitle">
            {mode === "login"
              ? "Use single sign-on, or your tenant email & password."
              : "The first user of a new tenant becomes its administrator."}
          </p>

          {/* SSO options (login mode only — registration creates a new tenant) */}
          {mode === "login" && (
            <div className="af-auth__sso" data-testid="auth-sso">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className="af-auth__ssobtn af-focusable"
                  data-testid={`sso-${opt.id}`}
                  disabled={busy}
                  onClick={() => onSso(opt)}
                >
                  <span className={`af-auth__ssoicon af-auth__ssoicon--${opt.id}`} aria-hidden="true">
                    {opt.id === "microsoft" ? "⊞" : opt.id === "google" ? "G" : "🔑"}
                  </span>
                  <span className="af-auth__ssolabel">{opt.label}</span>
                  {opt.demo ? (
                    <span className="af-auth__ssotag" data-testid={`sso-tag-${opt.id}`}>demo</span>
                  ) : opt.configured ? (
                    <span className="af-auth__ssotag af-auth__ssotag--live" data-testid={`sso-tag-${opt.id}`}>SSO</span>
                  ) : null}
                </button>
              ))}
              <div className="af-auth__or"><span>or</span></div>
            </div>
          )}

          {notice && (
            <Banner tone="info" data-testid="sso-notice" className="af-auth__error">
              {notice}
            </Banner>
          )}

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
              setNotice(null);
            }}
          >
            {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
