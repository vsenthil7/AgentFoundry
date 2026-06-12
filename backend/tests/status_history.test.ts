import { describe, it, expect } from "vitest";
import { PlatformStatusHistory } from "../src/status_history.js";
import type { PlatformStatusReport, PlatformState } from "../src/platform_status.js";

function report(state: PlatformState): PlatformStatusReport {
  return {
    state,
    summary: state,
    health: { state, healthyCount: 1, totalComponents: 1 },
    agents: { total: 1, deployed: 1, retired: 0 },
    reviews: { pending: 0 },
    drift: { agentsScanned: 0, regressions: 0 },
    billing: { tenantsBilled: 0, periodTotalMinor: 0, currency: "USD" },
    flags: [],
    generatedAt: new Date(0).toISOString(),
  };
}

describe("PlatformStatusHistory", () => {
  it("rejects non-positive retention", () => {
    expect(() => new PlatformStatusHistory(0)).toThrow();
  });

  it("summarizes an empty history", () => {
    const s = new PlatformStatusHistory().summary();
    expect(s.samples).toBe(0);
    expect(s.current).toBeNull();
    expect(s.trend).toBe("stable");
  });

  it("retains up to capacity, evicting oldest", () => {
    const h = new PlatformStatusHistory(2);
    h.record(report("healthy"));
    h.record(report("degraded"));
    h.record(report("down"));
    expect(h.count()).toBe(2);
    expect(h.list()[0].state).toBe("degraded");
  });

  it("reports an improving trend", () => {
    const h = new PlatformStatusHistory();
    h.record(report("down"));
    h.record(report("degraded"));
    h.record(report("healthy"));
    expect(h.summary().trend).toBe("improving");
    expect(h.summary().current).toBe("healthy");
  });

  it("reports a worsening trend", () => {
    const h = new PlatformStatusHistory();
    h.record(report("healthy"));
    h.record(report("down"));
    expect(h.summary().trend).toBe("worsening");
  });

  it("reports a stable trend when endpoints match", () => {
    const h = new PlatformStatusHistory();
    h.record(report("degraded"));
    h.record(report("healthy"));
    h.record(report("degraded"));
    expect(h.summary().trend).toBe("stable");
  });

  it("computes state fractions", () => {
    const h = new PlatformStatusHistory();
    h.record(report("healthy"));
    h.record(report("healthy"));
    h.record(report("degraded"));
    h.record(report("down"));
    const s = h.summary();
    expect(s.healthyFraction).toBe(0.5);
    expect(s.degradedFraction).toBe(0.25);
    expect(s.downFraction).toBe(0.25);
  });
});
