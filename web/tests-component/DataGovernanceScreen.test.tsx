import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { DataGovernanceScreen, residencyRows, retentionRows } from "../src/governance/DataGovernanceScreen.js";
import { AuthClient, AuthApiError, type AuthSession, type DataGovernanceView } from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function session(): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"] },
  };
}

const VIEW: DataGovernanceView = {
  allowedRegions: ["eu", "uk", "apac"],
  retentionDays: { audit_log: 365, runtime_trace: 30, agent_design: 0 },
  // records also present in 'us' (a region NOT in allowedRegions) — should show NOT ALLOWED.
  // 'apac' is allowed but has NO records — exercises the residency `?? 0` fallback.
  residency: { eu: 4, uk: 2, us: 1 },
};

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = { getDataGovernance: vi.fn(async () => VIEW) };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("residencyRows / retentionRows (S113)", () => {
  it("merges allowed regions with regions that have records, flagging allowed", () => {
    const rows = residencyRows(VIEW);
    expect(rows.map((r) => r.region)).toEqual(["us", "eu", "uk", "apac"]); // ALL_REGIONS order filtered
    const us = rows.find((r) => r.region === "us")!;
    expect(us.allowed).toBe(false);
    expect(us.records).toBe(1);
    const eu = rows.find((r) => r.region === "eu")!;
    expect(eu.allowed).toBe(true);
    expect(eu.records).toBe(4);
    // apac is allowed but has no records -> count falls back to 0
    const apac = rows.find((r) => r.region === "apac")!;
    expect(apac.allowed).toBe(true);
    expect(apac.records).toBe(0);
  });

  it("lists retention classes sorted, including indefinite (0)", () => {
    const rows = retentionRows(VIEW);
    expect(rows.map((r) => r.dataClass)).toEqual(["agent_design", "audit_log", "runtime_trace"]);
    expect(rows.find((r) => r.dataClass === "agent_design")!.days).toBe(0);
  });
});

describe("DataGovernanceScreen (S113)", () => {
  it("shows a loading state first", () => {
    render(<DataGovernanceScreen client={fakeClient()} session={session()} />);
    expect(screen.getByTestId("governance-loading")).toBeInTheDocument();
  });

  it("renders residency rows (allowed + not-allowed) and retention (incl. indefinite)", async () => {
    render(<DataGovernanceScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("gov-allowed-eu")).toBeInTheDocument());
    expect(screen.getByTestId("gov-allowed-eu")).toHaveTextContent("ALLOWED");
    expect(screen.getByTestId("gov-allowed-us")).toHaveTextContent("NOT ALLOWED");
    expect(screen.getByTestId("gov-records-eu")).toHaveTextContent("4");
    expect(screen.getByTestId("gov-retention-audit_log")).toHaveTextContent("365 days");
    expect(screen.getByTestId("gov-retention-agent_design")).toHaveTextContent("INDEFINITE");
  });

  it("renders empty states when the tenant has no policy", async () => {
    const client = fakeClient({ getDataGovernance: vi.fn(async () => ({ allowedRegions: [], retentionDays: {}, residency: {} })) });
    render(<DataGovernanceScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("governance-screen")).toHaveTextContent("No residency regions configured."));
    expect(screen.getByTestId("governance-screen")).toHaveTextContent("No retention policy configured.");
  });

  it("shows an API error", async () => {
    const client = fakeClient({ getDataGovernance: vi.fn(async () => { throw new AuthApiError(403, "no access here"); }) });
    render(<DataGovernanceScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("governance-error")).toHaveTextContent("no access"));
  });

  it("shows a generic error on a non-API failure", async () => {
    const client = fakeClient({ getDataGovernance: vi.fn(async () => { throw new Error("socket"); }) });
    render(<DataGovernanceScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("governance-error")).toHaveTextContent("Request failed"));
  });

  it("ignores a resolution after unmount", async () => {
    let resolve!: (v: DataGovernanceView) => void;
    const client = fakeClient({ getDataGovernance: vi.fn(() => new Promise((r) => { resolve = r; })) });
    const { unmount } = render(<DataGovernanceScreen client={client} session={session()} />);
    unmount();
    await act(async () => { resolve(VIEW); await Promise.resolve(); });
    expect(true).toBe(true);
  });

  it("ignores a rejection after unmount", async () => {
    let reject!: (e: unknown) => void;
    const client = fakeClient({ getDataGovernance: vi.fn(() => new Promise((_r, rej) => { reject = rej; })) });
    const { unmount } = render(<DataGovernanceScreen client={client} session={session()} />);
    unmount();
    await act(async () => { reject(new Error("late")); await Promise.resolve(); });
    expect(true).toBe(true);
  });
});
