import { describe, it, expect } from "vitest";
import { applyProfileAudited } from "../src/audited_apply.js";
import { QuotaManager } from "../src/ratelimit.js";
import { DataGovernance } from "../src/data_governance.js";
import { SlaTracker } from "../src/sla.js";
import { TenantProfileStore } from "../src/tenant_profile.js";
import { EventBus, type WebhookTransport } from "../src/events.js";
import { AuditLedger } from "../src/persistence.js";
import { ProfileApplyError } from "../src/profile_apply.js";

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
  return {
    subsystems: {
      quotas: new QuotaManager(() => 0),
      governance: new DataGovernance(() => 0),
      sla: new SlaTracker(),
    },
    audit: { events: new EventBus({ transport: okTransport }), ledger: new AuditLedger() },
  };
}

describe("applyProfileAudited", () => {
  it("applies the profile and records the audit trail", async () => {
    const d = deps();
    const result = await applyProfileAudited(profile(), "admin@acme.test", d);
    expect(result.applied).toEqual(["quotas", "retention", "sla"]);
    expect(d.audit.events.eventLog()[0].type).toBe("profile.applied");
    expect(d.audit.ledger.size()).toBe(1);
    expect(d.audit.ledger.list()[0].detail).toContain("quotas, retention, sla");
  });

  it("records nothing if apply fails (partial apply)", async () => {
    const d = deps();
    d.subsystems.sla.setTarget = () => { throw new Error("sla down"); };
    await expect(applyProfileAudited(profile(), "admin@acme.test", d)).rejects.toThrow(ProfileApplyError);
    expect(d.audit.ledger.size()).toBe(0);
    expect(d.audit.events.eventLog()).toHaveLength(0);
  });

  it("keeps the audit ledger verifiable", async () => {
    const d = deps();
    await applyProfileAudited(profile(), "a", d);
    expect(d.audit.ledger.verify().valid).toBe(true);
  });
});
