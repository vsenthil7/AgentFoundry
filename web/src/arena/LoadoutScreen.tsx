// S126 — Agent Loadout screen (compose-your-defender, then watch it fight).
//
// The creative loop: the user picks the agent's defensive capabilities, sees an
// honest risk read, then sends THAT design into the Battle Arena. The toggles
// drive the real engine (loadout.ts → acmeSupportBot overrides), so the choices
// genuinely change whether attacks breach — nothing here is cosmetic.
//
// NOTE: this file is LoadoutScreen.tsx (not Loadout.tsx) to avoid a case-only
// filename collision with the pure reducer loadout.ts on case-insensitive
// filesystems (Windows/macOS) — TS treats Loadout.ts and loadout.ts as the same
// module, which broke the import resolution.

import { useState } from "react";
import {
  DEFAULT_LOADOUT,
  toggleLoadout,
  designForLoadout,
  loadoutRisk,
  type Loadout,
  type LoadoutToggle,
} from "./loadout.js";
import { BattleArena } from "./BattleArena.js";
import { Card, Button, Badge, type BadgeTone } from "../ui/components.js";

const RISK_TONE: Record<ReturnType<typeof loadoutRisk>["level"], BadgeTone> = {
  hardened: "success",
  partial: "warn",
  exposed: "danger",
};

const CAPABILITIES: { key: LoadoutToggle; label: string; blurb: string }[] = [
  {
    key: "guardrail",
    label: "Injection + PII guardrail",
    blurb: "Blocks prompt-injection and stops sensitive data leaving.",
  },
  {
    key: "grounding",
    label: "Knowledge grounding",
    blurb: "Anchors answers to approved sources instead of guessing.",
  },
];

export function LoadoutScreen() {
  const [loadout, setLoadout] = useState<Loadout>(DEFAULT_LOADOUT);
  // The arena is keyed by the loadout the user committed to, so "Send into the
  // arena" rebuilds the battle from the chosen design.
  const [committed, setCommitted] = useState<Loadout | null>(null);

  const risk = loadoutRisk(loadout);

  return (
    <div className="loadout" data-testid="loadout-screen">
      <Card title="🧰 Agent Loadout" actions={<Badge tone={RISK_TONE[risk.level]} data-testid="loadout-risk">{risk.level.toUpperCase()}</Badge>}>
        <p className="loadout__intro">
          Choose your agent's defences, then send it into the arena. These toggles aren't
          decoration — they switch real nodes on the agent, so the battle's verdicts change
          with your choices.
        </p>

        <ul className="loadout__caps" data-testid="loadout-caps">
          {CAPABILITIES.map((cap) => {
            const on = loadout[cap.key];
            return (
              <li key={cap.key} className="loadout__cap">
                <div className="loadout__cap-text">
                  <span className="loadout__cap-label">{cap.label}</span>
                  <span className="loadout__cap-blurb">{cap.blurb}</span>
                </div>
                <Button
                  variant={on ? "primary" : "secondary"}
                  onClick={() => setLoadout((s) => toggleLoadout(s, cap.key))}
                  data-testid={`loadout-toggle-${cap.key}`}
                  aria-pressed={on}
                >
                  {on ? "ON" : "OFF"}
                </Button>
              </li>
            );
          })}
        </ul>

        <p className="loadout__risk-note" data-testid="loadout-risk-note">
          {risk.note}
        </p>

        <Button
          variant="primary"
          onClick={() => setCommitted({ ...loadout })}
          data-testid="loadout-fight"
        >
          ⚔ Send into the arena
        </Button>
      </Card>

      {committed && (
        <div className="loadout__arena" data-testid="loadout-arena">
          <BattleArena design={designForLoadout(committed)} />
        </div>
      )}
    </div>
  );
}
