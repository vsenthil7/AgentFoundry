import { describe, it, expect } from "vitest";
import {
  UsageAlertEngine,
  DEFAULT_QUOTA_ALERTS,
} from "../src/usage_alerts.js";

describe("checkQuota", () => {
  it("returns null below the warn threshold", () => {
    const e = new UsageAlertEngine();
    expect(e.checkQuota("t1", "agents", 5, 100)).toBeNull();
  });
  it("warns at the warn threshold", () => {
    const e = new UsageAlertEngine();
    const a = e.checkQuota("t1", "agents", 80, 100);
    expect(a?.severity).toBe("warning");
    expect(a?.kind).toBe("quota_threshold");
  });
  it("criticals at the critical threshold", () => {
    const e = new UsageAlertEngine();
    expect(e.checkQuota("t1", "agents", 96, 100)?.severity).toBe("critical");
  });
  it("returns null for a non-positive limit", () => {
    const e = new UsageAlertEngine();
    expect(e.checkQuota("t1", "agents", 5, 0)).toBeNull();
  });
  it("respects custom thresholds", () => {
    const e = new UsageAlertEngine({ warnAt: 0.5, criticalAt: 0.9 });
    expect(e.checkQuota("t1", "agents", 60, 100)?.severity).toBe("warning");
  });
  it("exposes default thresholds", () => {
    expect(DEFAULT_QUOTA_ALERTS.warnAt).toBe(0.8);
  });
});

describe("detectSpike", () => {
  it("returns null with insufficient samples", () => {
    const e = new UsageAlertEngine();
    e.recordPeriod("t1", "api_calls", 100);
    e.recordPeriod("t1", "api_calls", 100);
    expect(e.detectSpike("t1", "api_calls", 1000)).toBeNull();
  });

  it("detects a spike above the baseline", () => {
    const e = new UsageAlertEngine();
    for (const v of [100, 110, 90]) e.recordPeriod("t1", "api_calls", v);
    const a = e.detectSpike("t1", "api_calls", 500);
    expect(a?.kind).toBe("usage_spike");
    expect(a?.severity).toBe("critical");
  });

  it("returns null when within the factor", () => {
    const e = new UsageAlertEngine();
    for (const v of [100, 100, 100]) e.recordPeriod("t1", "api_calls", v);
    expect(e.detectSpike("t1", "api_calls", 150)).toBeNull();
  });

  it("returns null when baseline mean is zero", () => {
    const e = new UsageAlertEngine();
    for (const v of [0, 0, 0]) e.recordPeriod("t1", "api_calls", v);
    expect(e.detectSpike("t1", "api_calls", 50)).toBeNull();
  });

  it("respects a custom factor", () => {
    const e = new UsageAlertEngine();
    for (const v of [100, 100, 100]) e.recordPeriod("t1", "api_calls", v);
    expect(e.detectSpike("t1", "api_calls", 160, 1.5)?.kind).toBe("usage_spike");
  });

  it("exposes the baseline", () => {
    const e = new UsageAlertEngine();
    e.recordPeriod("t1", "agents", 5);
    expect(e.baseline("t1", "agents")).toEqual([5]);
    expect(e.baseline("t1", "deployments")).toEqual([]);
  });
});

describe("evaluate", () => {
  it("returns both quota and spike alerts when both fire", () => {
    const e = new UsageAlertEngine();
    for (const v of [10, 10, 10]) e.recordPeriod("t1", "api_calls", v);
    const alerts = e.evaluate({ tenantId: "t1", resource: "api_calls", used: 100, limit: 100 });
    expect(alerts.map((a) => a.kind).sort()).toEqual(["quota_threshold", "usage_spike"]);
  });

  it("returns no alerts when usage is normal", () => {
    const e = new UsageAlertEngine();
    expect(e.evaluate({ tenantId: "t1", resource: "agents", used: 1, limit: 100 })).toEqual([]);
  });

  it("returns only a quota alert when no baseline exists", () => {
    const e = new UsageAlertEngine();
    const alerts = e.evaluate({ tenantId: "t1", resource: "agents", used: 96, limit: 100 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("quota_threshold");
  });
});
