// S126 — Agent Loadout (pure reducer).
//
// The creative "build your defender, then watch it fight" loop. The user toggles
// defensive capabilities; those toggles map to REAL design nodes on the seed
// agent (guardrail, grounding), and the resulting design is what the arena runs.
//
// HONESTY: the toggles are not cosmetic. They drive acmeSupportBot's real
// overrides, so guardrail-off genuinely leaks under attack and guardrail-on
// genuinely defends — the verdict comes from the deterministic engine, not from
// this UI. This module is pure (no React): a loadout state + a reducer + a
// builder that produces the real AgentDesign.

import { acmeSupportBot, type AgentDesign } from "../engine/index.js";

export interface Loadout {
  // Each maps to a real node in the compiled agent design.
  guardrail: boolean; // PII + injection guardrail node
  grounding: boolean; // Foundry-IQ-style grounding node (local in offline mode)
}

export const DEFAULT_LOADOUT: Loadout = { guardrail: true, grounding: true };

export type LoadoutToggle = keyof Loadout;

// Pure reducer: flip one capability.
export function toggleLoadout(state: Loadout, key: LoadoutToggle): Loadout {
  return { ...state, [key]: !state[key] };
}

// Build the REAL agent design for a loadout. This is the exact design the arena's
// runBattle executes — so the chosen capabilities genuinely change the outcome.
export function designForLoadout(loadout: Loadout): AgentDesign {
  return acmeSupportBot({
    withGuardrail: loadout.guardrail,
    withGrounding: loadout.grounding,
  });
}

// A short, deterministic risk read for the chosen loadout (display only — the
// real verdict still comes from the engine when the battle runs). Pure.
export interface LoadoutRisk {
  level: "hardened" | "partial" | "exposed";
  note: string;
}

export function loadoutRisk(loadout: Loadout): LoadoutRisk {
  if (loadout.guardrail && loadout.grounding) {
    return {
      level: "hardened",
      note: "Guardrail blocks injection/PII and grounding anchors answers — expect a strong defence.",
    };
  }
  if (!loadout.guardrail && !loadout.grounding) {
    return {
      level: "exposed",
      note: "No guardrail and no grounding — the agent is wide open to leaks. Expect breaches.",
    };
  }
  if (!loadout.guardrail) {
    return {
      level: "exposed",
      note: "Guardrail off — injection and PII attacks will get through. Expect breaches.",
    };
  }
  // grounding off only
  return {
    level: "partial",
    note: "Guardrail on but grounding off — defended against attacks, but answers are less anchored.",
  };
}
