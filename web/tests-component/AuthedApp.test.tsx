import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthedApp, navForSession } from "../src/AuthedApp.js";
import { AuthClient, type AuthSession } from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function session(roles: string[], over: Partial<AuthSession["user"]> = {}): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:u@acme.com", email: "u@acme.com", tenantId: "acme", roles, ...over },
  };
}

// Fake client covering every on-mount loader any reachable screen calls.
function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = {
    listUsers: vi.fn(async () => ({ users: [session(["admin"]).user] })),
    getAuditTrail: vi.fn(async () => ({ summary: { total: 0, errors: 0, errorRate: 0, lastSeq: 0 }, calls: [] })),
    getBreakers: vi.fn(async () => ({ tripped: [], transitions: [] })),
    getRuns: vi.fn(async () => ({ runs: [] })),
    listAdminUsers: vi.fn(async () => ({ users: [session(["admin"]).user] })),
    listTenants: vi.fn(async () => ({ tenants: [] })),
    listReviews: vi.fn(async () => []),
    listSecrets: vi.fn(async () => ({ secrets: [] })),
    listConnectors: vi.fn(async () => ({ connectors: [] })),
    getCurrentInvoice: vi.fn(async () => ({ tenantId: "acme", period: "2026-06", currency: "USD", lineItems: [], subtotal: 0, total: 0 })),
    getInvoiceHistory: vi.fn(async () => ({ invoices: [], summary: { tenantId: "acme", invoiceCount: 0, lifetimeTotal: 0, currency: "USD", periods: [] }, periodOverPeriod: null })),
    getSlaReport: vi.fn(async () => ({ agents: [] })),
    getCompliancePack: vi.fn(async () => ({ tenantId: "acme", generatedAt: "2026-01-01T00:00:00.000Z", sections: [], governance: { totalAgents: 0, deployedAgents: 0, certifiedAgents: 0, openIncidents: 0 }, markdown: "# pack" })),
    getComplianceHistory: vi.fn(async () => ({ snapshots: [], latestDiff: null })),
    getAuditExport: vi.fn(async () => ({ version: 1, exportedAt: "2026-01-01T00:00:00.000Z", tenantId: "acme", ledgerEntries: [], events: [], signature: "sha256=x" })),
    getStatus: vi.fn(async () => ({
      state: "healthy", summary: "ok",
      health: { state: "healthy", healthyCount: 1, totalComponents: 1 },
      agents: { total: 1, deployed: 1, retired: 0 },
      reviews: { pending: 0 }, drift: { agentsScanned: 1, regressions: 0 },
      billing: { tenantsBilled: 1, periodTotalMinor: 0, currency: "USD" },
      flags: [], generatedAt: "2026-01-01T00:00:00.000Z",
    })),
  };
  return { ...base, ...over } as unknown as AuthClient;
}

const console_ = () => <div data-testid="console">CONSOLE</div>;

describe("navForSession (S105)", () => {
  it("viewer sees only Console + Profile", () => {
    expect(navForSession(session(["viewer"])).map((n) => n.id)).toEqual(["console", "profile"]);
  });
  it("reviewer adds Reviews", () => {
    expect(navForSession(session(["reviewer"])).map((n) => n.id)).toEqual(["console", "profile", "reviews"]);
  });
  it("ops adds Dashboard", () => {
    expect(navForSession(session(["ops"])).map((n) => n.id)).toEqual(["console", "profile", "dashboard"]);
  });
  it("admin sees the full tenant nav (incl. reviews/users/secrets/billing/sla/compliance/dashboard/cockpit)", () => {
    expect(navForSession(session(["admin"])).map((n) => n.id)).toEqual([
      "console", "profile", "reviews", "users", "secrets", "billing", "sla", "compliance", "dashboard", "cockpit",
    ]);
  });
  it("superadmin adds Platform", () => {
    expect(navForSession(session(["superadmin", "admin"])).map((n) => n.id)).toContain("platform");
  });
});

