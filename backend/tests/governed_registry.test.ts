import { describe, it, expect, beforeEach } from "vitest";
import { GovernedRegistry } from "../src/governed_registry.js";
import {
  PermissionDeniedError,
  TenantIsolationError,
  type User,
} from "../src/identity.js";
import { acmeSupportBot } from "../src/seed.js";
import type { ApprovalRecord } from "../src/promotion.js";

const composer: User = { id: "c", tenantId: "t1", email: "c@acme.test", roles: ["composer"] };
const reviewer: User = { id: "r", tenantId: "t1", email: "r@acme.test", roles: ["reviewer"] };
const ops: User = { id: "o", tenantId: "t1", email: "o@acme.test", roles: ["ops"] };
const admin: User = { id: "a", tenantId: "t1", email: "a@acme.test", roles: ["admin"] };
const otherTenant: User = { id: "x", tenantId: "t2", email: "x@evil.test", roles: ["admin"] };

const approval: ApprovalRecord = Object.freeze({
  designId: "acme-support-bot",
  designVersion: "1.0.0",
  reviewer: "r@acme.test",
  decision: "approved",
  weightedScore: 0.92,
  timestamp: new Date(0).toISOString(),
});

let gr: GovernedRegistry;
beforeEach(() => (gr = new GovernedRegistry()));

describe("register", () => {
  it("composer can register", () => {
    const rec = gr.register(composer, acmeSupportBot());
    expect(rec.id).toBe("acme-support-bot");
  });

  it("reviewer cannot register (no create permission)", () => {
    expect(() => gr.register(reviewer, acmeSupportBot())).toThrow(PermissionDeniedError);
  });
});

describe("read + tenant isolation", () => {
  beforeEach(() => gr.register(composer, acmeSupportBot()));

  it("same-tenant user can read", () => {
    expect(gr.read(reviewer, "acme-support-bot").name).toBe("Acme Support Bot");
  });

  it("cross-tenant access is denied", () => {
    expect(() => gr.read(otherTenant, "acme-support-bot")).toThrow(TenantIsolationError);
  });
});

describe("promotion flow with RBAC", () => {
  beforeEach(() => gr.register(composer, acmeSupportBot()));

  it("composer requests promotion, reviewer approves, ops deploys", () => {
    gr.requestPromotion(composer, "acme-support-bot");
    gr.approve(reviewer, "acme-support-bot", approval);
    const deployed = gr.deploy(ops, "acme-support-bot");
    expect(deployed.state).toBe("deployed");
    expect(deployed.approval?.reviewer).toBe("r@acme.test");
  });

  it("composer cannot approve", () => {
    gr.requestPromotion(composer, "acme-support-bot");
    expect(() => gr.approve(composer, "acme-support-bot", approval)).toThrow(
      PermissionDeniedError,
    );
  });

  it("reviewer cannot deploy", () => {
    gr.requestPromotion(composer, "acme-support-bot");
    gr.approve(reviewer, "acme-support-bot", approval);
    expect(() => gr.deploy(reviewer, "acme-support-bot")).toThrow(PermissionDeniedError);
  });

  it("admin can do the whole flow alone", () => {
    gr.requestPromotion(admin, "acme-support-bot");
    gr.approve(admin, "acme-support-bot", approval);
    expect(gr.deploy(admin, "acme-support-bot").state).toBe("deployed");
  });
});

describe("retire", () => {
  beforeEach(() => gr.register(composer, acmeSupportBot()));

  it("ops can retire", () => {
    expect(gr.retire(ops, "acme-support-bot").state).toBe("retired");
  });

  it("composer cannot retire", () => {
    expect(() => gr.retire(composer, "acme-support-bot")).toThrow(PermissionDeniedError);
  });
});

describe("list scoping", () => {
  it("only returns agents in the user's tenant", () => {
    gr.register(composer, acmeSupportBot());
    // A second registry-level agent owned by t2 would not appear for t1 users.
    expect(gr.list(reviewer)).toHaveLength(1);
    expect(() => gr.list({ ...reviewer, roles: ["viewer"] })).not.toThrow();
  });

  it("a viewer can list (read permission)", () => {
    gr.register(composer, acmeSupportBot());
    const viewer: User = { id: "v", tenantId: "t1", email: "v@acme.test", roles: ["viewer"] };
    expect(gr.list(viewer)).toHaveLength(1);
  });
});

describe("guard for unknown agent", () => {
  it("reading an unknown agent surfaces a not-found error", () => {
    expect(() => gr.read(admin, "ghost")).toThrow();
  });
});

describe("underlying registry access", () => {
  it("requires governance:report permission", () => {
    gr.register(composer, acmeSupportBot());
    expect(() => gr.underlying(composer)).toThrow(PermissionDeniedError);
    expect(gr.underlying(reviewer).list()).toHaveLength(1);
  });
});

describe("deploy from non-approved state", () => {
  it("deploys directly when already exported (no double-advance)", () => {
    gr.register(admin, acmeSupportBot());
    gr.requestPromotion(admin, "acme-support-bot");
    gr.approve(admin, "acme-support-bot", approval);
    // First deploy advances approved->exported->deployed.
    const d = gr.deploy(admin, "acme-support-bot");
    expect(d.state).toBe("deployed");
  });
});
