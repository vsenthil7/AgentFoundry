import { describe, it, expect, beforeEach } from "vitest";
import { rateLimitMiddleware, defaultKeyFor } from "../src/rate_limit_middleware.js";
import type { ApiRequest, ApiResponse } from "../src/api.js";

function req(over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: "GET",
    path: "/agents",
    headers: {},
    query: {},
    params: {},
    body: null,
    ...over,
  };
}

const okHandler = async (): Promise<ApiResponse> => ({ status: 200, body: { ok: true } });

let t: number;
const clock = () => t;

describe("rateLimitMiddleware (S84)", () => {
  beforeEach(() => {
    t = 1_000_000;
  });

  it("allows requests while tokens remain and adds a remaining header", async () => {
    const mw = rateLimitMiddleware({ config: { capacity: 3, refillPerSecond: 0 }, now: clock });
    const r1 = await mw(req({ userId: "u1" }), okHandler);
    expect(r1.status).toBe(200);
    expect(r1.headers!["x-ratelimit-remaining"]).toBe("2");
    const r2 = await mw(req({ userId: "u1" }), okHandler);
    expect(r2.headers!["x-ratelimit-remaining"]).toBe("1");
  });

  it("rejects with 429 + Retry-After when the bucket is empty", async () => {
    const mw = rateLimitMiddleware({ config: { capacity: 1, refillPerSecond: 1 }, now: clock });
    await mw(req({ userId: "u1" }), okHandler); // consumes the only token
    const denied = await mw(req({ userId: "u1" }), okHandler);
    expect(denied.status).toBe(429);
    expect(denied.headers!["retry-after"]).toBe("1");
    expect(denied.headers!["x-ratelimit-remaining"]).toBe("0");
    expect((denied.body as { error: string }).error).toContain("Rate limit");
  });

  it("refills over time and allows again", async () => {
    const mw = rateLimitMiddleware({ config: { capacity: 1, refillPerSecond: 1 }, now: clock });
    await mw(req({ userId: "u1" }), okHandler);
    expect((await mw(req({ userId: "u1" }), okHandler)).status).toBe(429);
    t += 1000; // one token refilled
    expect((await mw(req({ userId: "u1" }), okHandler)).status).toBe(200);
  });

  it("isolates buckets per principal", async () => {
    const mw = rateLimitMiddleware({ config: { capacity: 1, refillPerSecond: 0 }, now: clock });
    expect((await mw(req({ userId: "u1" }), okHandler)).status).toBe(200);
    expect((await mw(req({ userId: "u1" }), okHandler)).status).toBe(429);
    // Different user has its own bucket.
    expect((await mw(req({ userId: "u2" }), okHandler)).status).toBe(200);
  });

  it("exempts configured path prefixes", async () => {
    const mw = rateLimitMiddleware({
      config: { capacity: 1, refillPerSecond: 0 },
      now: clock,
      exemptPrefixes: ["/health"],
    });
    // Health is exempt: never limited even when called repeatedly.
    expect((await mw(req({ path: "/health" }), okHandler)).status).toBe(200);
    expect((await mw(req({ path: "/health/live" }), okHandler)).status).toBe(200);
    expect((await mw(req({ path: "/health" }), okHandler)).status).toBe(200);
  });

  it("reports Retry-After 0 when refill rate is zero (never refills)", async () => {
    const mw = rateLimitMiddleware({ config: { capacity: 1, refillPerSecond: 0 }, now: clock });
    await mw(req({ userId: "u1" }), okHandler);
    const denied = await mw(req({ userId: "u1" }), okHandler);
    expect(denied.status).toBe(429);
    expect(denied.headers!["retry-after"]).toBe("0"); // Infinity -> 0
  });

  it("supports a custom cost per request", async () => {
    const mw = rateLimitMiddleware({ config: { capacity: 5, refillPerSecond: 0 }, now: clock, cost: 3 });
    expect((await mw(req({ userId: "u1" }), okHandler)).status).toBe(200); // 5 -> 2
    expect((await mw(req({ userId: "u1" }), okHandler)).status).toBe(429); // need 3, have 2
  });

  it("supports a custom keyFor", async () => {
    const mw = rateLimitMiddleware({
      config: { capacity: 1, refillPerSecond: 0 },
      now: clock,
      keyFor: () => "shared",
    });
    expect((await mw(req({ userId: "u1" }), okHandler)).status).toBe(200);
    // Different user, same custom key -> shares the bucket.
    expect((await mw(req({ userId: "u2" }), okHandler)).status).toBe(429);
  });

  it("exposes the underlying limiter for observability", async () => {
    const mw = rateLimitMiddleware({ config: { capacity: 2, refillPerSecond: 0 }, now: clock });
    await mw(req({ userId: "u1" }), okHandler);
    expect(mw.limiter.peek("user:u1")).toBe(1);
  });

  describe("defaultKeyFor", () => {
    it("keys authenticated requests by principal", () => {
      expect(defaultKeyFor(req({ userId: "alice" }))).toBe("user:alice");
    });
    it("keys anonymous by x-forwarded-for when present", () => {
      expect(defaultKeyFor(req({ headers: { "x-forwarded-for": "1.2.3.4" } }))).toBe("anon:1.2.3.4");
    });
    it("falls back to x-real-ip then 'anon'", () => {
      expect(defaultKeyFor(req({ headers: { "x-real-ip": "5.6.7.8" } }))).toBe("anon:5.6.7.8");
      expect(defaultKeyFor(req())).toBe("anon:anon");
    });
  });
});
