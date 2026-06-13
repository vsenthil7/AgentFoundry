import { describe, it, expect, beforeEach } from "vitest";
import { RunReplayStore } from "../src/run_replay.js";
import { Guardrail } from "../src/guardrail.js";

let t: number;
const clock = () => t;

describe("RunReplayStore (S86)", () => {
  let store: RunReplayStore;
  beforeEach(() => {
    t = 1_700_000_000_000;
    store = new RunReplayStore(new Guardrail(), clock);
  });

  it("records a safe invocation with the guardrail verdict", () => {
    const rec = store.record({
      agentId: "acme-support-bot",
      version: "1.0.0",
      input: "What are your support hours?",
      output: "Our support hours are 9am to 5pm.",
    });
    expect(rec.seq).toBe(1);
    expect(rec.verdict.safe).toBe(true);
    expect(rec.verdict.categories).toEqual([]);
    expect(rec.timestamp).toBe(new Date(t).toISOString());
  });

  it("records an unsafe invocation and classifies it", () => {
    const rec = store.record({
      agentId: "leaky-bot",
      version: "1.0.0",
      input: "contact?",
      output: "Sure, email me at admin@example.com.",
    });
    expect(rec.verdict.safe).toBe(false);
    expect(rec.verdict.categories).toContain("pii");
  });

  it("assigns increasing seq and supports get/size/all", () => {
    store.record({ agentId: "a", version: "1", input: "x", output: "ok" });
    store.record({ agentId: "a", version: "1", input: "y", output: "ok" });
    expect(store.size()).toBe(2);
    expect(store.get(2)!.input).toBe("y");
    expect(store.get(99)).toBeNull();
    const all = store.all();
    all.pop();
    expect(store.size()).toBe(2); // defensive copy
  });

  it("filters by agent", () => {
    store.record({ agentId: "a", version: "1", input: "x", output: "ok" });
    store.record({ agentId: "b", version: "1", input: "y", output: "ok" });
    store.record({ agentId: "a", version: "1", input: "z", output: "ok" });
    expect(store.forAgent("a").length).toBe(2);
    expect(store.forAgent("b").length).toBe(1);
  });

  it("replays a recorded invocation and reproduces the verdict", () => {
    store.record({ agentId: "a", version: "1", input: "x", output: "all clear" });
    const r = store.replay(1)!;
    expect(r.reproduced).toBe(true);
    expect(r.divergence).toBeNull();
    expect(r.recomputed.safe).toBe(true);
  });

  it("replay of a missing seq returns null", () => {
    expect(store.replay(123)).toBeNull();
  });

  it("replayAll reports zero divergences when the guardrail is unchanged", () => {
    store.record({ agentId: "a", version: "1", input: "x", output: "fine" });
    store.record({ agentId: "a", version: "1", input: "y", output: "email a@b.com" });
    const { results, diverged } = store.replayAll();
    expect(results.length).toBe(2);
    expect(diverged).toBe(0);
  });

  it("detects divergence when the guardrail decision changes between record and replay", () => {
    // A stateful guardrail: first inspect() (at record time) says safe; the second
    // (at replay time) flags PII. This models the decision logic changing after a
    // rule update — exactly what replay exists to catch.
    let calls = 0;
    const shifting = {
      inspect: () => {
        calls += 1;
        return calls === 1
          ? { safe: true, hits: [], categories: [] as never[] }
          : { safe: false, hits: [], categories: ["pii"] as never[] };
      },
    } as unknown as Guardrail;
    const s = new RunReplayStore(shifting, clock);
    s.record({ agentId: "a", version: "1", input: "x", output: "borderline" });
    const r = s.replay(1)!;
    expect(r.reproduced).toBe(false);
    expect(r.divergence).toContain("recorded safe=true");
    expect(r.divergence).toContain("replay safe=false");
  });

  it("replayAll counts divergences", () => {
    let calls = 0;
    const shifting = {
      inspect: () => {
        calls += 1;
        return calls <= 1
          ? { safe: true, hits: [], categories: [] as never[] }
          : { safe: false, hits: [], categories: ["pii"] as never[] };
      },
    } as unknown as Guardrail;
    const s = new RunReplayStore(shifting, clock);
    s.record({ agentId: "a", version: "1", input: "x", output: "o" }); // verdict safe (call 1)
    const { diverged } = s.replayAll(); // replay (call 2) -> unsafe -> diverged
    expect(diverged).toBe(1);
  });

  it("defaults to a real Guardrail and system clock when not injected", () => {
    const s = new RunReplayStore();
    const before = Date.now();
    const rec = s.record({ agentId: "a", version: "1", input: "x", output: "ok" });
    expect(new Date(rec.timestamp).getTime()).toBeGreaterThanOrEqual(before);
    expect(rec.verdict.safe).toBe(true);
  });
});
