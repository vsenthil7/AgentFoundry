import { describe, it, expect } from "vitest";
import { runSlaEvaluation, slaEvaluationJob } from "../src/sla_eval.js";
import { SlaTracker } from "../src/sla.js";
import { InMemoryChannel } from "../src/notifications.js";
import { Scheduler } from "../src/scheduler.js";

const HOUR = 3600_000;
const WINDOW = 30 * 24 * HOUR; // 30 days
const NOW = WINDOW; // window is [0, WINDOW]

function trackerWith(downMs: number): SlaTracker {
  const t = new SlaTracker();
  t.setTarget("a1", { target: 0.999 });
  if (downMs > 0) {
    t.record("a1", "down", HOUR);
    t.record("a1", "up", HOUR + downMs);
  }
  return t;
}

describe("runSlaEvaluation", () => {
  it("reports no breach when uptime meets target", () => {
    const channel = new InMemoryChannel();
    const result = runSlaEvaluation({
      tracker: trackerWith(5 * 60_000), // 5 min down over 30 days -> ~99.99%
      channel, targets: () => [{ agentId: "a1" }],
      windowMs: WINDOW, nowMs: () => NOW,
    });
    expect(result.breaches).toBe(0);
    expect(channel.sent).toHaveLength(0);
  });

  it("alerts on a breach", () => {
    const channel = new InMemoryChannel();
    const result = runSlaEvaluation({
      tracker: trackerWith(10 * HOUR), // 10h down over 30 days -> breaches 99.9%
      channel, targets: () => [{ agentId: "a1" }],
      windowMs: WINDOW, nowMs: () => NOW,
    });
    expect(result.breaches).toBe(1);
    expect(channel.for("on-call")).toHaveLength(1);
    expect(channel.for("on-call")[0].subject).toContain("breached SLA");
  });

  it("routes alerts to a custom recipient", () => {
    const channel = new InMemoryChannel();
    runSlaEvaluation({
      tracker: trackerWith(10 * HOUR),
      channel, targets: () => [{ agentId: "a1" }],
      windowMs: WINDOW, nowMs: () => NOW, recipient: "sre",
      notifyTimestamp: () => "2026-06-09T12:00:00.000Z",
    });
    expect(channel.for("sre")).toHaveLength(1);
    expect(channel.for("sre")[0].timestamp).toBe("2026-06-09T12:00:00.000Z");
  });

  it("evaluates multiple agents in deterministic order", () => {
    const tracker = new SlaTracker();
    const channel = new InMemoryChannel();
    const result = runSlaEvaluation({
      tracker, channel,
      targets: () => [{ agentId: "b" }, { agentId: "a" }],
      windowMs: WINDOW, nowMs: () => NOW,
    });
    expect(result.reports.map((r) => r.agentId)).toEqual(["a", "b"]);
  });
});

describe("slaEvaluationJob", () => {
  it("runs via the scheduler and reports breaches", async () => {
    const channel = new InMemoryChannel();
    const job = slaEvaluationJob("sla-eval", 1000, {
      tracker: trackerWith(10 * HOUR),
      channel, targets: () => [{ agentId: "a1" }],
      windowMs: WINDOW, nowMs: () => NOW,
    });
    let t = 0;
    const scheduler = new Scheduler(() => t);
    scheduler.schedule(job);
    t = 1000;
    const runs = await scheduler.tick();
    expect(runs[0].detail).toContain("1 SLA breach");
  });
});
