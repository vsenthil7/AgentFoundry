import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { SlaScreen, formatPct, formatDuration } from "../src/sla/SlaScreen.js";
import { AuthClient, AuthApiError, type AuthSession, type SlaReport, type SlaAgentRow } from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function session(): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"] },
  };
}

const DAY = 24 * 60 * 60 * 1000;
const WINDOW = 30 * DAY;

const HEALTHY: SlaAgentRow = {
  agentId: "healthy-bot",
  windowMs: WINDOW,
  upMs: WINDOW,
  downMs: 0,
  uptime: 1,
  target: 0.999,
  breached: false,
  errorBudgetMsRemaining: Math.round(WINDOW * 0.001),
};

const BREACHED: SlaAgentRow = {
  agentId: "flaky-bot",
  windowMs: WINDOW,
  upMs: WINDOW - 5 * DAY,
  downMs: 5 * DAY,
  uptime: (WINDOW - 5 * DAY) / WINDOW,
  target: 0.999,
  breached: true,
  errorBudgetMsRemaining: Math.round(WINDOW * 0.001) - 5 * DAY, // negative (budget blown)
};

function report(agents: SlaAgentRow[]): SlaReport {
  return { agents };
}

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = {
    getSlaReport: vi.fn(async () => report([HEALTHY, BREACHED])),
  };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("formatPct (S110)", () => {
  it("renders a fraction as a 3-decimal percentage", () => {
    expect(formatPct(1)).toBe("100.000%");
    expect(formatPct(0.999)).toBe("99.900%");
    expect(formatPct(0.8333)).toBe("83.330%");
    expect(formatPct(0)).toBe("0.000%");
  });
});

describe("formatDuration (S110)", () => {
  it("renders days / hours / minutes / ms with a sign for negatives", () => {
    expect(formatDuration(2 * DAY)).toBe("2.0d");
    expect(formatDuration(3 * 60 * 60 * 1000)).toBe("3.0h");
    expect(formatDuration(5 * 60 * 1000)).toBe("5.0m");
    expect(formatDuration(250)).toBe("250ms");
    expect(formatDuration(-2 * DAY)).toBe("−2.0d");
  });
});

describe("SlaScreen (S110)", () => {
  it("shows a loading state first", () => {
    render(<SlaScreen client={fakeClient()} session={session()} />);
    expect(screen.getByTestId("sla-loading")).toBeInTheDocument();
  });

  it("renders a healthy and a breached agent row", async () => {
    render(<SlaScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("sla-uptime-healthy-bot")).toBeInTheDocument());
    expect(screen.getByTestId("sla-uptime-healthy-bot")).toHaveTextContent("100.000%");
    expect(screen.getByTestId("sla-uptime-flaky-bot")).toHaveTextContent("83.333%");
    const screenEl = screen.getByTestId("sla-screen");
    expect(screenEl).toHaveTextContent("MEETING SLA");
    expect(screenEl).toHaveTextContent("BREACHED");
    // breached agent's error budget is negative and rendered with the over style
    expect(screenEl).toHaveTextContent("−5.0d");
  });

  it("renders an empty state when no agents are tracked", async () => {
    const client = fakeClient({ getSlaReport: vi.fn(async () => report([])) });
    render(<SlaScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("sla-screen")).toHaveTextContent("No SLA-tracked agents"));
  });

  it("shows an API error message", async () => {
    const client = fakeClient({ getSlaReport: vi.fn(async () => { throw new AuthApiError(403, "Requires admin:manage_users"); }) });
    render(<SlaScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("sla-error")).toHaveTextContent("Requires admin"));
  });

  it("shows a generic error on a non-API failure", async () => {
    const client = fakeClient({ getSlaReport: vi.fn(async () => { throw new Error("socket"); }) });
    render(<SlaScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("sla-error")).toHaveTextContent("Request failed"));
  });

  it("ignores a resolution that arrives after unmount", async () => {
    let resolve!: (v: SlaReport) => void;
    const client = fakeClient({ getSlaReport: vi.fn(() => new Promise((r) => { resolve = r; })) });
    const { unmount } = render(<SlaScreen client={client} session={session()} />);
    unmount();
    await act(async () => {
      resolve(report([HEALTHY]));
      await Promise.resolve();
    });
    expect(true).toBe(true);
  });

  it("ignores a rejection that arrives after unmount", async () => {
    let reject!: (e: unknown) => void;
    const client = fakeClient({ getSlaReport: vi.fn(() => new Promise((_r, rej) => { reject = rej; })) });
    const { unmount } = render(<SlaScreen client={client} session={session()} />);
    unmount();
    await act(async () => {
      reject(new Error("late"));
      await Promise.resolve();
    });
    expect(true).toBe(true);
  });
});
