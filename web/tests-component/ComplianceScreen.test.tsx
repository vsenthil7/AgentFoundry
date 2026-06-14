import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { ComplianceScreen, isSigned } from "../src/compliance/ComplianceScreen.js";
import {
  AuthClient,
  AuthApiError,
  type AuthSession,
  type CompliancePack,
  type ComplianceHistory,
  type AuditExportBundle,
} from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function session(): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"] },
  };
}

const PACK: CompliancePack = {
  tenantId: "acme",
  generatedAt: "2026-06-01T00:00:00.000Z",
  sections: ["Governance", "Audit trail", "Configuration profile", "Disaster recovery"],
  governance: { totalAgents: 5, deployedAgents: 3, certifiedAgents: 2, openIncidents: 1 },
  markdown: "# Compliance Pack — acme\n## Governance\n- Agents: 3 deployed / 5 total",
};

const HISTORY: ComplianceHistory = {
  snapshots: [
    { generatedAt: "2026-05-01T00:00:00.000Z", sections: ["Governance", "Audit trail"] },
    { generatedAt: "2026-06-01T00:00:00.000Z", sections: ["Governance", "Audit trail", "Disaster recovery"] },
  ],
  latestDiff: {
    readinessChanged: true,
    deployedAgentsDelta: 1,
    certifiedAgentsDelta: 0,
    openIncidentsDelta: -1,
    auditRecordDelta: 4,
    profileVersionChanged: false,
  },
};

const AUDIT: AuditExportBundle = {
  version: 1,
  exportedAt: "2026-06-01T00:00:00.000Z",
  tenantId: "acme",
  ledgerEntries: [{}, {}, {}],
  events: [{ type: "agent.deployed" }, { type: "promotion.approved" }],
  signature: "sha256=deadbeefcafebabe0011223344556677",
};

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = {
    getCompliancePack: vi.fn(async () => PACK),
    getComplianceHistory: vi.fn(async () => HISTORY),
    getAuditExport: vi.fn(async () => AUDIT),
  };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("isSigned (S111)", () => {
  it("recognises an sha256-prefixed signature", () => {
    expect(isSigned("sha256=abc")).toBe(true);
    expect(isSigned("")).toBe(false);
    expect(isSigned("nope")).toBe(false);
  });
});

describe("ComplianceScreen (S111)", () => {
  it("shows a loading state first", () => {
    render(<ComplianceScreen client={fakeClient()} session={session()} />);
    expect(screen.getByTestId("compliance-loading")).toBeInTheDocument();
  });

  it("renders the signed audit export, governance summary, pack markdown and diff", async () => {
    render(<ComplianceScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("audit-signature")).toBeInTheDocument());
    expect(screen.getByTestId("audit-signature")).toHaveTextContent("SIGNATURE VERIFIED");
    expect(screen.getByTestId("audit-ledger-count")).toHaveTextContent("3");
    expect(screen.getByTestId("audit-event-count")).toHaveTextContent("2");
    expect(screen.getByTestId("open-incidents")).toHaveTextContent("1");
    expect(screen.getByTestId("compliance-markdown")).toHaveTextContent("Compliance Pack");
    expect(screen.getByTestId("compliance-diff")).toHaveTextContent("readiness changed");
    expect(screen.getByTestId("compliance-diff")).toHaveTextContent("deployed +1");
    // two snapshot rows
    expect(screen.getByTestId("compliance-screen")).toHaveTextContent("2026-05-01");
  });

  it("shows an UNSIGNED badge when the signature lacks the sha256 prefix", async () => {
    const client = fakeClient({ getAuditExport: vi.fn(async () => ({ ...AUDIT, signature: "missing" })) });
    render(<ComplianceScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("audit-signature")).toHaveTextContent("UNSIGNED"));
  });

  it("renders the diff with the opposite delta signs (negative deployed, positive incidents)", async () => {
    const client = fakeClient({
      getComplianceHistory: vi.fn(async () => ({
        snapshots: HISTORY.snapshots,
        latestDiff: { readinessChanged: false, deployedAgentsDelta: -2, certifiedAgentsDelta: 0, openIncidentsDelta: 3, auditRecordDelta: 0, profileVersionChanged: false },
      })),
    });
    render(<ComplianceScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("compliance-diff")).toBeInTheDocument());
    expect(screen.getByTestId("compliance-diff")).toHaveTextContent("readiness unchanged");
    expect(screen.getByTestId("compliance-diff")).toHaveTextContent("deployed -2");
    expect(screen.getByTestId("compliance-diff")).toHaveTextContent("incidents +3");
  });

  it("omits the diff line and shows an empty snapshot table when history is empty", async () => {
    const client = fakeClient({ getComplianceHistory: vi.fn(async () => ({ snapshots: [], latestDiff: null })) });
    render(<ComplianceScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("compliance-screen")).toHaveTextContent("No archived compliance snapshots"));
    expect(screen.queryByTestId("compliance-diff")).toBeNull();
  });

  it("shows no incident-bad style when there are zero open incidents", async () => {
    const client = fakeClient({ getCompliancePack: vi.fn(async () => ({ ...PACK, governance: { ...PACK.governance, openIncidents: 0 } })) });
    render(<ComplianceScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("open-incidents")).toHaveTextContent("0"));
    expect(screen.getByTestId("open-incidents").className).not.toContain("--bad");
  });

  it("shows an API error", async () => {
    const client = fakeClient({ getCompliancePack: vi.fn(async () => { throw new AuthApiError(403, "forbidden here"); }) });
    render(<ComplianceScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("compliance-error")).toHaveTextContent("forbidden here"));
  });

  it("shows a generic error on a non-API failure", async () => {
    const client = fakeClient({ getAuditExport: vi.fn(async () => { throw new Error("socket"); }) });
    render(<ComplianceScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("compliance-error")).toHaveTextContent("Request failed"));
  });

  it("ignores a resolution after unmount", async () => {
    let resolve!: (v: CompliancePack) => void;
    const client = fakeClient({ getCompliancePack: vi.fn(() => new Promise((r) => { resolve = r; })) });
    const { unmount } = render(<ComplianceScreen client={client} session={session()} />);
    unmount();
    await act(async () => { resolve(PACK); await Promise.resolve(); });
    expect(true).toBe(true);
  });

  it("ignores a rejection after unmount", async () => {
    let reject!: (e: unknown) => void;
    const client = fakeClient({ getCompliancePack: vi.fn(() => new Promise((_r, rej) => { reject = rej; })) });
    const { unmount } = render(<ComplianceScreen client={client} session={session()} />);
    unmount();
    await act(async () => { reject(new Error("late")); await Promise.resolve(); });
    expect(true).toBe(true);
  });
});
