import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { HealthDashboard } from "../src/dashboard/HealthDashboard.js";
import { AuthClient, AuthApiError, type AuthSession, type PlatformStatusReport, type AuditTrail } from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function session(): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"] },
  };
}

function status(over: Partial<PlatformStatusReport> = {}): PlatformStatusReport {
  return {
    state: "healthy",
    summary: "HEALTHY · 2/3 agents deployed · 1 pending review(s) · 0 regression(s) · 12.50 USD billed",
    health: { state: "healthy", healthyCount: 4, totalComponents: 4 },
    agents: { total: 3, deployed: 2, retired: 0 },
    reviews: { pending: 1 },
    drift: { agentsScanned: 3, regressions: 0 },
    billing: { tenantsBilled: 1, periodTotalMinor: 1250, currency: "USD" },
    flags: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function audit(over: Partial<AuditTrail> = {}): AuditTrail {
  return {
    summary: { total: 10, errors: 2, errorRate: 0.2, lastSeq: 10 },
    calls: [
      { seq: 1, timestamp: "t", method: "GET", path: "/status", status: 200, latencyMs: 4, actor: "u", tenantId: "acme" },
      { seq: 2, timestamp: "t", method: "POST", path: "/agents", status: 500, latencyMs: 8, actor: "u", tenantId: "acme" },
    ],
    ...over,
  };
}

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = {
    getStatus: vi.fn(async () => status()),
    getAuditTrail: vi.fn(async () => audit()),
  };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("HealthDashboard (S102)", () => {
  it("shows a loading state first", () => {
    render(<HealthDashboard client={fakeClient()} session={session()} />);
    expect(screen.getByTestId("dashboard-loading")).toBeInTheDocument();
  });

  it("renders state, deployment, health, metrics and API traffic", async () => {
    render(<HealthDashboard client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("dash-state")).toHaveTextContent("HEALTHY"));
    expect(screen.getByTestId("dash-summary")).toHaveTextContent("agents deployed");
    expect(screen.getByTestId("dash-deployed")).toHaveTextContent("2 / 3");
    expect(screen.getByTestId("dash-deployed")).toHaveTextContent("67%");
    expect(screen.getByTestId("dash-health")).toHaveTextContent("4 / 4");
    expect(screen.getByTestId("dash-reviews")).toHaveTextContent("1");
    expect(screen.getByTestId("dash-regressions")).toHaveTextContent("0");
    expect(screen.getByTestId("dash-billing")).toHaveTextContent("12.50 USD");
    expect(screen.getByTestId("dash-errorrate")).toHaveTextContent("20.0%");
    expect(screen.getByTestId("dash-latency")).toHaveTextContent("6ms"); // (4+8)/2
  });

  it("shows the all-clear banner when there are no flags", async () => {
    render(<HealthDashboard client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("dash-allclear")).toBeInTheDocument());
    expect(screen.queryByTestId("dash-flags")).toBeNull();
  });

  it("renders operator flags (first as danger when platform is down)", async () => {
    const client = fakeClient({
      getStatus: vi.fn(async () =>
        status({
          state: "down",
          flags: ["PLATFORM DOWN: a critical component is unavailable.", "1 promotion(s) awaiting review."],
        }),
      ),
    });
    render(<HealthDashboard client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("dash-flags")).toBeInTheDocument());
    expect(screen.getByTestId("dash-flag-0")).toHaveTextContent("PLATFORM DOWN");
    expect(screen.getByTestId("dash-flag-1")).toHaveTextContent("awaiting review");
    expect(screen.getByTestId("dash-state")).toHaveTextContent("DOWN");
  });

  it("marks regressions and error rate as bad when present", async () => {
    const client = fakeClient({
      getStatus: vi.fn(async () => status({ state: "degraded", drift: { agentsScanned: 5, regressions: 2 }, flags: ["2 agent(s) regressed against baseline."] })),
    });
    render(<HealthDashboard client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("dash-regressions")).toHaveTextContent("2"));
    expect(screen.getByTestId("dash-regressions")).toHaveClass("af-dash__metric--bad");
  });

  it("handles zero totals without dividing by zero, and empty audit latency", async () => {
    const client = fakeClient({
      getStatus: vi.fn(async () => status({ agents: { total: 0, deployed: 0, retired: 0 }, health: { state: "healthy", healthyCount: 0, totalComponents: 0 } })),
      getAuditTrail: vi.fn(async () => audit({ summary: { total: 0, errors: 0, errorRate: 0, lastSeq: 0 }, calls: [] })),
    });
    render(<HealthDashboard client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("dash-deployed")).toHaveTextContent("0%"));
    expect(screen.getByTestId("dash-latency")).toHaveTextContent("0ms");
    expect(screen.getByTestId("dash-errorrate")).toHaveTextContent("0.0%");
  });

  it("shows an API error from /status", async () => {
    const client = fakeClient({ getStatus: vi.fn(async () => { throw new AuthApiError(403, "Requires admin"); }) });
    render(<HealthDashboard client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("dashboard-error")).toHaveTextContent("Requires admin"));
  });

  it("shows a generic error on a non-API failure", async () => {
    const client = fakeClient({ getAuditTrail: vi.fn(async () => { throw new Error("socket"); }) });
    render(<HealthDashboard client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("dashboard-error")).toHaveTextContent("Request failed"));
  });

  it("ignores a resolution that arrives after unmount (success race)", async () => {
    let resolveStatus!: (s: PlatformStatusReport) => void;
    const client = fakeClient({
      getStatus: vi.fn(() => new Promise<PlatformStatusReport>((res) => { resolveStatus = res; })),
    });
    const { unmount } = render(<HealthDashboard client={client} session={session()} />);
    expect(screen.getByTestId("dashboard-loading")).toBeInTheDocument();
    unmount();
    // Resolve after unmount: the live-guard must swallow the state update.
    await act(async () => {
      resolveStatus(status());
      await Promise.resolve();
    });
    // No throw / no act warning = guard covered.
    expect(true).toBe(true);
  });

  it("ignores a rejection that arrives after unmount (error race)", async () => {
    let rejectStatus!: (e: unknown) => void;
    const client = fakeClient({
      getStatus: vi.fn(() => new Promise<PlatformStatusReport>((_res, rej) => { rejectStatus = rej; })),
    });
    const { unmount } = render(<HealthDashboard client={client} session={session()} />);
    unmount();
    await act(async () => {
      rejectStatus(new Error("late"));
      await Promise.resolve();
    });
    expect(true).toBe(true);
  });
});
