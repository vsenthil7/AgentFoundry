import { describe, it, expect } from "vitest";
import { Sandbox, DEFAULT_SANDBOX, type ToolCall } from "../src/sandbox.js";

const read: ToolCall = { tool: "kb_lookup", effect: "read" };
const write: ToolCall = { tool: "update_ticket", effect: "write" };
const send: ToolCall = { tool: "send_email", effect: "send" };
const net = (host: string): ToolCall => ({ tool: "fetch", effect: "network", target: host });

describe("defaults", () => {
  it("blocks network and real effects by default", () => {
    expect(DEFAULT_SANDBOX.allowedHosts).toEqual([]);
    expect(DEFAULT_SANDBOX.allowRealEffects).toBe(false);
  });
});

describe("read tools", () => {
  it("allows a read tool, mocked by default", () => {
    const run = new Sandbox().run([read]);
    expect(run.outcomes[0].allowed).toBe(true);
    expect(run.outcomes[0].mocked).toBe(true);
    expect(run.outcomes[0].result).toBe("mocked:kb_lookup");
  });
});

describe("real effects", () => {
  it("blocks write effects and quarantines the artifact", () => {
    const run = new Sandbox().run([write]);
    expect(run.outcomes[0].allowed).toBe(false);
    expect(run.outcomes[0].denyReason).toBe("real_effect_blocked");
    expect(run.quarantined).toHaveLength(1);
  });

  it("blocks send effects", () => {
    const run = new Sandbox().run([send]);
    expect(run.outcomes[0].denyReason).toBe("real_effect_blocked");
  });

  it("allows real effects when explicitly enabled", () => {
    const run = new Sandbox({ allowRealEffects: true }).run([write]);
    expect(run.outcomes[0].allowed).toBe(true);
    expect(run.outcomes[0].mocked).toBe(false);
    expect(run.quarantined).toHaveLength(0);
  });
});

describe("network allowlist", () => {
  it("blocks all network when allowlist is empty", () => {
    const run = new Sandbox().run([net("api.example.com")]);
    expect(run.outcomes[0].denyReason).toBe("network_not_allowed");
  });

  it("blocks a host not on the allowlist", () => {
    const run = new Sandbox({ allowedHosts: ["api.allowed.com"] }).run([
      net("evil.example.com"),
    ]);
    expect(run.outcomes[0].denyReason).toBe("host_not_allowed");
  });

  it("allows an allowlisted host", () => {
    const run = new Sandbox({ allowedHosts: ["api.allowed.com"] }).run([
      net("api.allowed.com"),
    ]);
    expect(run.outcomes[0].allowed).toBe(true);
  });

  it("treats a missing target as not allowed", () => {
    const run = new Sandbox({ allowedHosts: ["api.allowed.com"] }).run([
      { tool: "fetch", effect: "network" },
    ]);
    expect(run.outcomes[0].denyReason).toBe("host_not_allowed");
  });
});

describe("budget caps", () => {
  it("halts on token budget", () => {
    const run = new Sandbox({ maxTokens: 100 }).run([
      { tool: "a", effect: "read", tokens: 60 },
      { tool: "b", effect: "read", tokens: 60 },
    ]);
    expect(run.outcomes[0].allowed).toBe(true);
    expect(run.outcomes[1].denyReason).toBe("token_budget_exceeded");
    expect(run.halted).toBe(true);
    expect(run.tokensUsed).toBe(60);
  });

  it("halts on cost budget", () => {
    const run = new Sandbox({ maxCost: 5 }).run([
      { tool: "a", effect: "read", cost: 3 },
      { tool: "b", effect: "read", cost: 3 },
    ]);
    expect(run.outcomes[1].denyReason).toBe("cost_budget_exceeded");
    expect(run.halted).toBe(true);
  });

  it("halts on tool-call limit", () => {
    const run = new Sandbox({ maxToolCalls: 1 }).run([read, read]);
    expect(run.outcomes[1].denyReason).toBe("tool_call_limit");
    expect(run.halted).toBe(true);
  });

  it("accumulates tokens and cost across allowed calls", () => {
    const run = new Sandbox({ maxTokens: 1000, maxCost: 100 }).run([
      { tool: "a", effect: "read", tokens: 10, cost: 1 },
      { tool: "b", effect: "read", tokens: 20, cost: 2 },
    ]);
    expect(run.tokensUsed).toBe(30);
    expect(run.costUsed).toBe(3);
    expect(run.toolCalls).toBe(2);
    expect(run.halted).toBe(false);
  });
});

describe("custom mock", () => {
  it("uses a supplied mock function", () => {
    const run = new Sandbox({}, (c) => `custom:${c.tool}`).run([read]);
    expect(run.outcomes[0].result).toBe("custom:kb_lookup");
  });
});

describe("mixed run", () => {
  it("processes reads, blocks effects, and continues", () => {
    const run = new Sandbox({ allowedHosts: ["ok.com"] }).run([
      read,
      net("ok.com"),
      net("bad.com"),
      write,
    ]);
    expect(run.outcomes[0].allowed).toBe(true); // read
    expect(run.outcomes[1].allowed).toBe(true); // allowed host
    expect(run.outcomes[2].denyReason).toBe("host_not_allowed");
    expect(run.outcomes[3].denyReason).toBe("real_effect_blocked");
    expect(run.quarantined).toHaveLength(1);
    expect(run.halted).toBe(false);
  });
});
