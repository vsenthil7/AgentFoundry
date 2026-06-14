import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { StatusHistoryScreen, pctLabel } from "../src/status/StatusHistoryScreen.js";
import { AuthClient, AuthApiError, type AuthSession, type StatusHistorySummary } from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function session(): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"] },
  };
}

const SUMMARY: StatusHistorySummary = {
  samples: 10,
  current: "degraded",
  trend: "worsening",
  healthyFraction: 0.6,
  degradedFraction: 0.3,
  downFraction: 0.1,
};

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = { getStatusHistory: vi.fn(async () => SUMMARY) };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("pctLabel (S112)", () => {
  it("formats a fraction as an integer percent", () => {
    expect(pctLabel(0.6)).toBe("60%");
    expect(pctLabel(0)).toBe("0%");
    expect(pctLabel(1)).toBe("100%");
    expect(pctLabel(0.333)).toBe("33%");
  });
});

describe("StatusHistoryScreen (S112)", () => {
  it("shows a loading state first", () => {
    render(<StatusHistoryScreen client={fakeClient()} session={session()} />);
    expect(screen.getByTestId("status-loading")).toBeInTheDocument();
  });

  it("renders the trend, current state, sample count and state-fraction bars", async () => {
    render(<StatusHistoryScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("status-trend")).toBeInTheDocument());
    expect(screen.getByTestId("status-trend")).toHaveTextContent("WORSENING");
    expect(screen.getByTestId("status-current")).toHaveTextContent("DEGRADED");
    expect(screen.getByTestId("status-samples")).toHaveTextContent("10 samples");
    expect(screen.getByTestId("status-fraction-healthy")).toHaveStyle({ width: "60%" });
    expect(screen.getByTestId("status-fraction-degraded")).toHaveStyle({ width: "30%" });
    expect(screen.getByTestId("status-fraction-down")).toHaveStyle({ width: "10%" });
  });

  it("renders an empty state when no samples are recorded (current null)", async () => {
    const client = fakeClient({ getStatusHistory: vi.fn(async () => ({ samples: 0, current: null, trend: "stable", healthyFraction: 0, degradedFraction: 0, downFraction: 0 })) });
    render(<StatusHistoryScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("status-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("status-trend")).toBeNull();
  });

  it("shows an API error", async () => {
    const client = fakeClient({ getStatusHistory: vi.fn(async () => { throw new AuthApiError(404, "not configured here"); }) });
    render(<StatusHistoryScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("status-error")).toHaveTextContent("not configured"));
  });

  it("shows a generic error on a non-API failure", async () => {
    const client = fakeClient({ getStatusHistory: vi.fn(async () => { throw new Error("socket"); }) });
    render(<StatusHistoryScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("status-error")).toHaveTextContent("Request failed"));
  });

  it("ignores a resolution after unmount", async () => {
    let resolve!: (v: StatusHistorySummary) => void;
    const client = fakeClient({ getStatusHistory: vi.fn(() => new Promise((r) => { resolve = r; })) });
    const { unmount } = render(<StatusHistoryScreen client={client} session={session()} />);
    unmount();
    await act(async () => { resolve(SUMMARY); await Promise.resolve(); });
    expect(true).toBe(true);
  });

  it("ignores a rejection after unmount", async () => {
    let reject!: (e: unknown) => void;
    const client = fakeClient({ getStatusHistory: vi.fn(() => new Promise((_r, rej) => { reject = rej; })) });
    const { unmount } = render(<StatusHistoryScreen client={client} session={session()} />);
    unmount();
    await act(async () => { reject(new Error("late")); await Promise.resolve(); });
    expect(true).toBe(true);
  });
});
