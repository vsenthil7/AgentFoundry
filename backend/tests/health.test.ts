import { describe, it, expect } from "vitest";
import {
  HealthAggregator,
  replicationProbe,
  queueDepthProbe,
  type ComponentHealth,
} from "../src/health.js";

function probe(c: ComponentHealth): () => ComponentHealth {
  return () => c;
}

describe("HealthAggregator", () => {
  it("reports healthy when all components are healthy", () => {
    const h = new HealthAggregator()
      .register(probe({ name: "a", state: "healthy", critical: true }))
      .register(probe({ name: "b", state: "healthy", critical: false }));
    const r = h.report();
    expect(r.state).toBe("healthy");
    expect(r.healthyCount).toBe(2);
  });

  it("degrades when a component is degraded", () => {
    const h = new HealthAggregator()
      .register(probe({ name: "a", state: "healthy", critical: true }))
      .register(probe({ name: "b", state: "degraded", critical: true }));
    expect(h.report().state).toBe("degraded");
  });

  it("goes down when a critical component is down", () => {
    const h = new HealthAggregator()
      .register(probe({ name: "a", state: "down", critical: true }))
      .register(probe({ name: "b", state: "healthy", critical: false }));
    expect(h.report().state).toBe("down");
  });

  it("only degrades when a non-critical component is down", () => {
    const h = new HealthAggregator()
      .register(probe({ name: "a", state: "healthy", critical: true }))
      .register(probe({ name: "b", state: "down", critical: false }));
    expect(h.report().state).toBe("degraded");
  });

  it("sorts components by name", () => {
    const h = new HealthAggregator()
      .register(probe({ name: "z", state: "healthy", critical: false }))
      .register(probe({ name: "a", state: "healthy", critical: false }));
    expect(h.report().components.map((c) => c.name)).toEqual(["a", "z"]);
  });

  it("includes a checkedAt timestamp", () => {
    const h = new HealthAggregator(() => "2026-06-08T12:00:00.000Z");
    expect(h.report().checkedAt).toBe("2026-06-08T12:00:00.000Z");
  });

  it("reports healthy with no probes", () => {
    expect(new HealthAggregator().report().state).toBe("healthy");
  });
});

describe("replicationProbe", () => {
  it("healthy when primary up, replicas synced", () => {
    const p = replicationProbe(() => ({ primaryUp: true, healthyReplicas: 2, replicaCount: 2, lag: 0 }));
    expect(p().state).toBe("healthy");
  });
  it("degraded when primary down but replica available", () => {
    const p = replicationProbe(() => ({ primaryUp: false, healthyReplicas: 1, replicaCount: 2, lag: 0 }));
    expect(p().state).toBe("degraded");
  });
  it("down when no healthy node", () => {
    const p = replicationProbe(() => ({ primaryUp: false, healthyReplicas: 0, replicaCount: 2, lag: 0 }));
    expect(p().state).toBe("down");
  });
  it("degraded when there is replication lag", () => {
    const p = replicationProbe(() => ({ primaryUp: true, healthyReplicas: 1, replicaCount: 2, lag: 3 }));
    const c = p();
    expect(c.state).toBe("degraded");
    expect(c.detail).toContain("lag=3");
  });
});

describe("queueDepthProbe", () => {
  it("healthy below the warn threshold", () => {
    expect(queueDepthProbe("reviews", () => 2, 10)().state).toBe("healthy");
  });
  it("degraded above the warn threshold", () => {
    const c = queueDepthProbe("reviews", () => 20, 10)();
    expect(c.state).toBe("degraded");
    expect(c.detail).toContain("depth=20");
  });
});
