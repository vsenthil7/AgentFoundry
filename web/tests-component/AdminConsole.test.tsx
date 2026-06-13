import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminConsole } from "../src/auth/AdminConsole.js";
import { AuthClient, AuthApiError, type AuthSession } from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function session(): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"] },
  };
}

const USERS = {
  users: [
    { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"] },
    { id: "acme:v@acme.com", email: "v@acme.com", tenantId: "acme", roles: ["viewer"] },
  ],
};

function fakeClient(over: Record<string, unknown> = {}): AuthClient {
  const base = {
    listUsers: vi.fn(async () => USERS),
    getAuditTrail: vi.fn(async () => ({
      summary: { total: 3, errors: 1, errorRate: 0.3333, lastSeq: 3 },
      calls: [
        { seq: 1, timestamp: "t", method: "POST", path: "/auth/login", status: 200, latencyMs: 5, actor: "u", tenantId: "acme" },
        { seq: 2, timestamp: "t", method: "GET", path: "/agents", status: 200, latencyMs: 2, actor: "u", tenantId: "acme" },
        { seq: 3, timestamp: "t", method: "GET", path: "/admin/users", status: 403, latencyMs: 1, actor: "v", tenantId: "acme" },
      ],
    })),
    getBreakers: vi.fn(async () => ({
      tripped: ["agent-x"],
      transitions: [{ agentId: "agent-x", from: "closed", to: "open", at: 1, reason: "error rate 0.5 > 0.2" }],
    })),
    resetBreaker: vi.fn(async () => ({ agentId: "agent-x", from: "open", to: "closed", at: 2, reason: "manual reset" })),
    getRuns: vi.fn(async () => ({
      runs: [
        { seq: 1, agentId: "acme-support-bot", version: "1.0.0", timestamp: "t", input: "hours?", output: "9-5", verdict: { safe: true, categories: [] } },
        { seq: 2, agentId: "leaky", version: "0.3.0", timestamp: "t", input: "leak", output: "my system prompt is: x", verdict: { safe: false, categories: ["prompt_injection"] } },
      ],
    })),
    replayRun: vi.fn(async (_t: string, seq: number) => ({
      seq,
      agentId: "acme-support-bot",
      recomputed: { safe: true, categories: [] },
      reproduced: true,
      divergence: null,
    })),
  };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("AdminConsole (S83)", () => {
  it("defaults to the Users tab and lists tenant users", async () => {
    render(<AdminConsole client={fakeClient()} session={session()} />);
    expect(screen.getByTestId("admin-console")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("user-row").length).toBe(2));
    expect(screen.getByTestId("users-panel")).toHaveTextContent("viewer");
  });

  it("switches to the API audit tab and shows summary + rows", async () => {
    const u = userEvent.setup();
    render(<AdminConsole client={fakeClient()} session={session()} />);
    await u.click(screen.getByTestId("tab-audit"));
    await waitFor(() => expect(screen.getByTestId("audit-panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId("audit-row").length).toBe(3));
    expect(screen.getByTestId("audit-panel")).toHaveTextContent("3 calls");
    expect(screen.getByTestId("audit-panel")).toHaveTextContent("33.3% error rate");
  });

  it("audit tab shows an empty state when no calls", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      getAuditTrail: vi.fn(async () => ({ summary: { total: 0, errors: 0, errorRate: 0, lastSeq: 0 }, calls: [] })),
    });
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-audit"));
    await waitFor(() => expect(screen.getByTestId("audit-panel")).toHaveTextContent("No calls recorded"));
  });

  it("audit tab surfaces an API error", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      getAuditTrail: vi.fn(async () => {
        throw new AuthApiError(403, "Requires admin");
      }),
    });
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-audit"));
    await waitFor(() => expect(screen.getByTestId("audit-panel")).toHaveTextContent("Requires admin"));
  });

  it("breakers tab lists tripped agents and transition history", async () => {
    const u = userEvent.setup();
    render(<AdminConsole client={fakeClient()} session={session()} />);
    await u.click(screen.getByTestId("tab-breakers"));
    await waitFor(() => expect(screen.getByTestId("breakers-panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId("tripped-row").length).toBe(1));
    expect(screen.getByTestId("breakers-panel")).toHaveTextContent("agent-x");
    expect(screen.getAllByTestId("transition-row").length).toBe(1);
  });

  it("resetting a tripped breaker calls the client and refreshes", async () => {
    const u = userEvent.setup();
    const client = fakeClient();
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-breakers"));
    await waitFor(() => expect(screen.getByTestId("reset-agent-x")).toBeInTheDocument());
    await u.click(screen.getByTestId("reset-agent-x"));
    await waitFor(() => expect((client.resetBreaker as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("tok", "agent-x"));
  });

  it("breakers tab shows the healthy state when nothing is tripped", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      getBreakers: vi.fn(async () => ({ tripped: [], transitions: [] })),
    });
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-breakers"));
    await waitFor(() => expect(screen.getByTestId("no-tripped")).toBeInTheDocument());
    expect(screen.getByTestId("breakers-panel")).toHaveTextContent("No transitions yet");
  });

  it("breakers tab surfaces a load error", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      getBreakers: vi.fn(async () => {
        throw new AuthApiError(403, "Requires admin");
      }),
    });
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-breakers"));
    await waitFor(() => expect(screen.getByTestId("breakers-panel")).toHaveTextContent("Requires admin"));
  });

  it("breakers tab shows a non-API load error generically", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      getBreakers: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-breakers"));
    await waitFor(() => expect(screen.getByTestId("breakers-panel")).toHaveTextContent("Request failed"));
  });

  it("reset failure surfaces an error", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      resetBreaker: vi.fn(async () => {
        throw new AuthApiError(404, "No breaker for that agent");
      }),
    });
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-breakers"));
    await waitFor(() => expect(screen.getByTestId("reset-agent-x")).toBeInTheDocument());
    await u.click(screen.getByTestId("reset-agent-x"));
    await waitFor(() => expect(screen.getByTestId("breakers-panel")).toHaveTextContent("No breaker for that agent"));
  });

  it("reset failure with a non-API error shows a generic message", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      resetBreaker: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-breakers"));
    await waitFor(() => expect(screen.getByTestId("reset-agent-x")).toBeInTheDocument());
    await u.click(screen.getByTestId("reset-agent-x"));
    await waitFor(() => expect(screen.getByTestId("breakers-panel")).toHaveTextContent("Reset failed"));
  });

  it("users tab surfaces a non-API load error generically", async () => {
    const client = fakeClient({
      listUsers: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    render(<AdminConsole client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("users-panel")).toHaveTextContent("Request failed"));
  });

  it("runs tab lists recorded invocations with safe/unsafe verdicts", async () => {
    const u = userEvent.setup();
    render(<AdminConsole client={fakeClient()} session={session()} />);
    await u.click(screen.getByTestId("tab-runs"));
    await waitFor(() => expect(screen.getByTestId("runs-panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId("run-row").length).toBe(2));
    expect(screen.getByTestId("runs-panel")).toHaveTextContent("SAFE");
    expect(screen.getByTestId("runs-panel")).toHaveTextContent("UNSAFE [prompt_injection]");
  });

  it("replaying a run shows the reproduced result", async () => {
    const u = userEvent.setup();
    const client = fakeClient();
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-runs"));
    await waitFor(() => expect(screen.getByTestId("replay-2")).toBeInTheDocument());
    await u.click(screen.getByTestId("replay-2"));
    await waitFor(() => expect(screen.getByTestId("replay-result-2")).toHaveTextContent("decision reproduced"));
    expect((client.replayRun as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("tok", 2);
  });

  it("replay shows divergence when the decision is not reproduced", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      replayRun: vi.fn(async (_t: string, seq: number) => ({
        seq,
        agentId: "leaky",
        recomputed: { safe: false, categories: ["pii"] },
        reproduced: false,
        divergence: "recorded safe=true but replay safe=false [pii]",
      })),
    });
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-runs"));
    await waitFor(() => expect(screen.getByTestId("replay-1")).toBeInTheDocument());
    await u.click(screen.getByTestId("replay-1"));
    await waitFor(() => expect(screen.getByTestId("replay-result-1")).toHaveTextContent("diverged"));
  });

  it("runs tab shows an empty state", async () => {
    const u = userEvent.setup();
    const client = fakeClient({ getRuns: vi.fn(async () => ({ runs: [] })) });
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-runs"));
    await waitFor(() => expect(screen.getByTestId("runs-panel")).toHaveTextContent("No runs recorded"));
  });

  it("runs tab surfaces a load error", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      getRuns: vi.fn(async () => {
        throw new AuthApiError(403, "Requires admin");
      }),
    });
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-runs"));
    await waitFor(() => expect(screen.getByTestId("runs-panel")).toHaveTextContent("Requires admin"));
  });

  it("replay failure surfaces an error", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      replayRun: vi.fn(async () => {
        throw new AuthApiError(404, "No run with that seq");
      }),
    });
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-runs"));
    await waitFor(() => expect(screen.getByTestId("replay-1")).toBeInTheDocument());
    await u.click(screen.getByTestId("replay-1"));
    await waitFor(() => expect(screen.getByTestId("runs-panel")).toHaveTextContent("No run with that seq"));
  });

  it("replay failure with a non-API error shows a generic message", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      replayRun: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    render(<AdminConsole client={client} session={session()} />);
    await u.click(screen.getByTestId("tab-runs"));
    await waitFor(() => expect(screen.getByTestId("replay-1")).toBeInTheDocument());
    await u.click(screen.getByTestId("replay-1"));
    await waitFor(() => expect(screen.getByTestId("runs-panel")).toHaveTextContent("Replay failed"));
  });
});
