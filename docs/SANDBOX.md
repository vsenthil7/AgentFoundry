# Real Enforced Sandbox (S20)

Executes a designed agent's tool calls under enforced constraints — the runtime
counterpart to the design-time guardrail. Closes THREAT_MODEL T12.

## Enforced constraints
- **Network egress allowlist** — empty allowlist = no network (`network_not_allowed`);
  a host not on the list is blocked (`host_not_allowed`).
- **Tool mocking** — tools are mocked by default; no real side effects occur unless
  `allowRealEffects` is explicitly set.
- **Real-effect blocking** — write/send tools are blocked by default; the artifact
  they would have produced is quarantined for review (`real_effect_blocked`).
- **Resource caps** — per-run token budget, cost budget, and tool-call count; exceeding
  any hard cap halts the run (`token_budget_exceeded` / `cost_budget_exceeded` /
  `tool_call_limit`).

## Outcome
`run(calls)` returns per-call outcomes (allowed/mocked/denyReason/result), cumulative
tokens + cost, tool-call count, the quarantined artifacts, and whether a cap halted the
run. Production swaps the mock for a real isolated executor behind the same interface.
