// S124 — Battle Mode Arena (pure model).
//
// The creative centrepiece. AgentFoundry's red-team engine (redteam.ts) already
// produces AttackResult[] — named attacks mapped to OWASP/ATLAS/NIST with a
// real defended/breached verdict from the deterministic engine. What was missing
// was an *experience*: a watchable arena rather than a results table.
//
// This module is PURE (no React, no timers, no randomness): it turns the real
// AttackResult[] into an ordered, paced battle timeline that a view can play
// round-by-round. It invents NOTHING about the outcome — every round's verdict
// comes straight from the engine's AttackResult.passed. The only thing added is
// presentation order + per-round metadata (attacker payload, framework chips,
// a running defend-tally). Determinism is preserved end to end.

import {
  ATTACK_BATTERY,
  type AttackCase,
  type AttackClass,
  type AttackResult,
  type FrameworkMapping,
} from "../engine/redteam.js";

// Severity ordering: the arena paces rounds most-dramatic-last so the demo
// builds tension and ends on the highest-stakes attack. This affects ONLY the
// display order of rounds, never any verdict.
const CLASS_SEVERITY: Record<AttackClass, number> = {
  // higher = more severe = later in the sequence
  prompt_injection: 1,
  tool_abuse: 2,
  jailbreak: 3,
  data_poisoning: 4,
  pii_exfiltration: 5,
};

export type RoundVerdict = "defended" | "breached" | "flaked";

export interface BattleRound {
  index: number; // 0-based position in the paced sequence
  attackId: string;
  attackName: string;
  attackClass: AttackClass;
  payload: string; // what the attacker sent (from the battery)
  output: string; // what the agent actually replied (from the engine)
  verdict: RoundVerdict;
  mapping: FrameworkMapping;
  frameworks: string[]; // flattened chips, e.g. ["OWASP LLM01", "ATLAS AML.T0051", "NIST MEASURE-2.7"]
  // Running tally AFTER this round resolves (1-based counts).
  defendedSoFar: number;
  breachedSoFar: number;
}

export interface BattleTimeline {
  rounds: BattleRound[];
  total: number;
  defended: number;
  breached: number;
  flaked: number;
  defendRate: number; // defended / total, 0..1 (0 when no rounds)
  // The headline verdict shown at the climax.
  outcome: "flawless" | "held" | "breached" | "empty";
}

// Flatten a FrameworkMapping into human-facing chips, stable order OWASP -> ATLAS -> NIST.
export function frameworkChips(m: FrameworkMapping): string[] {
  const chips: string[] = [];
  if (m.owasp) chips.push(`OWASP ${m.owasp}`);
  if (m.atlas) chips.push(`ATLAS ${m.atlas}`);
  if (m.nist) chips.push(`NIST ${m.nist}`);
  return chips;
}

function verdictOf(r: AttackResult): RoundVerdict {
  if (r.flaked) return "flaked";
  return r.passed ? "defended" : "breached";
}

// Resolve the attack case (name + payload) for a result. Falls back to the
// result's own id/class when a custom battery omits the case (defensive, but
// real: consumed marketplace packs may carry attacks not in ATTACK_BATTERY).
function caseFor(
  attackId: string,
  battery: readonly AttackCase[],
): AttackCase | undefined {
  return battery.find((a) => a.id === attackId);
}

// Build the paced battle timeline from REAL engine results.
// `battery` supplies attack names/payloads; defaults to ATTACK_BATTERY.
export function buildBattleTimeline(
  results: readonly AttackResult[],
  battery: readonly AttackCase[] = ATTACK_BATTERY,
): BattleTimeline {
  // Order by class severity, then by attackId for a stable tie-break.
  const ordered = [...results].sort((a, b) => {
    const sev = CLASS_SEVERITY[a.class] - CLASS_SEVERITY[b.class];
    return sev !== 0 ? sev : a.attackId.localeCompare(b.attackId);
  });

  let defendedSoFar = 0;
  let breachedSoFar = 0;
  const rounds: BattleRound[] = ordered.map((r, index) => {
    const verdict = verdictOf(r);
    if (verdict === "defended") defendedSoFar++;
    else if (verdict === "breached") breachedSoFar++;
    const c = caseFor(r.attackId, battery);
    return {
      index,
      attackId: r.attackId,
      attackName: c?.name ?? r.attackId,
      attackClass: r.class,
      payload: c?.payload ?? "",
      output: r.output,
      verdict,
      mapping: r.mapping,
      frameworks: frameworkChips(r.mapping),
      defendedSoFar,
      breachedSoFar,
    };
  });

  const total = rounds.length;
  const defended = rounds.filter((r) => r.verdict === "defended").length;
  const breached = rounds.filter((r) => r.verdict === "breached").length;
  const flaked = rounds.filter((r) => r.verdict === "flaked").length;
  const defendRate = total === 0 ? 0 : defended / total;

  let outcome: BattleTimeline["outcome"];
  if (total === 0) outcome = "empty";
  else if (breached > 0) outcome = "breached";
  else if (defended === total) outcome = "flawless";
  else outcome = "held";

  return { rounds, total, defended, breached, flaked, defendRate, outcome };
}

// A short, deterministic headline for the climax banner.
export function outcomeHeadline(t: BattleTimeline): string {
  switch (t.outcome) {
    case "flawless":
      return `Flawless defence - ${t.defended}/${t.total} attacks repelled`;
    case "held":
      return `Held the line - ${t.defended}/${t.total} attacks repelled`;
    case "breached":
      return `Defence breached - ${t.breached}/${t.total} attacks got through`;
    case "empty":
      return "No attacks in this battle";
  }
}
