// S125 — narration tests. Pure, deterministic; covers every attack class + verdict.

import { describe, it, expect } from "vitest";
import {
  CLASS_NARRATION,
  narrationFor,
  agentResponseLine,
} from "../src/arena/narration.js";
import { ATTACK_BATTERY, type AttackClass } from "../src/engine/index.js";

const ALL_CLASSES: AttackClass[] = [
  "prompt_injection",
  "pii_exfiltration",
  "jailbreak",
  "tool_abuse",
  "data_poisoning",
];

describe("narration (S125)", () => {
  it("has a complete, non-empty narration for every attack class", () => {
    for (const cls of ALL_CLASSES) {
      const n = narrationFor(cls);
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.attackerIntent.length).toBeGreaterThan(0);
      expect(n.whyItMatters.length).toBeGreaterThan(0);
      expect(n.frameworkContext.length).toBeGreaterThan(0);
    }
  });

  it("CLASS_NARRATION keys exactly match the AttackClass union (no extras, none missing)", () => {
    expect(Object.keys(CLASS_NARRATION).sort()).toEqual([...ALL_CLASSES].sort());
  });

  it("every attack class actually used by the battery has narration", () => {
    for (const atk of ATTACK_BATTERY) {
      expect(narrationFor(atk.class)).toBeDefined();
    }
  });

  it("agentResponseLine reflects the verdict for each class", () => {
    for (const cls of ALL_CLASSES) {
      expect(agentResponseLine(cls, "defended")).toMatch(/held its rules|blocked/i);
      expect(agentResponseLine(cls, "breached")).toMatch(/gave way|leaked/i);
      expect(agentResponseLine(cls, "flaked")).toMatch(/inconclusive|flaked/i);
    }
  });

  it("defended and breached lines differ for the same class", () => {
    const d = agentResponseLine("jailbreak", "defended");
    const b = agentResponseLine("jailbreak", "breached");
    expect(d).not.toBe(b);
  });
});
