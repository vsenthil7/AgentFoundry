// S105 — AuthedApp: the unified, role-aware authenticated application.
//
// Before S105 the authenticated screens (Golden Thread console, admin cockpit,
// profile, users, platform, reviews, dashboard) were each built and tested
// standalone; only the console + admin cockpit were actually rendered. AuthedApp
// wraps the S94 AppShell around all of them with a single role-based sidebar and
// client-side view routing.
//
// Backwards-compatibility contract (kept green): the DEFAULT view ("console")
// renders the session bar + (for admins) the admin cockpit + the Golden Thread
// console exactly as the pre-S105 stacked layout did, so the AuthGate component
// tests and the Playwright auth.spec — which assert session-bar / admin-console /
// users-panel / the console heading are all visible right after login with no
// navigation — continue to pass unchanged. The other nav items switch the main
// content to the dedicated full screens.

import { useState } from "react";
import type { AuthClient, AuthSession } from "./auth/authClient.js";
import { AdminConsole } from "./auth/AdminConsole.js";
import { AppShell, type NavItem } from "./ui/AppShell.js";
import { Button } from "./ui/components.js";
import { ProfileScreen } from "./profile/ProfileScreen.js";
import { UsersScreen } from "./admin/UsersScreen.js";
import { PlatformScreen } from "./platform/PlatformScreen.js";
import { ReviewInbox } from "./reviews/ReviewInbox.js";
import { HealthDashboard } from "./dashboard/HealthDashboard.js";
import { SecretsScreen } from "./secrets/SecretsScreen.js";
import { BillingScreen } from "./billing/BillingScreen.js";
import { SlaScreen } from "./sla/SlaScreen.js";
import { ComplianceScreen } from "./compliance/ComplianceScreen.js";
import { StatusHistoryScreen } from "./status/StatusHistoryScreen.js";
import { DataGovernanceScreen } from "./governance/DataGovernanceScreen.js";

export type ViewId =
  | "console"
  | "profile"
  | "reviews"
  | "users"
  | "secrets"
  | "billing"
  | "sla"
  | "compliance"
  | "trend"
  | "data"
  | "dashboard"
  | "cockpit"
  | "platform";

export interface AuthedAppProps {
  client: AuthClient;
  session: AuthSession;
  logout: () => void;
  // The Golden Thread console (supplied by main.tsx as <App />).
  children: React.ReactNode;
}

// Role predicates — single source of truth for what each role may reach.
function has(session: AuthSession, role: string): boolean {
  return session.user.roles.includes(role);
}
function isAdmin(session: AuthSession): boolean {
  return has(session, "admin");
}
function isReviewer(session: AuthSession): boolean {
  return has(session, "reviewer") || isAdmin(session);
}
function isOps(session: AuthSession): boolean {
  return has(session, "ops") || isAdmin(session);
}
function isSuperadmin(session: AuthSession): boolean {
  return has(session, "superadmin");
}

// Build the nav (and the set of reachable views) for a session's roles.
export function navForSession(session: AuthSession): NavItem[] {
  const nav: NavItem[] = [
    { id: "console", label: "Console" },
    { id: "profile", label: "Profile" },
  ];
  if (isReviewer(session)) nav.push({ id: "reviews", label: "Reviews" });
  if (isAdmin(session)) nav.push({ id: "users", label: "Users" });
  if (isAdmin(session)) nav.push({ id: "secrets", label: "Secrets" });
  if (isAdmin(session)) nav.push({ id: "billing", label: "Billing" });
  if (isAdmin(session)) nav.push({ id: "sla", label: "SLA" });
  if (isAdmin(session)) nav.push({ id: "compliance", label: "Compliance" });
  if (isAdmin(session)) nav.push({ id: "data", label: "Data" });
  if (isOps(session)) nav.push({ id: "dashboard", label: "Dashboard" });
  if (isOps(session)) nav.push({ id: "trend", label: "Trend" });
  if (isAdmin(session)) nav.push({ id: "cockpit", label: "Cockpit" });
  if (isSuperadmin(session)) nav.push({ id: "platform", label: "Platform" });
  return nav;
}

export function AuthedApp({ client, session, logout, children }: AuthedAppProps) {
  const nav = navForSession(session);
  const reachable = new Set(nav.map((n) => n.id));
  const [view, setView] = useState<ViewId>("console");

  // Route guard: if the active view isn't reachable for this role, fall back to
  // the always-present console. (Defends against a stale view after a role change.)
  const active: ViewId = reachable.has(view) ? view : "console";

  return (
    <div className="af-root af-authed" data-testid="authed-shell">
      <AppShell
        nav={nav}
        active={active}
        onNavigate={(id) => setView(id as ViewId)}
        user={{ email: session.user.email, displayName: session.user.displayName, roles: session.user.roles }}
        onLogout={logout}
      >
        {/* Session bar kept in the shell content so existing tests/selectors
            (session-bar, logout-btn) remain present in the authed app. */}
        <div className="af-sessionbar" data-testid="session-bar">
          <span className="af-sessionbar__who">
            Signed in as <strong>{session.user.email}</strong>
            <span className="af-sessionbar__roles">{session.user.roles.join(", ")}</span>
            <span className="af-sessionbar__tenant">tenant {session.user.tenantId}</span>
          </span>
          <Button variant="ghost" onClick={logout} data-testid="logout-btn">Sign out</Button>
        </div>

        {active === "console" && (
          <>
            {isAdmin(session) && <AdminConsole client={client} session={session} />}
            {children}
          </>
        )}
        {active === "profile" && <ProfileScreen client={client} session={session} />}
        {active === "reviews" && isReviewer(session) && <ReviewInbox client={client} session={session} />}
        {active === "users" && isAdmin(session) && <UsersScreen client={client} session={session} />}
        {active === "secrets" && isAdmin(session) && <SecretsScreen client={client} session={session} />}
        {active === "billing" && isAdmin(session) && <BillingScreen client={client} session={session} />}
        {active === "sla" && isAdmin(session) && <SlaScreen client={client} session={session} />}
        {active === "compliance" && isAdmin(session) && <ComplianceScreen client={client} session={session} />}
        {active === "data" && isAdmin(session) && <DataGovernanceScreen client={client} session={session} />}
        {active === "dashboard" && isOps(session) && <HealthDashboard client={client} session={session} />}
        {active === "trend" && isOps(session) && <StatusHistoryScreen client={client} session={session} />}
        {active === "cockpit" && isAdmin(session) && <AdminConsole client={client} session={session} />}
        {active === "platform" && isSuperadmin(session) && <PlatformScreen client={client} session={session} />}
      </AppShell>
    </div>
  );
}