describe("AuthedApp (S105)", () => {
  it("renders the shell, session bar and the default console view", async () => {
    render(<AuthedApp client={fakeClient()} session={session(["admin"])} logout={() => {}}>{console_()}</AuthedApp>);
    expect(screen.getByTestId("authed-shell")).toBeInTheDocument();
    expect(screen.getByTestId("session-bar")).toHaveTextContent("u@acme.com");
    expect(screen.getByTestId("console")).toBeInTheDocument();
    // Admin: the cockpit shows on the default console view too (back-compat).
    await waitFor(() => expect(screen.getByTestId("admin-console")).toBeInTheDocument());
  });

  it("a viewer does not see the admin cockpit on the console view", () => {
    render(<AuthedApp client={fakeClient()} session={session(["viewer"])} logout={() => {}}>{console_()}</AuthedApp>);
    expect(screen.getByTestId("console")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-console")).toBeNull();
  });

  it("navigates to Profile and back to Console", async () => {
    const u = userEvent.setup();
    render(<AuthedApp client={fakeClient()} session={session(["admin"])} logout={() => {}}>{console_()}</AuthedApp>);
    await u.click(screen.getByRole("button", { name: "Profile" }));
    await waitFor(() => expect(screen.getByTestId("profile-screen")).toBeInTheDocument());
    expect(screen.queryByTestId("console")).toBeNull();
    await u.click(screen.getByRole("button", { name: "Console" }));
    expect(screen.getByTestId("console")).toBeInTheDocument();
  });

  it("admin can navigate to Users, Dashboard, Reviews and Cockpit", async () => {
    const u = userEvent.setup();
    render(<AuthedApp client={fakeClient()} session={session(["admin"])} logout={() => {}}>{console_()}</AuthedApp>);
    await u.click(screen.getByRole("button", { name: "Users" }));
    await waitFor(() => expect(screen.getByTestId("users-screen")).toBeInTheDocument());
    await u.click(screen.getByRole("button", { name: "Secrets" }));
    await waitFor(() => expect(screen.getByTestId("secrets-screen")).toBeInTheDocument());
    await u.click(screen.getByRole("button", { name: "Billing" }));
    await waitFor(() => expect(screen.getByTestId("billing-screen")).toBeInTheDocument());
    await u.click(screen.getByRole("button", { name: "SLA" }));
    await waitFor(() => expect(screen.getByTestId("sla-screen")).toBeInTheDocument());
    await u.click(screen.getByRole("button", { name: "Compliance" }));
    await waitFor(() => expect(screen.getByTestId("compliance-screen")).toBeInTheDocument());
    await u.click(screen.getByRole("button", { name: "Dashboard" }));
    await waitFor(() => expect(screen.getByTestId("dashboard-screen")).toBeInTheDocument());
    await u.click(screen.getByRole("button", { name: "Reviews" }));
    await waitFor(() => expect(screen.getByTestId("reviews-screen")).toBeInTheDocument());
    await u.click(screen.getByRole("button", { name: "Cockpit" }));
    await waitFor(() => expect(screen.getByTestId("admin-console")).toBeInTheDocument());
  });

  it("superadmin can navigate to the Platform console", async () => {
    const u = userEvent.setup();
    render(<AuthedApp client={fakeClient()} session={session(["superadmin", "admin"])} logout={() => {}}>{console_()}</AuthedApp>);
    await u.click(screen.getByRole("button", { name: "Platform" }));
    await waitFor(() => expect(screen.getByTestId("platform-screen")).toBeInTheDocument());
  });

  it("wires the logout button", async () => {
    const u = userEvent.setup();
    const logout = vi.fn();
    render(<AuthedApp client={fakeClient()} session={session(["viewer"])} logout={logout}>{console_()}</AuthedApp>);
    await u.click(screen.getByTestId("logout-btn"));
    expect(logout).toHaveBeenCalled();
  });

  it("route-guards a stale view: falls back to Console when the role loses access", async () => {
    const u = userEvent.setup();
    const client = fakeClient();
    const { rerender } = render(
      <AuthedApp client={client} session={session(["superadmin", "admin"])} logout={() => {}}>{console_()}</AuthedApp>,
    );
    // Navigate to a superadmin-only view.
    await u.click(screen.getByRole("button", { name: "Platform" }));
    await waitFor(() => expect(screen.getByTestId("platform-screen")).toBeInTheDocument());
    // The same component now receives a viewer session (role downgraded): the
    // active view 'platform' is no longer reachable, so the guard falls back.
    rerender(<AuthedApp client={client} session={session(["viewer"])} logout={() => {}}>{console_()}</AuthedApp>);
    expect(screen.queryByTestId("platform-screen")).toBeNull();
    expect(screen.getByTestId("console")).toBeInTheDocument();
  });
});
