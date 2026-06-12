import { describe, it, expect } from "vitest";
import { runStatusRecord, statusRecorderJob } from "../src/status_recorder.js";
import { PlatformStatus, type PlatformStatusInputs, type PlatformState } from "../src/platform_status.js";
import { PlatformStatusHistory } from "../src/status_history.js";
import { InMemoryChannel } from "../src/notifications.js";
import { Scheduler } from "../src/scheduler.js";

function inputs(state: PlatformState): PlatformStatusInputs {
  return {
    health: { state, healthyCount: state === "healthy" ? 2 : 1, totalComponents: 2 },
    agents: { total: 1, deployed: 1, retired: 0 },
    reviews: { pending: 0 },
    drift: { agentsScanned: 1, regressions: 0 },
    billing: { tenantsBilled: 1, periodTotalMinor: 10000, currency: "USD" },
  };
}

describe("runStatusRecord", () => {
  it("records a status report into history", () => {
    const history = new PlatformStatusHistory();
    const result = runStatusRecord({ status: new PlatformStatus(), history, collect: () => inputs("healthy") });
    expect(result.state).toBe("healthy");
    expect(result.totalSamples).toBe(1);
    expect(history.count()).toBe(1);
  });

  it("does not alert when healthy", () => {
    const channel = new InMemoryChannel();
    runStatusRecord({ status: new PlatformStatus(), history: new PlatformStatusHistory(), collect: () => inputs("healthy"), channel });
    expect(channel.sent).toHaveLength(0);
  });

  it("alerts when degraded", () => {
    const channel = new InMemoryChannel();
    runStatusRecord({ status: new PlatformStatus(), history: new PlatformStatusHistory(), collect: () => inputs("degraded"), channel });
    expect(channel.for("on-call")).toHaveLength(1);
    expect(channel.for("on-call")[0].subject).toContain("degraded");
  });

  it("alerts when down to a custom recipient", () => {
    const channel = new InMemoryChannel();
    runStatusRecord({ status: new PlatformStatus(), history: new PlatformStatusHistory(), collect: () => inputs("down"), channel, recipient: "sre", now: () => "2026-06-09T16:00:00.000Z" });
    expect(channel.for("sre")).toHaveLength(1);
    expect(channel.for("sre")[0].timestamp).toBe("2026-06-09T16:00:00.000Z");
  });

  it("includes the flags in the alert body for a non-healthy state", () => {
    const channel = new InMemoryChannel();
    runStatusRecord({ status: new PlatformStatus(), history: new PlatformStatusHistory(), collect: () => ({ ...inputs("down"), health: { state: "down", healthyCount: 0, totalComponents: 2 } }), channel });
    expect(channel.for("on-call")[0].body).toContain("PLATFORM DOWN");
  });

  it("works without a channel configured", () => {
    expect(() => runStatusRecord({ status: new PlatformStatus(), history: new PlatformStatusHistory(), collect: () => inputs("degraded") })).not.toThrow();
  });
});

describe("statusRecorderJob", () => {
  it("records on each tick and builds the trend", async () => {
    const history = new PlatformStatusHistory();
    const states: PlatformState[] = ["down", "degraded", "healthy"];
    let i = 0;
    const job = statusRecorderJob("status-recorder", 1000, {
      status: new PlatformStatus(), history, collect: () => inputs(states[i++]),
    });
    let t = 0;
    const scheduler = new Scheduler(() => t);
    scheduler.schedule(job);
    for (const tick of [1000, 2000, 3000]) {
      t = tick;
      await scheduler.tick();
    }
    expect(history.count()).toBe(3);
    expect(history.summary().trend).toBe("improving");
  });
});
