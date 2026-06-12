import type { RuntimeTrace } from "./monitoring.js";

// S9 — Cost governance.
// Per-run cost accounting, budget enforcement, and aggregation for ROI views.
// All arithmetic is deterministic and rounded to 6 dp for reproducibility.

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export interface CostModel {
  // Price per 1k tokens and per tool invocation, in abstract cost units.
  pricePer1kTokens: number;
  pricePerToolCall: number;
}

export interface RunCost {
  tokens: number;
  toolCalls: number;
  tokenCost: number;
  toolCost: number;
  total: number;
}

export function computeRunCost(
  tokens: number,
  toolCalls: number,
  model: CostModel,
): RunCost {
  const tokenCost = round((tokens / 1000) * model.pricePer1kTokens);
  const toolCost = round(toolCalls * model.pricePerToolCall);
  return {
    tokens,
    toolCalls,
    tokenCost,
    toolCost,
    total: round(tokenCost + toolCost),
  };
}

export interface Budget {
  // Per-run ceiling and a rolling total ceiling for the agent.
  perRunLimit: number;
  totalLimit: number;
}

export type BudgetVerdict =
  | { state: "ok"; spent: number; remaining: number }
  | { state: "per_run_exceeded"; runCost: number; limit: number }
  | { state: "total_exceeded"; spent: number; limit: number };

// Enforce a budget given prior spend and a new run cost.
export function enforceBudget(
  budget: Budget,
  priorSpend: number,
  runCost: number,
): BudgetVerdict {
  if (runCost > budget.perRunLimit) {
    return { state: "per_run_exceeded", runCost, limit: budget.perRunLimit };
  }
  const spent = round(priorSpend + runCost);
  if (spent > budget.totalLimit) {
    return { state: "total_exceeded", spent, limit: budget.totalLimit };
  }
  return { state: "ok", spent, remaining: round(budget.totalLimit - spent) };
}

export interface CostSummary {
  agentId: string;
  runs: number;
  totalTokens: number;
  totalCost: number;
  avgCostPerRun: number;
  avgLatencyMs: number;
}

// Aggregate runtime traces into a per-agent cost/ROI summary.
export function summariseCost(
  agentId: string,
  traces: RuntimeTrace[],
): CostSummary {
  const own = traces.filter((t) => t.agentId === agentId);
  const runs = own.length;
  const totalTokens = own.reduce((s, t) => s + t.tokenCost, 0);
  const totalCost = round(totalTokens); // tokenCost field carries cost units
  const avgLatency =
    runs === 0 ? 0 : round(own.reduce((s, t) => s + t.latencyMs, 0) / runs);
  return {
    agentId,
    runs,
    totalTokens,
    totalCost,
    avgCostPerRun: runs === 0 ? 0 : round(totalCost / runs),
    avgLatencyMs: avgLatency,
  };
}
