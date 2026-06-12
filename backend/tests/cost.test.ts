import { describe, it, expect } from "vitest";
import {
  computeRunCost,
  enforceBudget,
  summariseCost,
  type CostModel,
  type Budget,
} from "../src/cost.js";
import type { RuntimeTrace } from "../src/monitoring.js";

const model: CostModel = { pricePer1kTokens: 2, pricePerToolCall: 0.5 };

describe("computeRunCost", () => {
  it("computes token + tool cost", () => {
    const c = computeRunCost(2000, 3, model);
    expect(c.tokenCost).toBe(4); // 2000/1000 * 2
    expect(c.toolCost).toBe(1.5); // 3 * 0.5
    expect(c.total).toBe(5.5);
  });

  it("handles zero usage", () => {
    const c = computeRunCost(0, 0, model);
    expect(c.total).toBe(0);
  });
});

describe("enforceBudget", () => {
  const budget: Budget = { perRunLimit: 10, totalLimit: 100 };

  it("returns ok with remaining when within limits", () => {
    const v = enforceBudget(budget, 50, 5);
    expect(v.state).toBe("ok");
    if (v.state === "ok") {
      expect(v.spent).toBe(55);
      expect(v.remaining).toBe(45);
    }
  });

  it("blocks when a single run exceeds the per-run limit", () => {
    const v = enforceBudget(budget, 0, 20);
    expect(v.state).toBe("per_run_exceeded");
    if (v.state === "per_run_exceeded") {
      expect(v.runCost).toBe(20);
      expect(v.limit).toBe(10);
    }
  });

  it("blocks when cumulative spend exceeds the total limit", () => {
    const v = enforceBudget(budget, 98, 5);
    expect(v.state).toBe("total_exceeded");
    if (v.state === "total_exceeded") {
      expect(v.spent).toBe(103);
      expect(v.limit).toBe(100);
    }
  });

  it("allows spend exactly at the total limit", () => {
    const v = enforceBudget(budget, 95, 5);
    expect(v.state).toBe("ok");
  });

  it("allows a run exactly at the per-run limit", () => {
    const v = enforceBudget(budget, 0, 10);
    expect(v.state).toBe("ok");
  });
});

describe("summariseCost", () => {
  function t(over: Partial<RuntimeTrace>): RuntimeTrace {
    return {
      agentId: "acme-support-bot",
      version: "1.0.0",
      timestamp: "2026-06-08T00:00:00.000Z",
      groundedAccuracy: 1,
      safetyPassRate: 1,
      tokenCost: 10,
      latencyMs: 200,
      ...over,
    };
  }

  it("aggregates cost and latency for an agent", () => {
    const traces = [t({ tokenCost: 10, latencyMs: 100 }), t({ tokenCost: 30, latencyMs: 300 })];
    const s = summariseCost("acme-support-bot", traces);
    expect(s.runs).toBe(2);
    expect(s.totalCost).toBe(40);
    expect(s.avgCostPerRun).toBe(20);
    expect(s.avgLatencyMs).toBe(200);
  });

  it("ignores other agents' traces", () => {
    const traces = [t({}), t({ agentId: "other", tokenCost: 999 })];
    const s = summariseCost("acme-support-bot", traces);
    expect(s.runs).toBe(1);
    expect(s.totalCost).toBe(10);
  });

  it("returns zeros for an agent with no traces", () => {
    const s = summariseCost("acme-support-bot", []);
    expect(s.runs).toBe(0);
    expect(s.avgCostPerRun).toBe(0);
    expect(s.avgLatencyMs).toBe(0);
  });
});
