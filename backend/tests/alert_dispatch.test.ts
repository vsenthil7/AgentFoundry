import { describe, it, expect, beforeEach } from "vitest";
import { AlertDispatcher, DEFAULT_ALERT_ROUTING } from "../src/alert_dispatch.js";
import { InMemoryChannel } from "../src/notifications.js";
import type { UsageAlert } from "../src/usage_alerts.js";

function alert(over: Partial<UsageAlert> = {}): UsageAlert {
  return {
    tenantId: "t1",
    resource: "api_calls",
    severity: "critical",
    kind: "usage_spike",
    message: "spike",
    value: 5,
    ...over,
  };
}

let channel: InMemoryChannel;
let dispatcher: AlertDispatcher;
beforeEach(() => {
  channel = new InMemoryChannel();
  dispatcher = new AlertDispatcher(channel);
});

describe("dispatch", () => {
  it("sends an alert to the severity-mapped recipient", () => {
    const r = dispatcher.dispatch([alert({ severity: "critical" })]);
    expect(r.dispatched).toBe(1);
    expect(channel.for("on-call")).toHaveLength(1);
  });

  it("routes warnings to ops", () => {
    dispatcher.dispatch([alert({ severity: "warning", kind: "quota_threshold" })]);
    expect(channel.for("ops")).toHaveLength(1);
  });

  it("suppresses a duplicate alert within the window", () => {
    dispatcher.dispatch([alert()]);
    const r = dispatcher.dispatch([alert()]);
    expect(r.dispatched).toBe(0);
    expect(r.suppressed).toBe(1);
    expect(channel.sent).toHaveLength(1);
  });

  it("treats different severities as distinct alerts", () => {
    const r = dispatcher.dispatch([
      alert({ severity: "warning", kind: "quota_threshold" }),
      alert({ severity: "critical", kind: "quota_threshold" }),
    ]);
    expect(r.dispatched).toBe(2);
  });

  it("orders critical before warning in dispatch", () => {
    dispatcher.dispatch([
      alert({ severity: "warning", kind: "quota_threshold", resource: "agents" }),
      alert({ severity: "critical", kind: "usage_spike", resource: "api_calls" }),
    ]);
    expect(channel.sent[0].subject).toContain("CRITICAL");
  });

  it("orders by resource within the same severity", () => {
    dispatcher.dispatch([
      alert({ severity: "warning", kind: "quota_threshold", resource: "deployments" }),
      alert({ severity: "warning", kind: "quota_threshold", resource: "agents" }),
    ]);
    expect(channel.sent[0].subject).toContain("agents");
  });

  it("resets the dedup window", () => {
    dispatcher.dispatch([alert()]);
    dispatcher.resetWindow();
    const r = dispatcher.dispatch([alert()]);
    expect(r.dispatched).toBe(1);
  });

  it("uses custom routing", () => {
    const d = new AlertDispatcher(channel, {
      recipients: { info: "i", warning: "w", critical: "c" },
    });
    d.dispatch([alert({ severity: "critical" })]);
    expect(channel.for("c")).toHaveLength(1);
  });

  it("exposes default routing", () => {
    expect(DEFAULT_ALERT_ROUTING.recipients.critical).toBe("on-call");
  });

  it("includes the message as the body", () => {
    dispatcher.dispatch([alert({ message: "usage 96% of quota" })]);
    expect(channel.sent[0].body).toBe("usage 96% of quota");
  });
});
