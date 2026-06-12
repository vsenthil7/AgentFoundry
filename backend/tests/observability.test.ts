import { describe, it, expect, beforeEach } from "vitest";
import { MetricsRegistry } from "../src/observability.js";

let m: MetricsRegistry;
beforeEach(() => (m = new MetricsRegistry()));

describe("counters", () => {
  it("increments by default 1", () => {
    m.increment("requests");
    m.increment("requests");
    expect(m.counter("requests")).toBe(2);
  });
  it("increments by a custom amount", () => {
    m.increment("bytes", {}, 100);
    expect(m.counter("bytes")).toBe(100);
  });
  it("separates by labels", () => {
    m.increment("requests", { route: "/a" });
    m.increment("requests", { route: "/b" });
    expect(m.counter("requests", { route: "/a" })).toBe(1);
    expect(m.counter("requests", { route: "/b" })).toBe(1);
  });
  it("returns 0 for an unseen counter", () => {
    expect(m.counter("nope")).toBe(0);
  });
});

describe("gauges", () => {
  it("sets and reads a gauge", () => {
    m.setGauge("queue_depth", 5);
    expect(m.gauge("queue_depth")).toBe(5);
  });
  it("overwrites on set", () => {
    m.setGauge("g", 1);
    m.setGauge("g", 9);
    expect(m.gauge("g")).toBe(9);
  });
  it("returns 0 for an unseen gauge", () => {
    expect(m.gauge("nope")).toBe(0);
  });
});

describe("histograms + percentiles", () => {
  it("computes stats over observations", () => {
    for (const v of [10, 20, 30, 40, 50]) m.observe("lat", v);
    const h = m.histogram("lat");
    expect(h.count).toBe(5);
    expect(h.sum).toBe(150);
    expect(h.min).toBe(10);
    expect(h.max).toBe(50);
    expect(h.avg).toBe(30);
  });

  it("computes percentiles via nearest-rank", () => {
    for (let i = 1; i <= 100; i++) m.observe("lat", i);
    const h = m.histogram("lat");
    expect(h.p50).toBe(50);
    expect(h.p90).toBe(90);
    expect(h.p99).toBe(99);
  });

  it("returns zeros for an empty histogram", () => {
    const h = m.histogram("none");
    expect(h.count).toBe(0);
    expect(h.avg).toBe(0);
    expect(h.p50).toBe(0);
  });

  it("separates histograms by label", () => {
    m.observe("lat", 5, { route: "/a" });
    m.observe("lat", 500, { route: "/b" });
    expect(m.histogram("lat", { route: "/a" }).max).toBe(5);
    expect(m.histogram("lat", { route: "/b" }).max).toBe(500);
  });
});

describe("time()", () => {
  it("records a success and its duration", () => {
    const r = m.time("op", () => 42);
    expect(r).toBe(42);
    expect(m.counter("op_total", { status: "ok" })).toBe(1);
    expect(m.histogram("op_duration_ms").count).toBe(1);
  });

  it("records an error and rethrows", () => {
    expect(() =>
      m.time("op", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(m.counter("op_total", { status: "error" })).toBe(1);
    expect(m.histogram("op_duration_ms").count).toBe(1);
  });

  it("passes labels through", () => {
    m.time("op", () => 1, { tenant: "t1" });
    expect(m.counter("op_total", { tenant: "t1", status: "ok" })).toBe(1);
  });
});

describe("export", () => {
  it("emits counters, gauges, and histogram stats deterministically", () => {
    m.increment("requests", { route: "/a" });
    m.setGauge("queue_depth", 3);
    m.observe("lat", 10);
    m.observe("lat", 20);
    const out = m.export();
    expect(out).toContain('requests{route="/a"} 1');
    expect(out).toContain("queue_depth 3");
    expect(out).toContain("lat_count 2");
    expect(out).toContain("lat_sum 30");
    expect(out).toContain("lat_p99 20");
  });

  it("exports labeled histograms with stat suffix before the brace", () => {
    m.observe("lat", 7, { route: "/x" });
    const out = m.export();
    expect(out).toContain('lat_count{route="/x"} 1');
  });

  it("produces sorted, stable output", () => {
    m.increment("b");
    m.increment("a");
    const lines = m.export().split("\n");
    expect(lines).toEqual([...lines].sort());
  });
});

describe("reset", () => {
  it("clears all metrics", () => {
    m.increment("x");
    m.setGauge("g", 1);
    m.observe("h", 1);
    m.reset();
    expect(m.counter("x")).toBe(0);
    expect(m.gauge("g")).toBe(0);
    expect(m.histogram("h").count).toBe(0);
    expect(m.export()).toBe("");
  });
});
