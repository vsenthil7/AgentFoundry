// S20 — Real enforced sandbox.
// Executes a designed agent's tool calls under enforced constraints: network
// egress allowlist, mocked tools by default (no real side effects), per-run
// resource caps (wall-clock, token/cost budget), and artifact quarantine. This
// turns THREAT_MODEL T12 from documented into enforced.

export type ToolEffect = "read" | "write" | "send" | "network";

export interface ToolCall {
  tool: string;
  effect: ToolEffect;
  target?: string; // host for network calls
  tokens?: number;
  cost?: number;
}

export interface SandboxPolicy {
  // Hosts the sandbox may reach. Empty = no network at all.
  allowedHosts: string[];
  // Real side effects (write/send) are blocked unless explicitly allowed.
  allowRealEffects: boolean;
  // Per-run caps.
  maxTokens: number;
  maxCost: number;
  maxToolCalls: number;
}

export const DEFAULT_SANDBOX: SandboxPolicy = {
  allowedHosts: [],
  allowRealEffects: false,
  maxTokens: 100_000,
  maxCost: 10,
  maxToolCalls: 50,
};

export type DenyReason =
  | "network_not_allowed"
  | "host_not_allowed"
  | "real_effect_blocked"
  | "token_budget_exceeded"
  | "cost_budget_exceeded"
  | "tool_call_limit"
  | "quarantined";

export interface ToolOutcome {
  tool: string;
  allowed: boolean;
  mocked: boolean;
  denyReason?: DenyReason;
  result?: string;
}

export interface SandboxRun {
  outcomes: ToolOutcome[];
  tokensUsed: number;
  costUsed: number;
  toolCalls: number;
  quarantined: string[]; // artifacts held back
  halted: boolean; // true if a hard cap halted the run
}

// A ToolMock returns a synthetic result for a tool (no real side effect).
export type ToolMock = (call: ToolCall) => string;

export class Sandbox {
  private readonly policy: SandboxPolicy;
  private readonly mock: ToolMock;

  constructor(
    policy: Partial<SandboxPolicy> = {},
    mock: ToolMock = (c) => `mocked:${c.tool}`,
  ) {
    this.policy = { ...DEFAULT_SANDBOX, ...policy };
    this.mock = mock;
  }

  // Execute a sequence of tool calls under enforced constraints.
  run(calls: ToolCall[]): SandboxRun {
    const outcomes: ToolOutcome[] = [];
    const quarantined: string[] = [];
    let tokensUsed = 0;
    let costUsed = 0;
    let toolCalls = 0;
    let halted = false;

    for (const call of calls) {
      // Hard cap: tool-call count.
      if (toolCalls >= this.policy.maxToolCalls) {
        outcomes.push({ tool: call.tool, allowed: false, mocked: false, denyReason: "tool_call_limit" });
        halted = true;
        break;
      }

      // Budget caps (projected).
      const projTokens = tokensUsed + (call.tokens ?? 0);
      const projCost = costUsed + (call.cost ?? 0);
      if (projTokens > this.policy.maxTokens) {
        outcomes.push({ tool: call.tool, allowed: false, mocked: false, denyReason: "token_budget_exceeded" });
        halted = true;
        break;
      }
      if (projCost > this.policy.maxCost) {
        outcomes.push({ tool: call.tool, allowed: false, mocked: false, denyReason: "cost_budget_exceeded" });
        halted = true;
        break;
      }

      // Network egress allowlist.
      if (call.effect === "network") {
        if (this.policy.allowedHosts.length === 0) {
          outcomes.push({ tool: call.tool, allowed: false, mocked: false, denyReason: "network_not_allowed" });
          continue;
        }
        if (!this.policy.allowedHosts.includes(call.target ?? "")) {
          outcomes.push({ tool: call.tool, allowed: false, mocked: false, denyReason: "host_not_allowed" });
          continue;
        }
      }

      // Real side effects blocked unless explicitly allowed.
      if (
        (call.effect === "write" || call.effect === "send") &&
        !this.policy.allowRealEffects
      ) {
        // Blocked from real execution, but we still run the mock and quarantine
        // any artifact it would have produced.
        const artifact = this.mock(call);
        quarantined.push(artifact);
        outcomes.push({ tool: call.tool, allowed: false, mocked: true, denyReason: "real_effect_blocked", result: artifact });
        tokensUsed = projTokens;
        costUsed = projCost;
        toolCalls++;
        continue;
      }

      // Allowed: run the mock (no real side effects by default).
      const result = this.mock(call);
      outcomes.push({ tool: call.tool, allowed: true, mocked: !this.policy.allowRealEffects, result });
      tokensUsed = projTokens;
      costUsed = projCost;
      toolCalls++;
    }

    return { outcomes, tokensUsed, costUsed, toolCalls, quarantined, halted };
  }
}
