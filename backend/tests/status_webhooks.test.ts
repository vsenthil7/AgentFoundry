import { describe, it, expect } from "vitest";
import { StatusTransitionWatcher } from "../src/status_webhooks.js";
import { EventBus, type WebhookTransport } from "../src/events.js";

const okTransport: WebhookTransport = { post: async () => true };

function bus(): EventBus {
  return new EventBus({ transport: okTransport });
}

describe("StatusTransitionWatcher", () => {
  it("establishes a baseline on first observation without firing", async () => {
    const b = bus();
    const w = new StatusTransitionWatcher(b);
    const t = await w.observe("healthy");
    expect(t).toBeNull();
    expect(b.eventLog()).toHaveLength(0);
    expect(w.current()).toBe("healthy");
  });

  it("does not fire when state is unchanged", async () => {
    const b = bus();
    const w = new StatusTransitionWatcher(b);
    await w.observe("healthy");
    const t = await w.observe("healthy");
    expect(t).toBeNull();
    expect(b.eventLog()).toHaveLength(0);
  });

  it("fires platform.degraded on healthy -> degraded", async () => {
    const b = bus();
    const w = new StatusTransitionWatcher(b);
    await w.observe("healthy");
    const t = await w.observe("degraded");
    expect(t?.direction).toBe("degraded");
    expect(b.eventLog()[0].type).toBe("platform.degraded");
    expect(b.eventLog()[0].payload).toMatchObject({ from: "healthy", to: "degraded" });
  });

  it("fires platform.down on degraded -> down", async () => {
    const b = bus();
    const w = new StatusTransitionWatcher(b);
    await w.observe("degraded");
    const t = await w.observe("down");
    expect(t?.direction).toBe("degraded");
    expect(b.eventLog()[0].type).toBe("platform.down");
  });

  it("fires platform.recovered on down -> healthy (improved)", async () => {
    const b = bus();
    const w = new StatusTransitionWatcher(b);
    await w.observe("down");
    const t = await w.observe("healthy");
    expect(t?.direction).toBe("improved");
    expect(b.eventLog()[0].type).toBe("platform.recovered");
  });

  it("fires on each distinct transition in a sequence", async () => {
    const b = bus();
    const w = new StatusTransitionWatcher(b);
    await w.observe("healthy");
    await w.observe("degraded");
    await w.observe("down");
    await w.observe("healthy");
    expect(b.eventLog().map((e) => e.type)).toEqual([
      "platform.degraded",
      "platform.down",
      "platform.recovered",
    ]);
  });

  it("uses a custom tenant id for events", async () => {
    const b = bus();
    const w = new StatusTransitionWatcher(b, "acme-platform");
    await w.observe("healthy");
    await w.observe("degraded");
    expect(b.eventLog()[0].tenantId).toBe("acme-platform");
  });
});
