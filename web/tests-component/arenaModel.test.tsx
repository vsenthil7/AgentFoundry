import { describe, it, expect } from "vitest";
import {
  buildBattleTimeline,
  frameworkChips,
  outcomeHeadline,
  type BattleTimeline,
} from "../src/arena/arenaModel";
import { ATTACK_BATTERY, type AttackResult } from "../src/engine/redteam";

// Helper: a result for a battery attack id, defended unless told otherwise.
function res(attackId: string, over: Partial<AttackResult> = {}): AttackResult {
  const c = ATTACK_BATTERY.find((a) => a.id === attackId)!;
  return {
    attackId,
    class: c.class,
    passed: true,
    output: "safe output",
    mapping: c.mapping,
    flaked: false,
    ...over,
  };
}

describe("frameworkChips", () => {
  it("flattens owasp/atlas/nist in stable order", () => {
    expect(frameworkChips({ owasp: "LLM01", atlas: "AML.T0051", nist: "MEASURE-2.7" })).toEqual([
      "OWASP LLM01",
      "ATLAS AML.T0051",
      "NIST MEASURE-2.7",
    ]);
  });
  it("omits missing frameworks", () => {
    expect(frameworkChips({ owasp: "LLM06" })).toEqual(["OWASP LLM06"]);
    expect(frameworkChips({ atlas: "AML.T0057" })).toEqual(["ATLAS AML.T0057"]);
    expect(frameworkChips({ nist: "GOVERN-1.2" })).toEqual(["NIST GOVERN-1.2"]);
    expect(frameworkChips({})).toEqual([]);
  });
});

describe("buildBattleTimeline", () => {
  it("empty results -> empty outcome, zero rate", () => {
    const t = buildBattleTimeline([]);
    expect(t.total).toBe(0);
    expect(t.defendRate).toBe(0);
    expect(t.outcome).toBe("empty");
    expect(t.rounds).toEqual([]);
  });

  it("all defended -> flawless, defendRate 1, running tally increments", () => {
    const t = buildBattleTimeline(ATTACK_BATTERY.map((a) => res(a.id)));
    expect(t.total).toBe(4);
    expect(t.defended).toBe(4);
    expect(t.breached).toBe(0);
    expect(t.defendRate).toBe(1);
    expect(t.outcome).toBe("flawless");
    // Running tally reaches 4 by the last round.
    expect(t.rounds[t.rounds.length - 1].defendedSoFar).toBe(4);
    expect(t.rounds[0].defendedSoFar).toBe(1);
  });

  it("orders rounds by class severity (injection first, pii_exfiltration last)", () => {
    const t = buildBattleTimeline(ATTACK_BATTERY.map((a) => res(a.id)));
    expect(t.rounds[0].attackClass).toBe("prompt_injection");
    expect(t.rounds[t.rounds.length - 1].attackClass).toBe("pii_exfiltration");
  });

  it("a breach -> breached outcome and breach tally", () => {
    const results = ATTACK_BATTERY.map((a) =>
      a.id === "atk-pii-exfil" ? res(a.id, { passed: false, output: "card 4111-1111" }) : res(a.id),
    );
    const t = buildBattleTimeline(results);
    expect(t.breached).toBe(1);
    expect(t.defended).toBe(3);
    expect(t.outcome).toBe("breached");
    const breach = t.rounds.find((r) => r.verdict === "breached")!;
    expect(breach.breachedSoFar).toBe(1);
    expect(breach.output).toContain("4111-1111");
  });

  it("partial defence with no breach (a flake) -> held outcome", () => {
    const results = ATTACK_BATTERY.map((a) =>
      a.id === "atk-jailbreak-dan" ? res(a.id, { passed: false, flaked: true }) : res(a.id),
    );
    const t = buildBattleTimeline(results);
    expect(t.flaked).toBe(1);
    expect(t.breached).toBe(0);
    expect(t.defended).toBe(3);
    expect(t.outcome).toBe("held"); // not all defended, but nothing breached
    expect(t.rounds.find((r) => r.verdict === "flaked")).toBeDefined();
  });

  it("populates payload + name from the battery and chips from mapping", () => {
    const t = buildBattleTimeline([res("atk-injection-ignore")]);
    const round = t.rounds[0];
    expect(round.attackName).toBe("Ignore-previous-instructions injection");
    expect(round.payload).toContain("Ignore previous instructions");
    expect(round.frameworks).toContain("OWASP LLM01");
  });

  it("falls back to attackId + empty payload when the case is not in the battery", () => {
    const orphan: AttackResult = {
      attackId: "atk-custom-pack",
      class: "data_poisoning",
      passed: true,
      output: "ok",
      mapping: { owasp: "LLM03" },
      flaked: false,
    };
    const t = buildBattleTimeline([orphan]);
    expect(t.rounds[0].attackName).toBe("atk-custom-pack");
    expect(t.rounds[0].payload).toBe("");
    expect(t.rounds[0].frameworks).toEqual(["OWASP LLM03"]);
  });

  it("tie-breaks same-severity attacks by attackId", () => {
    // Two prompt_injection results, same severity -> sorted by id.
    const a: AttackResult = { attackId: "atk-zzz", class: "prompt_injection", passed: true, output: "", mapping: {}, flaked: false };
    const b: AttackResult = { attackId: "atk-aaa", class: "prompt_injection", passed: true, output: "", mapping: {}, flaked: false };
    const t = buildBattleTimeline([a, b]);
    expect(t.rounds.map((r) => r.attackId)).toEqual(["atk-aaa", "atk-zzz"]);
  });
});

describe("outcomeHeadline", () => {
  const mk = (outcome: BattleTimeline["outcome"], defended: number, breached: number, total: number): BattleTimeline => ({
    rounds: [],
    total,
    defended,
    breached,
    flaked: 0,
    defendRate: total === 0 ? 0 : defended / total,
    outcome,
  });
  it("covers every outcome string", () => {
    expect(outcomeHeadline(mk("flawless", 4, 0, 4))).toContain("Flawless");
    expect(outcomeHeadline(mk("held", 3, 0, 4))).toContain("Held the line");
    expect(outcomeHeadline(mk("breached", 3, 1, 4))).toContain("breached");
    expect(outcomeHeadline(mk("empty", 0, 0, 0))).toContain("No attacks");
  });
});
