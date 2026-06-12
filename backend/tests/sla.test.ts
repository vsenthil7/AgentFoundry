import { describe, it, expect } from "vitest";
import { SlaTracker, SlaTrackerError } from "../src/sla.js";

const HOUR = 3600_000;

describe("SlaTracker — targets", () => {
  it("rejects an out-of-range target", () => {
    const t = new SlaTracker();
    expect(() => t.setTarget("a1", { target: 0 })).toThrow(SlaTrackerError);
    expect(() => t.setTarget("a1", { target: 1.5 })).toThrow(SlaTrackerError);
  });
  it("accepts a valid target", () => {
    const t = new SlaTracker();
    expect(() => t.setTarget("a1", { target: 0.999 })).not.toThrow();
  });
});

describe("SlaTracker — uptime", () => {
  it("reports 100% uptime with no downtime", () => {
    const t = new SlaTracker();
    const r = t.report("a1", 0, 10 * HOUR);
    expect(r.uptime).toBe(1);
    expect(r.breached).toBe(false);
  });

  it("accumulates downtime from a down/up window", () => {
    const t = new SlaTracker();
    t.setTarget("a1", { target: 0.99 });
    t.record("a1", "down", 2 * HOUR);
    t.record("a1", "up", 3 * HOUR); // 1 hour down
    const r = t.report("a1", 0, 10 * HOUR);
    expect(r.downMs).toBe(HOUR);
    expect(r.upMs).toBe(9 * HOUR);
    expect(r.uptime).toBeCloseTo(0.9, 5);
    expect(r.breached).toBe(true); // 90% < 99%
  });

  it("handles down extending to the end of the window", () => {
    const t = new SlaTracker();
    t.record("a1", "down", 8 * HOUR);
    const r = t.report("a1", 0, 10 * HOUR);
    expect(r.downMs).toBe(2 * HOUR);
  });

  it("treats state before the window from prior transitions", () => {
    const t = new SlaTracker();
    t.record("a1", "down", -1 * HOUR); // down before window starts
    t.record("a1", "up", 2 * HOUR); // recovers 2h into window
    const r = t.report("a1", 0, 10 * HOUR);
    expect(r.downMs).toBe(2 * HOUR); // down for first 2h of window
  });

  it("ignores transitions outside the window", () => {
    const t = new SlaTracker();
    t.record("a1", "down", 20 * HOUR); // after window
    const r = t.report("a1", 0, 10 * HOUR);
    expect(r.downMs).toBe(0);
  });

  it("computes error budget remaining", () => {
    const t = new SlaTracker();
    t.setTarget("a1", { target: 0.9 }); // allows 10% = 1h downtime over 10h
    t.record("a1", "down", 1 * HOUR);
    t.record("a1", "up", 1.5 * HOUR); // 30 min down
    const r = t.report("a1", 0, 10 * HOUR);
    expect(r.errorBudgetMsRemaining).toBe(HOUR - 0.5 * HOUR); // 30 min left
  });

  it("uses a default target when none set", () => {
    const t = new SlaTracker();
    const r = t.report("a1", 0, 10 * HOUR);
    expect(r.target).toBe(0.99);
  });
});

describe("SlaTracker — validation", () => {
  it("rejects out-of-order transitions", () => {
    const t = new SlaTracker();
    t.record("a1", "down", 5 * HOUR);
    expect(() => t.record("a1", "up", 2 * HOUR)).toThrow(SlaTrackerError);
  });

  it("rejects a non-positive window", () => {
    const t = new SlaTracker();
    expect(() => t.report("a1", 10, 10)).toThrow(SlaTrackerError);
  });

  it("handles multiple down/up cycles", () => {
    const t = new SlaTracker();
    t.record("a1", "down", 1 * HOUR);
    t.record("a1", "up", 2 * HOUR); // 1h down
    t.record("a1", "down", 5 * HOUR);
    t.record("a1", "up", 6 * HOUR); // 1h down
    const r = t.report("a1", 0, 10 * HOUR);
    expect(r.downMs).toBe(2 * HOUR);
  });
});
