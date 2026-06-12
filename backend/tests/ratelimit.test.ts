import { describe, it, expect } from "vitest";
import {
  RateLimiter,
  QuotaManager,
  QuotaExceededError,
} from "../src/ratelimit.js";

describe("RateLimiter — token bucket", () => {
  it("allows up to capacity then denies", () => {
    let t = 0;
    const rl = new RateLimiter({ capacity: 3, refillPerSecond: 1 }, () => t);
    expect(rl.consume("k").allowed).toBe(true);
    expect(rl.consume("k").allowed).toBe(true);
    expect(rl.consume("k").allowed).toBe(true);
    const denied = rl.consume("k");
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills over time", () => {
    let t = 0;
    const rl = new RateLimiter({ capacity: 2, refillPerSecond: 1 }, () => t);
    rl.consume("k");
    rl.consume("k");
    expect(rl.consume("k").allowed).toBe(false);
    t = 2000; // 2 seconds -> 2 tokens refilled
    expect(rl.consume("k").allowed).toBe(true);
  });

  it("caps refill at capacity", () => {
    let t = 0;
    const rl = new RateLimiter({ capacity: 2, refillPerSecond: 10 }, () => t);
    rl.consume("k");
    t = 100000; // huge elapsed
    expect(rl.peek("k")).toBe(2);
  });

  it("separates buckets by key", () => {
    let t = 0;
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 1 }, () => t);
    expect(rl.consume("a").allowed).toBe(true);
    expect(rl.consume("b").allowed).toBe(true);
    expect(rl.consume("a").allowed).toBe(false);
  });

  it("supports custom cost", () => {
    let t = 0;
    const rl = new RateLimiter({ capacity: 5, refillPerSecond: 1 }, () => t);
    expect(rl.consume("k", 3).allowed).toBe(true);
    expect(rl.consume("k", 3).allowed).toBe(false);
  });

  it("peek returns full capacity for an unseen key", () => {
    const rl = new RateLimiter({ capacity: 4, refillPerSecond: 1 }, () => 0);
    expect(rl.peek("new")).toBe(4);
  });

  it("retryAfter is Infinity when refill is zero", () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 0 }, () => 0);
    rl.consume("k");
    expect(rl.consume("k").retryAfterMs).toBe(Infinity);
  });

  it("uses the default clock when none injected", () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 1 });
    expect(rl.consume("k").allowed).toBe(true);
  });

  it("does not refill when no time elapses", () => {
    const rl = new RateLimiter({ capacity: 2, refillPerSecond: 5 }, () => 1000);
    rl.consume("k");
    // same timestamp -> no refill -> 1 remaining
    expect(rl.peek("k")).toBe(1);
  });
});

describe("QuotaManager", () => {
  const T = Date.parse("2026-06-08T00:00:00.000Z");

  it("records usage under the limit", () => {
    const q = new QuotaManager(() => T);
    q.setLimits("t1", { limits: { agents: 5 } });
    expect(q.record("t1", "agents")).toBe(1);
    expect(q.record("t1", "agents")).toBe(2);
  });

  it("throws when exceeding the limit", () => {
    const q = new QuotaManager(() => T);
    q.setLimits("t1", { limits: { deployments: 1 } });
    q.record("t1", "deployments");
    expect(() => q.record("t1", "deployments")).toThrow(QuotaExceededError);
  });

  it("treats unset resources as unlimited", () => {
    const q = new QuotaManager(() => T);
    q.setLimits("t1", { limits: { agents: 1 } });
    // eval_runs has no limit
    for (let i = 0; i < 100; i++) q.record("t1", "eval_runs");
    expect(q.status("t1", "eval_runs").used).toBe(100);
    expect(q.status("t1", "eval_runs").limit).toBeNull();
  });

  it("treats a tenant with no limits as unlimited", () => {
    const q = new QuotaManager(() => T);
    expect(q.record("t1", "agents", 999)).toBe(999);
  });

  it("reports status with remaining and exceeded", () => {
    const q = new QuotaManager(() => T);
    q.setLimits("t1", { limits: { agents: 2 } });
    q.record("t1", "agents");
    const s = q.status("t1", "agents");
    expect(s.used).toBe(1);
    expect(s.remaining).toBe(1);
    expect(s.exceeded).toBe(false);
    q.record("t1", "agents");
    expect(q.status("t1", "agents").exceeded).toBe(true);
  });

  it("produces a full report across resources", () => {
    const q = new QuotaManager(() => T);
    q.setLimits("t1", { limits: { agents: 10 } });
    q.record("t1", "agents", 3);
    const report = q.report("t1");
    expect(report).toHaveLength(4);
    const agents = report.find((r) => r.resource === "agents")!;
    expect(agents.used).toBe(3);
  });

  it("isolates usage by billing period (month)", () => {
    let t = Date.parse("2026-06-08T00:00:00.000Z");
    const q = new QuotaManager(() => t);
    q.setLimits("t1", { limits: { api_calls: 1 } });
    q.record("t1", "api_calls");
    expect(() => q.record("t1", "api_calls")).toThrow(QuotaExceededError);
    // next month -> fresh quota
    t = Date.parse("2026-07-08T00:00:00.000Z");
    expect(q.record("t1", "api_calls")).toBe(1);
  });

  it("uses the default clock when none injected", () => {
    const q = new QuotaManager();
    expect(q.record("t1", "agents")).toBe(1);
  });
});
