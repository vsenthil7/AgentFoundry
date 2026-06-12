import { describe, it, expect } from "vitest";
import {
  EventBus,
  signPayload,
  verifySignature,
  SubscriptionNotFoundError,
  DEFAULT_WEBHOOK_RETRY,
  type WebhookTransport,
  type WebhookSubscription,
} from "../src/events.js";

const noSleep = () => Promise.resolve();

function okTransport(): WebhookTransport {
  return { post: async () => true };
}

function sub(over: Partial<WebhookSubscription> = {}): WebhookSubscription {
  return {
    id: "sub-1",
    tenantId: "t1",
    url: "https://hooks.acme.test/in",
    secret: "shh",
    events: ["agent.deployed"],
    active: true,
    ...over,
  };
}

describe("signing", () => {
  it("signs and verifies a payload", () => {
    const sig = signPayload("secret", "body");
    expect(sig.startsWith("sha256=")).toBe(true);
    expect(verifySignature("secret", "body", sig)).toBe(true);
  });
  it("rejects a wrong signature", () => {
    expect(verifySignature("secret", "body", "sha256=deadbeef")).toBe(false);
  });
});

describe("subscriptions", () => {
  it("subscribes and retrieves", () => {
    const bus = new EventBus({ transport: okTransport() });
    bus.subscribe(sub());
    expect(bus.getSubscription("sub-1").url).toBe("https://hooks.acme.test/in");
  });
  it("unsubscribes", () => {
    const bus = new EventBus({ transport: okTransport() });
    bus.subscribe(sub());
    expect(bus.unsubscribe("sub-1")).toBe(true);
    expect(bus.unsubscribe("sub-1")).toBe(false);
  });
  it("throws for unknown subscription", () => {
    const bus = new EventBus({ transport: okTransport() });
    expect(() => bus.getSubscription("ghost")).toThrow(SubscriptionNotFoundError);
  });
  it("freezes subscriptions", () => {
    const bus = new EventBus({ transport: okTransport() });
    expect(Object.isFrozen(bus.subscribe(sub()))).toBe(true);
  });
});

describe("publish + delivery", () => {
  it("appends to the event log", async () => {
    const bus = new EventBus({ transport: okTransport() });
    await bus.publish({ type: "agent.deployed", tenantId: "t1", subject: "a1" });
    expect(bus.eventLog()).toHaveLength(1);
    expect(bus.eventLog()[0].type).toBe("agent.deployed");
  });

  it("delivers to a matching active subscription", async () => {
    const bus = new EventBus({ transport: okTransport() });
    bus.subscribe(sub());
    const attempts = await bus.publish({ type: "agent.deployed", tenantId: "t1", subject: "a1" });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("delivered");
  });

  it("does not deliver to an inactive subscription", async () => {
    const bus = new EventBus({ transport: okTransport() });
    bus.subscribe(sub({ active: false }));
    const attempts = await bus.publish({ type: "agent.deployed", tenantId: "t1", subject: "a1" });
    expect(attempts).toHaveLength(0);
  });

  it("does not deliver across tenants", async () => {
    const bus = new EventBus({ transport: okTransport() });
    bus.subscribe(sub({ tenantId: "t2" }));
    const attempts = await bus.publish({ type: "agent.deployed", tenantId: "t1", subject: "a1" });
    expect(attempts).toHaveLength(0);
  });

  it("only delivers subscribed event types", async () => {
    const bus = new EventBus({ transport: okTransport() });
    bus.subscribe(sub({ events: ["agent.retired"] }));
    const attempts = await bus.publish({ type: "agent.deployed", tenantId: "t1", subject: "a1" });
    expect(attempts).toHaveLength(0);
  });

  it("signs the delivered payload with the subscription secret", async () => {
    let captured = "";
    const transport: WebhookTransport = {
      post: async (_url, body, sig) => {
        captured = sig;
        expect(verifySignature("shh", body, sig)).toBe(true);
        return true;
      },
    };
    const bus = new EventBus({ transport });
    bus.subscribe(sub());
    await bus.publish({ type: "agent.deployed", tenantId: "t1", subject: "a1" });
    expect(captured.startsWith("sha256=")).toBe(true);
  });

  it("includes the payload in the event", async () => {
    const bus = new EventBus({ transport: okTransport() });
    await bus.publish({ type: "agent.deployed", tenantId: "t1", subject: "a1", payload: { v: "1.0.0" } });
    expect(bus.eventLog()[0].payload).toEqual({ v: "1.0.0" });
  });
});

describe("retry", () => {
  it("retries then succeeds", async () => {
    let calls = 0;
    const transport: WebhookTransport = {
      post: async () => {
        calls++;
        return calls >= 2;
      },
    };
    const bus = new EventBus({ transport, sleep: noSleep });
    bus.subscribe(sub());
    const attempts = await bus.publish({ type: "agent.deployed", tenantId: "t1", subject: "a1" });
    expect(attempts[0].status).toBe("delivered");
    expect(attempts[0].attempts).toBe(2);
  });

  it("marks failed after exhausting retries", async () => {
    const transport: WebhookTransport = { post: async () => false };
    const bus = new EventBus({ transport, retry: { maxAttempts: 2, baseDelayMs: 0 }, sleep: noSleep });
    bus.subscribe(sub());
    const attempts = await bus.publish({ type: "agent.deployed", tenantId: "t1", subject: "a1" });
    expect(attempts[0].status).toBe("failed");
    expect(attempts[0].attempts).toBe(2);
  });

  it("uses the real default sleeper between retries", async () => {
    let calls = 0;
    const transport: WebhookTransport = {
      post: async () => {
        calls++;
        return calls >= 2;
      },
    };
    const bus = new EventBus({ transport, retry: { maxAttempts: 2, baseDelayMs: 1 } });
    bus.subscribe(sub());
    const attempts = await bus.publish({ type: "agent.deployed", tenantId: "t1", subject: "a1" });
    expect(attempts[0].status).toBe("delivered");
  });

  it("exposes the default retry config", () => {
    expect(DEFAULT_WEBHOOK_RETRY.maxAttempts).toBe(3);
  });
});

describe("multiple subscriptions", () => {
  it("delivers to all matching, in deterministic id order", async () => {
    const urls: string[] = [];
    const transport: WebhookTransport = {
      post: async (url) => {
        urls.push(url);
        return true;
      },
    };
    const bus = new EventBus({ transport });
    bus.subscribe(sub({ id: "sub-b", url: "https://b.test" }));
    bus.subscribe(sub({ id: "sub-a", url: "https://a.test" }));
    await bus.publish({ type: "agent.deployed", tenantId: "t1", subject: "a1" });
    expect(urls).toEqual(["https://a.test", "https://b.test"]);
  });
});
