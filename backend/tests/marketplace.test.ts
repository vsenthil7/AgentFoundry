import { describe, it, expect, beforeEach } from "vitest";
import {
  Marketplace,
  PackValidationError,
  PackNotFoundError,
  DuplicatePackError,
  type AgentTemplatePack,
  type EvalPack,
  type RedTeamPack,
} from "../src/marketplace.js";
import { exportManifest } from "../src/export.js";
import { DeterministicCaseGenerator } from "../src/eval.js";
import { ATTACK_BATTERY } from "../src/redteam.js";
import { acmeSupportBot } from "../src/seed.js";

const TS = new Date(0).toISOString();

function agentPack(over: Partial<AgentTemplatePack> = {}): AgentTemplatePack {
  const design = acmeSupportBot();
  const cases = new DeterministicCaseGenerator().generate(design);
  return {
    id: "pack-acme-template",
    kind: "agent_template",
    name: "Acme Support Template",
    publisher: "acme",
    version: "1.0.0",
    certificationTier: "gold",
    publishedAt: TS,
    manifest: exportManifest(design, cases),
    ...over,
  };
}

function evalPack(over: Partial<EvalPack> = {}): EvalPack {
  return {
    id: "pack-support-evals",
    kind: "eval_pack",
    name: "Support Eval Pack",
    publisher: "acme",
    version: "1.0.0",
    certificationTier: "silver",
    publishedAt: TS,
    cases: new DeterministicCaseGenerator().generate(acmeSupportBot()),
    ...over,
  };
}

function redteamPack(over: Partial<RedTeamPack> = {}): RedTeamPack {
  return {
    id: "pack-owasp-battery",
    kind: "redteam_pack",
    name: "OWASP Battery",
    publisher: "security-team",
    version: "1.0.0",
    certificationTier: "bronze",
    publishedAt: TS,
    attacks: ATTACK_BATTERY,
    ...over,
  };
}

let mp: Marketplace;
beforeEach(() => (mp = new Marketplace()));

describe("publish", () => {
  it("publishes each pack kind", () => {
    mp.publish(agentPack());
    mp.publish(evalPack());
    mp.publish(redteamPack());
    expect(mp.size()).toBe(3);
  });

  it("rejects a duplicate id", () => {
    mp.publish(agentPack());
    expect(() => mp.publish(agentPack())).toThrow(DuplicatePackError);
  });

  it("rejects a pack missing required metadata", () => {
    expect(() => mp.publish(agentPack({ publisher: "" }))).toThrow(PackValidationError);
  });

  it("rejects an agent template with no manifest", () => {
    // @ts-expect-error testing runtime validation
    expect(() => mp.publish(agentPack({ manifest: undefined }))).toThrow(
      PackValidationError,
    );
  });

  it("rejects an empty eval pack", () => {
    expect(() => mp.publish(evalPack({ cases: [] }))).toThrow(PackValidationError);
  });

  it("rejects an empty red-team pack", () => {
    expect(() => mp.publish(redteamPack({ attacks: [] }))).toThrow(
      PackValidationError,
    );
  });
});

describe("browse", () => {
  beforeEach(() => {
    mp.publish(agentPack());
    mp.publish(evalPack());
    mp.publish(redteamPack());
  });

  it("lists all packs deterministically by id", () => {
    const ids = mp.browse().map((p) => p.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("filters by kind", () => {
    expect(mp.browse({ kind: "eval_pack" })).toHaveLength(1);
    expect(mp.browse({ kind: "agent_template" })).toHaveLength(1);
  });

  it("filters by publisher", () => {
    expect(mp.browse({ publisher: "acme" })).toHaveLength(2);
    expect(mp.browse({ publisher: "security-team" })).toHaveLength(1);
  });

  it("filters by minimum certification tier", () => {
    // gold + silver pass minTier silver; bronze is excluded.
    expect(mp.browse({ minTier: "silver" })).toHaveLength(2);
    expect(mp.browse({ minTier: "gold" })).toHaveLength(1);
    expect(mp.browse({ minTier: "none" })).toHaveLength(3);
  });
});

describe("consume — interoperability", () => {
  it("returns the full agent-template payload so it runs end-to-end", () => {
    mp.publish(agentPack());
    const consumed = mp.consume("pack-acme-template");
    expect(consumed.kind).toBe("agent_template");
    if (consumed.kind === "agent_template") {
      expect(consumed.manifest.agent.id).toBe("acme-support-bot");
      expect(consumed.manifest.evalSuite.length).toBeGreaterThan(0);
      expect(consumed.manifest.redTeamSuite.length).toBeGreaterThan(0);
    }
  });

  it("returns the eval-pack cases for direct reuse", () => {
    mp.publish(evalPack());
    const consumed = mp.consume("pack-support-evals");
    if (consumed.kind === "eval_pack") {
      expect(consumed.cases.length).toBeGreaterThan(0);
    }
  });

  it("throws when consuming an unknown pack", () => {
    expect(() => mp.consume("ghost")).toThrow(PackNotFoundError);
  });

  it("increments install count on each consume", () => {
    mp.publish(redteamPack());
    expect(mp.installCount("pack-owasp-battery")).toBe(0);
    mp.consume("pack-owasp-battery");
    mp.consume("pack-owasp-battery");
    expect(mp.installCount("pack-owasp-battery")).toBe(2);
  });

  it("throws install count for unknown pack", () => {
    expect(() => mp.installCount("ghost")).toThrow(PackNotFoundError);
  });
});

describe("trending — network effects", () => {
  beforeEach(() => {
    mp.publish(agentPack());
    mp.publish(evalPack());
    mp.publish(redteamPack());
  });

  it("orders by install count, ties broken by id", () => {
    mp.consume("pack-support-evals");
    mp.consume("pack-support-evals");
    mp.consume("pack-owasp-battery");
    const trending = mp.trending();
    expect(trending[0].id).toBe("pack-support-evals");
    expect(trending[1].id).toBe("pack-owasp-battery");
  });

  it("respects the limit", () => {
    expect(mp.trending(1)).toHaveLength(1);
  });

  it("ties (all zero installs) fall back to id order", () => {
    const trending = mp.trending();
    expect(trending.map((p) => p.id)).toEqual(
      [...trending.map((p) => p.id)].sort(),
    );
  });
});

describe("has / size", () => {
  it("reports presence and size", () => {
    expect(mp.has("pack-acme-template")).toBe(false);
    mp.publish(agentPack());
    expect(mp.has("pack-acme-template")).toBe(true);
    expect(mp.size()).toBe(1);
  });
});
