import { describe, it, expect, beforeEach } from "vitest";
import {
  CircuitBreakerManager,
  DEFAULT_THRESHOLDS,
  type BreakerThresholds,
  type Observation,
} from "../src/circuit_breaker.js";

const OK: Observation = { ok: true, safetyViolation: false, driftSeverity: 0 };
const ERR: Observation = { ok: false, safetyViolation: false, driftSeverity: 0 };
const UNSAFE: Observation = { ok: true, safetyViolation: true, driftSeverity: 0 };
const DRIFTY: Observation = { ok: true, safetyViolation: false, driftSeverity: 0.9 };

const TH: BreakerThresholds = {
  maxErrorRate: 0.2,
  maxSafetyViolationRate: 0.05,
  maxDriftSeverity: 0.5,
  minObservations: 5,
  cooldownMs: 1000,
};

let t: number;
const clock = () => t;

describe("CircuitBreakerManager (S82)", () => {
  let mgr: CircuitBreakerManager;
  beforeEach(() => {
    t = 10_000;
    mgr = new CircuitBreakerManager(clock, TH);
  });

  it("starts closed and allows traffic for an unknown agent", () => {
    expect(mgr.allows("ghost")).toBe(true);
    expect(mgr.state("ghost")).toBe("closed");
    expect(mgr.snapshot("ghost")).toBeNull();
  });

  it("does not trip before minObservations even with all errors", () => {
    for (let i = 0; i < TH.minObservations - 1; i++) {
      expect(mgr.record("a", ERR)).toBeNull();
    }
    expect(mgr.state("a")).toBe("closed");
    expect(mgr.allows("a")).toBe(true);
  });

  it("trips open on excessive error rate", () => {
    for (let i = 0; i < TH.minObservations; i++) mgr.record("a", ERR);
    expect(mgr.state("a")).toBe("open");
    expect(mgr.allows("a")).toBe(false);
    expect(mgr.snapshot("a")!.lastReason).toContain("error rate");
    expect(mgr.trippedAgents()).toEqual(["a"]);
  });

  it("trips open on excessive safety-violation rate", () => {
    // 1 unsafe in 5 = 0.2 > 0.05 threshold.
    mgr.record("a", OK);
    mgr.record("a", OK);
    mgr.record("a", OK);
    mgr.record("a", OK);
    const tr = mgr.record("a", UNSAFE);
    expect(tr?.to).toBe("open");
    expect(mgr.snapshot("a")!.lastReason).toContain("safety-violation");
  });

  it("trips open on excessive drift severity", () => {
    mgr.record("a", OK);
    mgr.record("a", OK);
    mgr.record("a", OK);
    mgr.record("a", OK);
    const tr = mgr.record("a", DRIFTY);
    expect(tr?.to).toBe("open");
    expect(mgr.snapshot("a")!.lastReason).toContain("drift severity");
  });

  it("stays closed when all signals are within thresholds", () => {
    for (let i = 0; i < 20; i++) mgr.record("a", OK);
    expect(mgr.state("a")).toBe("closed");
  });

  it("records a transition only when the state changes", () => {
    for (let i = 0; i < 4; i++) expect(mgr.record("a", ERR)).toBeNull();
    const tr = mgr.record("a", ERR); // 5th -> trips
    expect(tr).not.toBeNull();
    expect(mgr.transitions().length).toBe(1);
  });

  it("moves open -> half_open after cooldown, and a clean probe closes it", () => {
    for (let i = 0; i < TH.minObservations; i++) mgr.record("a", ERR);
    expect(mgr.state("a")).toBe("open");
    // Before cooldown, an observation does nothing (still open).
    t += 500;
    expect(mgr.record("a", OK)).toBeNull();
    expect(mgr.state("a")).toBe("open");
    // After cooldown, the next record transitions to half_open.
    t += 600; // now 1100ms since trip
    const toHalf = mgr.record("a", OK);
    expect(toHalf?.to).toBe("half_open");
    // The probe itself (next clean obs) closes the breaker.
    const closed = mgr.record("a", OK);
    expect(closed?.to).toBe("closed");
    expect(mgr.allows("a")).toBe(true);
  });

  it("half_open probe failure re-trips to open", () => {
    for (let i = 0; i < TH.minObservations; i++) mgr.record("a", ERR);
    t += 1100;
    mgr.record("a", OK); // -> half_open
    expect(mgr.state("a")).toBe("half_open");
    const retrip = mgr.record("a", ERR); // bad probe
    expect(retrip?.to).toBe("open");
  });

  it("half_open probe that is unsafe also re-trips", () => {
    for (let i = 0; i < TH.minObservations; i++) mgr.record("a", ERR);
    t += 1100;
    mgr.record("a", OK); // -> half_open
    const retrip = mgr.record("a", UNSAFE);
    expect(retrip?.to).toBe("open");
  });

  it("manual reset closes a tripped breaker and clears counters", () => {
    for (let i = 0; i < TH.minObservations; i++) mgr.record("a", ERR);
    expect(mgr.state("a")).toBe("open");
    const tr = mgr.reset("a");
    expect(tr?.to).toBe("closed");
    expect(tr?.reason).toContain("manual reset");
    expect(mgr.state("a")).toBe("closed");
    expect(mgr.snapshot("a")!.observations).toBe(0);
    expect(mgr.allows("a")).toBe(true);
  });

  it("reset on an unknown agent returns null", () => {
    expect(mgr.reset("ghost")).toBeNull();
  });

  it("snapshot reports rates and state", () => {
    mgr.record("a", ERR);
    mgr.record("a", OK);
    const s = mgr.snapshot("a")!;
    expect(s.observations).toBe(2);
    expect(s.errorRate).toBe(0.5);
    expect(s.state).toBe("closed");
  });

  it("isolates breakers per agent", () => {
    for (let i = 0; i < TH.minObservations; i++) mgr.record("a", ERR);
    for (let i = 0; i < TH.minObservations; i++) mgr.record("b", OK);
    expect(mgr.state("a")).toBe("open");
    expect(mgr.state("b")).toBe("closed");
    expect(mgr.trippedAgents()).toEqual(["a"]);
  });

  it("transitions() returns a defensive copy", () => {
    for (let i = 0; i < TH.minObservations; i++) mgr.record("a", ERR);
    const h = mgr.transitions();
    h.pop();
    expect(mgr.transitions().length).toBe(1);
  });

  it("defaults to the system clock and DEFAULT_THRESHOLDS when not injected", () => {
    const m = new CircuitBreakerManager();
    // DEFAULT_THRESHOLDS.minObservations is 5; all errors should trip.
    for (let i = 0; i < DEFAULT_THRESHOLDS.minObservations; i++) m.record("a", ERR);
    expect(m.state("a")).toBe("open");
  });
});
