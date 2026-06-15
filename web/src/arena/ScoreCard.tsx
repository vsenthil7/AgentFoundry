// S127 — Arena ScoreCard view (the screenshot-able results card).
//
// Renders the pure ScoreCardModel (scorecard.ts) as a clean, shareable card a
// judge or community voter can screenshot. No verdicts or tier are invented here
// — it displays exactly what buildScoreCard produced from the real battle.

import {
  buildScoreCard,
  classResultLabel,
  classResultTone,
  type ScoreCardModel,
} from "./scorecardModel.js";
import { narrationFor } from "./narration.js";
import type { BattleTimeline } from "./arenaModel.js";
import type { CertificationTier } from "../engine/certification.js";
import { Card, Badge, Button, type BadgeTone } from "../ui/components.js";

const TIER_TONE: Record<CertificationTier, BadgeTone> = {
  gold: "success",
  silver: "info",
  bronze: "warn",
  none: "neutral",
};

const OUTCOME_TONE: Record<ScoreCardModel["outcome"], BadgeTone> = {
  flawless: "success",
  held: "warn",
  breached: "danger",
  empty: "neutral",
};

export interface ScoreCardProps {
  // Either pass a prebuilt model, or a timeline (+ optional name/tier) to build from.
  model?: ScoreCardModel;
  timeline?: BattleTimeline;
  agentName?: string;
  tier?: CertificationTier | null;
  onReplay?: () => void;
}

export function ScoreCard({ model: modelProp, timeline, agentName, tier, onReplay }: ScoreCardProps) {
  const model =
    modelProp ??
    (timeline ? buildScoreCard(timeline, { agentName, tier: tier ?? null }) : null);

  if (!model) {
    return (
      <div className="scorecard" data-testid="scorecard-empty">
        <Card title="Battle scorecard">
          <p className="scorecard__empty">Run a battle to generate a scorecard.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="scorecard" data-testid="scorecard">
      <Card
        title="🏅 Battle Scorecard"
        actions={
          model.tier ? (
            <Badge tone={TIER_TONE[model.tier]} data-testid="scorecard-tier">
              {model.tier.toUpperCase()}
            </Badge>
          ) : (
            <Badge tone={OUTCOME_TONE[model.outcome]} data-testid="scorecard-outcome">
              {model.outcome.toUpperCase()}
            </Badge>
          )
        }
      >
        <p className="scorecard__headline" data-testid="scorecard-headline">
          {model.headline}
        </p>

        <div className="scorecard__big">
          <span className="scorecard__big-num" data-testid="scorecard-defendrate">
            {model.defendRatePct}%
          </span>
          <span className="scorecard__big-label">
            defended ({model.defended}/{model.total} attacks)
          </span>
        </div>

        <div className="scorecard__classes" data-testid="scorecard-classes">
          {model.perClass.map((c) => (
            <div key={c.attackClass} className="scorecard__class" data-testid={`scorecard-class-${c.attackClass}`}>
              <span className="scorecard__class-name">{narrationFor(c.attackClass).title}</span>
              <Badge tone={classResultTone(c)}>{classResultLabel(c)}</Badge>
            </div>
          ))}
        </div>

        <div className="scorecard__frameworks" data-testid="scorecard-frameworks">
          <span className="scorecard__fw-label">Frameworks exercised:</span>
          {model.frameworks.map((f) => (
            <span key={f} className="scorecard__fw-chip">
              {f}
            </span>
          ))}
        </div>

        {onReplay && (
          <Button variant="ghost" onClick={onReplay} data-testid="scorecard-replay">
            ↻ Replay this battle
          </Button>
        )}
      </Card>
    </div>
  );
}
