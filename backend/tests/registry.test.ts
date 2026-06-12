import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentRegistry,
  IllegalTransitionError,
  NotFoundError,
  DuplicateAgentError,
  canTransition,
} from "../src/registry.js";
import { acmeSupportBot } from "../src/seed.js";
import type { AgentDesign } from "../src/types.js";

let reg: AgentRegistry;
beforeEach(() => {
  reg = new AgentRegistry();
});

describe("registration", () => {
  it("registers a new agent with initial lineage", () => {
    const r = reg.register(acmeSupportBot(), "owner@acme.test");
    expect(r.id).toBe("acme-support-bot");
    expect(r.state).toBe("draft");
    expect(r.versions).toEqual(["1.0.0"]);
    expect(r.lineage).toHaveLength(1);
    expect(r.lineage[0].note).toBe("registered");
  });

  it("rejects duplicate registration", () => {
    reg.register(acmeSupportBot(), "owner@acme.test");
    expect(() => reg.register(acmeSupportBot(), "owner@acme.test")).toThrow(
      DuplicateAgentError,
    );
  });

  it("freezes the record (immutable)", () => {
    const r = reg.register(acmeSupportBot(), "owner@acme.test");
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.lineage)).toBe(true);
  });
});

describe("lookup", () => {
  it("gets a registered agent", () => {
    reg.register(acmeSupportBot(), "o");
    expect(reg.get("acme-support-bot").name).toBe("Acme Support Bot");
  });
  it("has() reflects presence", () => {
    expect(reg.has("acme-support-bot")).toBe(false);
    reg.register(acmeSupportBot(), "o");
    expect(reg.has("acme-support-bot")).toBe(true);
  });
  it("throws NotFoundError for unknown id", () => {
    expect(() => reg.get("ghost")).toThrow(NotFoundError);
  });
});

describe("lifecycle transitions", () => {
  it("allows legal draft -> in_review -> approved", () => {
    reg.register(acmeSupportBot(), "o");
    reg.transition("acme-support-bot", "in_review", "reviewer");
    const r = reg.transition("acme-support-bot", "approved", "approver");
    expect(r.state).toBe("approved");
    expect(r.lineage).toHaveLength(3);
  });

  it("rejects an illegal transition (draft -> deployed)", () => {
    reg.register(acmeSupportBot(), "o");
    expect(() =>
      reg.transition("acme-support-bot", "deployed", "o"),
    ).toThrow(IllegalTransitionError);
  });

  it("rejects any transition out of retired (terminal)", () => {
    reg.register(acmeSupportBot(), "o");
    reg.retire("acme-support-bot", "o");
    expect(() =>
      reg.transition("acme-support-bot", "draft", "o"),
    ).toThrow(IllegalTransitionError);
  });

  it("canTransition reports legality", () => {
    expect(canTransition("draft", "in_review")).toBe(true);
    expect(canTransition("draft", "deployed")).toBe(false);
    expect(canTransition("retired", "draft")).toBe(false);
  });

  it("records an approval record on transition", () => {
    reg.register(acmeSupportBot(), "o");
    reg.transition("acme-support-bot", "in_review", "r");
    const approval = Object.freeze({
      designId: "acme-support-bot",
      designVersion: "1.0.0",
      reviewer: "approver@acme.test",
      decision: "approved" as const,
      weightedScore: 0.92,
      timestamp: new Date(0).toISOString(),
    });
    const r = reg.transition("acme-support-bot", "approved", "approver", {
      approval,
    });
    expect(r.approval?.reviewer).toBe("approver@acme.test");
  });
});

describe("versioning", () => {
  it("publishes a new version and resets to draft", () => {
    reg.register(acmeSupportBot(), "o");
    reg.transition("acme-support-bot", "in_review", "r");
    const v2: AgentDesign = {
      ...acmeSupportBot(),
      sdlc: { ...acmeSupportBot().sdlc, version: "2.0.0" },
    };
    const r = reg.publishVersion("acme-support-bot", v2, "dev");
    expect(r.currentVersion).toBe("2.0.0");
    expect(r.state).toBe("draft");
    expect(r.versions).toEqual(["1.0.0", "2.0.0"]);
  });

  it("rejects a version with mismatched id", () => {
    reg.register(acmeSupportBot(), "o");
    const bad = { ...acmeSupportBot(), id: "other" };
    expect(() => reg.publishVersion("acme-support-bot", bad, "d")).toThrow(
      /mismatch/,
    );
  });

  it("rejects a duplicate version", () => {
    reg.register(acmeSupportBot(), "o");
    expect(() =>
      reg.publishVersion("acme-support-bot", acmeSupportBot(), "d"),
    ).toThrow(/already exists/);
  });
});

describe("listing and governance", () => {
  beforeEach(() => {
    reg.register(acmeSupportBot(), "o");
    const second: AgentDesign = {
      ...acmeSupportBot(),
      id: "billing-bot",
      name: "Billing Bot",
      sdlc: {
        ...acmeSupportBot().sdlc,
        owner: "billing@acme.test",
        riskTier: "medium",
        costCenter: "CC-BILLING-002",
      },
    };
    reg.register(second, "o");
  });

  it("lists all agents deterministically by id", () => {
    const ids = reg.list().map((r) => r.id);
    expect(ids).toEqual(["acme-support-bot", "billing-bot"]);
  });

  it("filters by state", () => {
    expect(reg.list({ state: "draft" })).toHaveLength(2);
    expect(reg.list({ state: "deployed" })).toHaveLength(0);
  });

  it("filters by owner", () => {
    expect(reg.list({ owner: "billing@acme.test" })).toHaveLength(1);
  });

  it("filters by risk tier", () => {
    expect(reg.list({ riskTier: "high" })).toHaveLength(1);
    expect(reg.list({ riskTier: "medium" })).toHaveLength(1);
  });

  it("rolls up agents by cost center", () => {
    const rollup = reg.costRollup();
    expect(rollup["CC-SUPPORT-001"]).toBe(1);
    expect(rollup["CC-BILLING-002"]).toBe(1);
  });
});

describe("retirement", () => {
  it("retires an agent with a note", () => {
    reg.register(acmeSupportBot(), "o");
    const r = reg.retire("acme-support-bot", "admin", "decommissioned post-incident");
    expect(r.state).toBe("retired");
    expect(r.lineage[r.lineage.length - 1].note).toContain("decommissioned");
  });

  it("retires with default note", () => {
    reg.register(acmeSupportBot(), "o");
    const r = reg.retire("acme-support-bot", "admin");
    expect(r.lineage[r.lineage.length - 1].note).toBe("retired");
  });
});
