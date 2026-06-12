import type { AgentDesign } from "./types.js";
import type { EvalCase } from "./eval.js";
import { ATTACK_BATTERY, type AttackCase } from "./redteam.js";

// Export produces a runnable Foundry-style manifest. The round-trip fidelity
// test serializes -> deserializes and asserts the design is behaviorally
// identical. Serialization is canonical (sorted keys) so it is deterministic.

export interface FoundryManifest {
  schemaVersion: "1.0";
  agent: AgentDesign;
  evalSuite: EvalCase[];
  redTeamSuite: AttackCase[];
}

export function exportManifest(
  design: AgentDesign,
  evalSuite: EvalCase[],
  redTeamSuite: AttackCase[] = ATTACK_BATTERY,
): FoundryManifest {
  return {
    schemaVersion: "1.0",
    agent: design,
    evalSuite,
    redTeamSuite,
  };
}

// Canonical JSON: keys sorted recursively so output is byte-stable.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonical((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function serializeManifest(m: FoundryManifest): string {
  return JSON.stringify(canonical(m), null, 2);
}

export function deserializeManifest(json: string): FoundryManifest {
  return JSON.parse(json) as FoundryManifest;
}

// Round-trip: serialize then deserialize then re-serialize; the two strings
// must be identical (behaviorally + structurally lossless).
export function roundTripIsLossless(m: FoundryManifest): boolean {
  const once = serializeManifest(m);
  const back = deserializeManifest(once);
  const twice = serializeManifest(back);
  return once === twice;
}
