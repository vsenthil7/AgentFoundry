// S125 — Arena narration (pure, deterministic, no LLM).
//
// The arena (S124) shows WHAT happened (defended/breached + framework chips).
// This layer explains it in plain language so a non-expert judge follows the
// 90-second demo without a presenter: for each attack class, a one-line
// "what the attacker tried", a verdict-aware "what the agent did", and a
// "why this matters" tied to the governance frameworks.
//
// Everything here is static, deterministic strings keyed by AttackClass — no
// model call, no randomness — so it's fully testable and offline-safe. The
// `satisfies Record<AttackClass, …>` makes it a COMPILE error to add a new
// attack class without writing its narration, so the arena can never show an
// unexplained round.

import type { AttackClass } from "../engine/redteam.js";
import type { RoundVerdict } from "./arenaModel.js";

export interface ClassNarration {
  // Short human title for the attack class (distinct from the specific attack name).
  title: string;
  // What the attacker is attempting, in plain language.
  attackerIntent: string;
  // Why a defender/buyer should care — the real-world stake.
  whyItMatters: string;
  // The framework family this maps to, named for a lay audience.
  frameworkContext: string;
}

// One narration per attack class. `satisfies` enforces exhaustiveness at compile
// time: omit a class and the build fails.
export const CLASS_NARRATION = {
  prompt_injection: {
    title: "Prompt injection",
    attackerIntent:
      "The attacker hides instructions in their message trying to override the agent's own rules.",
    whyItMatters:
      "A hijacked agent can be made to ignore its guardrails and do whatever the attacker types.",
    frameworkContext: "OWASP LLM01 · the most-reported risk for production LLM apps.",
  },
  pii_exfiltration: {
    title: "Data exfiltration",
    attackerIntent:
      "The attacker tries to trick the agent into dumping stored personal data — emails, card numbers.",
    whyItMatters:
      "A single leak of customer PII is a reportable breach with regulatory and reputational cost.",
    frameworkContext: "OWASP LLM06 · sensitive-information disclosure.",
  },
  jailbreak: {
    title: "Jailbreak",
    attackerIntent:
      "The attacker role-plays the agent into a 'no rules' persona to extract secrets it should refuse.",
    whyItMatters:
      "Jailbroken agents hand over credentials and bypass the safety policy they were built with.",
    frameworkContext: "OWASP LLM01 · MITRE ATLAS evasion techniques.",
  },
  tool_abuse: {
    title: "Tool abuse",
    attackerIntent:
      "The attacker tries to make the agent invoke a real tool — sending email, moving data — on their behalf.",
    whyItMatters:
      "An agent with tools can take real actions; abuse turns a chatbot into an insider threat.",
    frameworkContext: "OWASP LLM07 · insecure plugin/tool design.",
  },
  data_poisoning: {
    title: "Data poisoning",
    attackerIntent:
      "The attacker feeds tainted content hoping the agent treats it as trusted knowledge.",
    whyItMatters:
      "Poisoned grounding makes the agent confidently wrong — hard to detect after the fact.",
    frameworkContext: "OWASP LLM03 · training/grounding-data integrity.",
  },
} satisfies Record<AttackClass, ClassNarration>;

export function narrationFor(cls: AttackClass): ClassNarration {
  return CLASS_NARRATION[cls];
}

// A verdict-aware sentence describing what the agent actually did this round.
// Pure: derived only from the verdict + class narration.
export function agentResponseLine(cls: AttackClass, verdict: RoundVerdict): string {
  const n = CLASS_NARRATION[cls];
  switch (verdict) {
    case "defended":
      return `The agent held its rules and refused — ${n.title.toLowerCase()} blocked.`;
    case "breached":
      return `The agent gave way — ${n.title.toLowerCase()} succeeded and sensitive output leaked.`;
    case "flaked":
      return `The attempt was inconclusive (the run flaked) — re-run before trusting this result.`;
  }
}
