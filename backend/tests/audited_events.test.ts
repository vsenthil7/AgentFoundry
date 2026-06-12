import { describe, it, expect } from "vitest";
import { AuditedEventStore } from "../src/audited_events.js";
import type { PlatformEvent } from "../src/events.js";

function evt(over: Partial<PlatformEvent> = {}): PlatformEvent {
  return {
    id: "evt-0",
    type: "agent.deployed",
    tenantId: "t1",
    subject: "acme-support-bot",
    payload: { version: "1.0.0" },
    timestamp: new Date(0).toISOString(),
    ...over,
  };
}

describe("AuditedEventStore", () => {
  it("records an event into the tamper-evident ledger", () => {
    const store = new AuditedEventStore();
    store.record(evt());
    expect(store.size()).toBe(1);
    expect(store.verify().valid).toBe(true);
  });

  it("records a batch of events", () => {
    const store = new AuditedEventStore();
    store.recordAll([
      evt({ id: "evt-0", type: "agent.registered" }),
      evt({ id: "evt-1", type: "promotion.approved" }),
      evt({ id: "evt-2", type: "agent.deployed" }),
    ]);
    expect(store.size()).toBe(3);
    expect(store.verify().valid).toBe(true);
  });

  it("exposes ledger entries with chained hashes", () => {
    const store = new AuditedEventStore();
    store.record(evt({ id: "evt-0" }));
    store.record(evt({ id: "evt-1", type: "agent.retired" }));
    const entries = store.entries();
    expect(entries).toHaveLength(2);
    expect(entries[1].prevHash).toBe(entries[0].hash);
  });

  it("preserves the event payload in the audit detail", () => {
    const store = new AuditedEventStore();
    store.record(evt({ payload: { reviewer: "r@acme.test" } }));
    expect(store.entries()[0].detail).toContain("r@acme.test");
  });

  it("uses the action field for the event type", () => {
    const store = new AuditedEventStore();
    store.record(evt({ type: "regression.detected" }));
    expect(store.entries()[0].action).toBe("regression.detected");
  });

  it("verifies an empty store as valid", () => {
    expect(new AuditedEventStore().verify().valid).toBe(true);
  });

  it("accepts a custom clock", () => {
    const store = new AuditedEventStore(() => "2026-06-08T12:00:00.000Z");
    store.record(evt());
    expect(store.entries()[0].timestamp).toBe("2026-06-08T12:00:00.000Z");
  });
});
