import { describe, it, expect } from "vitest";
import { auditProfileAction } from "../src/audited_profile.js";
import { EventBus, type WebhookTransport } from "../src/events.js";
import { AuditLedger } from "../src/persistence.js";
import { TenantProfileStore } from "../src/tenant_profile.js";

const okTransport: WebhookTransport = { post: async () => true };

function profile() {
  const store = new TenantProfileStore();
  return store.set("t1", {
    policyId: "high-risk",
    quotaLimits: { limits: { agents: 10 } },
    retention: { retentionDays: { runtime_trace: 30 }, allowedRegions: ["eu"] },
    slaTarget: 0.999,
  });
}

function deps() {
  return { events: new EventBus({ transport: okTransport }), ledger: new AuditLedger() };
}

describe("auditProfileAction", () => {
  it("emits an event and a ledger entry for an update", async () => {
    const d = deps();
    await auditProfileAction(d, "updated", "admin@acme.test", profile());
    expect(d.events.eventLog()).toHaveLength(1);
    expect(d.events.eventLog()[0].type).toBe("profile.updated");
    expect(d.ledger.size()).toBe(1);
    expect(d.ledger.list()[0].action).toBe("profile.updated");
  });

  it("records apply actions", async () => {
    const d = deps();
    await auditProfileAction(d, "applied", "admin@acme.test", profile(), "all subsystems");
    expect(d.events.eventLog()[0].type).toBe("profile.applied");
    expect(d.ledger.list()[0].detail).toBe("all subsystems");
  });

  it("records rollback actions", async () => {
    const d = deps();
    await auditProfileAction(d, "rolledback", "admin@acme.test", profile());
    expect(d.events.eventLog()[0].type).toBe("profile.rolledback");
  });

  it("ledger entry subjects carry the tenant and version", async () => {
    const d = deps();
    await auditProfileAction(d, "updated", "admin@acme.test", profile());
    expect(d.ledger.list()[0].subject).toBe("t1:v1");
  });

  it("the audit ledger stays verifiable across actions", async () => {
    const d = deps();
    await auditProfileAction(d, "updated", "a", profile());
    await auditProfileAction(d, "applied", "a", profile());
    await auditProfileAction(d, "rolledback", "a", profile());
    expect(d.ledger.size()).toBe(3);
    expect(d.ledger.verify().valid).toBe(true);
  });

  it("the event payload carries version and policy", async () => {
    const d = deps();
    await auditProfileAction(d, "applied", "a", profile());
    expect(d.events.eventLog()[0].payload).toMatchObject({ version: 1, policyId: "high-risk" });
  });
});
