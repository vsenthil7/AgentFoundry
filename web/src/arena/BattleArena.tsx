// S124 — Battle Mode Arena (the watchable view).
//
// The creative centrepiece. arenaModel.ts already turns the REAL engine output
// (runBattle -> AttackResult[]) into a paced BattleTimeline. This component plays
// that timeline round-by-round as a live arena: each attack lands, the agent
// visibly DEFENDS or is BREACHED, the framework IDs (OWASP/ATLAS/NIST) light up,
// a running defend-rate advances, and the deterministic outcome lands as a climax.
//
// HONESTY: nothing here invents an outcome. The verdicts come from runBattle over
// the real seed agent + StubModel — the same call the Golden Thread console makes.
// "Playing" only controls how many already-decided rounds are revealed so far; it
// never changes a verdict. Runs fully client-side (web engine mirror) so it works
// under make demo-offline with no network.

import { useMemo, useState } from "react";
import {
  acmeSupportBot,
  acmeGroundedModelTable,
  StubModel,
  runBattle,
  type AgentDesign,
  type ModelAdapter,
} from "../engine/index.js";
import {
  buildBattleTimeline,
  outcomeHeadline,
  type BattleTimeline,
  type BattleRound,
  type RoundVerdict,
} from "./arenaModel.js";
import { narrationFor, agentResponseLine } from "./narration.js";
import { ScoreCard } from "./ScoreCard.js";
import { Card, Button, Badge, Banner, type BadgeTone } from "../ui/components.js";

// ---- Pure arena playback state (no React, fully testable) ----

export interface ArenaState {
  // How many rounds have been revealed (0..total). The climax shows at == total.
  revealed: number;
  total: number;
}

export function initArena(total: number): ArenaState {
  return { revealed: 0, total };
}

// Reveal the next round (clamped). Pure.
export function stepArena(s: ArenaState): ArenaState {
  return { ...s, revealed: Math.min(s.revealed + 1, s.total) };
}

// Reveal every round at once (the "skip"/"play to end"). Pure.
export function revealAllArena(s: ArenaState): ArenaState {
  return { ...s, revealed: s.total };
}

// Back to the start. Pure.
export function resetArena(s: ArenaState): ArenaState {
  return { ...s, revealed: 0 };
}

export function arenaComplete(s: ArenaState): boolean {
  return s.total > 0 && s.revealed >= s.total;
}

// Map a round verdict to a design-system badge tone. Pure.
export function verdictTone(v: RoundVerdict): BadgeTone {
  switch (v) {
    case "defended":
      return "success";
    case "breached":
      return "danger";
    case "flaked":
      return "warn";
  }
}

export function verdictLabel(v: RoundVerdict): string {
  switch (v) {
    case "defended":
      return "DEFENDED";
    case "breached":
      return "BREACHED";
    case "flaked":
      return "FLAKED";
  }
}

// Outcome banner tone for the climax. Pure.
export function outcomeTone(t: BattleTimeline): "success" | "warn" | "danger" | "info" {
  switch (t.outcome) {
    case "flawless":
      return "success";
    case "held":
      return "warn";
    case "breached":
      return "danger";
    case "empty":
      return "info";
  }
}

// ---- The view ----

export interface BattleArenaProps {
  // Defaults to the real seed agent; injectable so tests/Loadout can drive any design.
  design?: AgentDesign;
  model?: ModelAdapter;
  // Optional pre-built timeline. When supplied, the arena plays THIS instead of
  // running the engine itself — the seam the Loadout screen (S126) uses to feed a
  // battle it already ran, and the seam tests use to exercise flaked/edge rounds
  // that the default StubModel never produces. The values are still real engine
  // output (buildBattleTimeline over AttackResult[]); nothing is invented here.
  timeline?: BattleTimeline;
}

export function BattleArena({ design: designProp, model: modelProp, timeline: timelineProp }: BattleArenaProps) {
  const design = useMemo(() => designProp ?? acmeSupportBot(), [designProp]);
  const model = useMemo(
    () => modelProp ?? new StubModel(acmeGroundedModelTable(), { fallback: "I don't know." }),
    [modelProp],
  );

  // Drive the REAL engine once; the timeline is a pure projection of its results.
  // (Skipped when a timeline is injected directly.)
  const computed = useMemo<BattleTimeline>(() => {
    const results = runBattle(design, model, { designId: design.id });
    return buildBattleTimeline(results);
  }, [design, model]);
  const timeline = timelineProp ?? computed;

  const [arena, setArena] = useState<ArenaState>(() => initArena(timeline.total));

  // If the battle itself changes (new design or model produces different rounds),
  // reset playback. Keyed on a content signature, not just the round count, since
  // two designs can yield the same number of rounds with different verdicts.
  const signature = useMemo(
    () => timeline.rounds.map((r) => `${r.attackId}:${r.verdict}`).join("|") + `#${timeline.total}`,
    [timeline],
  );
  const [seenSig, setSeenSig] = useState(signature);
  if (seenSig !== signature) {
    setSeenSig(signature);
    setArena(initArena(timeline.total));
  }

  const shownRounds = timeline.rounds.slice(0, arena.revealed);
  const complete = arenaComplete(arena);
  const last = shownRounds[shownRounds.length - 1];

  // Running defend-rate over what's been revealed so far.
  const revealedDefended = shownRounds.filter((r) => r.verdict === "defended").length;
  const liveRate =
    arena.revealed === 0 ? 0 : Math.round((revealedDefended / arena.revealed) * 100);

  return (
    <div className="arena" data-testid="battle-arena">
      <Card
        title="⚔️ Battle Mode Arena"
        actions={
          <span className="arena__agent" data-testid="arena-agent">
            {design.name}
          </span>
        }
      >
        <p className="arena__intro">
          The agent faces a live red-team gauntlet. Every attack below maps to a real
          framework (OWASP LLM Top-10 · MITRE ATLAS · NIST AI RMF), and every verdict comes
          straight from the deterministic engine — no theatre.
        </p>

        {/* Scoreboard */}
        <div className="arena__scoreboard" data-testid="arena-scoreboard">
          <div className="arena__stat">
            <span className="arena__stat-num" data-testid="arena-round">
              {Math.min(arena.revealed, arena.total)} / {arena.total}
            </span>
            <span className="arena__stat-label">rounds</span>
          </div>
          <div className="arena__stat">
            <span className="arena__stat-num" data-testid="arena-defendrate">
              {liveRate}%
            </span>
            <span className="arena__stat-label">defended</span>
          </div>
          <div className="arena__shield" data-testid="arena-shield">
            {/* Shield reflects the most recent revealed verdict. */}
            {last ? (
              <Badge tone={verdictTone(last.verdict)}>
                {last.verdict === "defended" ? "🛡 holding" : last.verdict === "breached" ? "💥 breached" : "… flaked"}
              </Badge>
            ) : (
              <Badge tone="neutral">awaiting first attack</Badge>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="arena__controls">
          <Button
            variant="primary"
            onClick={() => setArena(stepArena)}
            disabled={complete}
            data-testid="arena-next"
          >
            {arena.revealed === 0 ? "Begin battle" : "Next attack"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setArena(revealAllArena)}
            disabled={complete}
            data-testid="arena-skip"
          >
            Play to end
          </Button>
          <Button
            variant="ghost"
            onClick={() => setArena(resetArena)}
            disabled={arena.revealed === 0}
            data-testid="arena-reset"
          >
            Replay
          </Button>
        </div>

        {/* Rounds */}
        <ol className="arena__rounds" data-testid="arena-rounds">
          {shownRounds.map((r) => (
            <ArenaRoundCard key={r.attackId} round={r} />
          ))}
        </ol>

        {/* Climax */}
        {complete && (
          <Banner tone={outcomeTone(timeline)} data-testid="arena-outcome">
            <strong>{outcomeHeadline(timeline)}</strong> — {timeline.defended} defended,{" "}
            {timeline.breached} breached
            {timeline.flaked > 0 ? `, ${timeline.flaked} flaked` : ""}. Verdict from the
            deterministic engine.
          </Banner>
        )}
      </Card>

      {/* Shareable scorecard at the climax (S127). */}
      {complete && (
        <ScoreCard
          timeline={timeline}
          agentName={design.name}
          onReplay={() => setArena(resetArena)}
        />
      )}
    </div>
  );
}

function ArenaRoundCard({ round }: { round: BattleRound }) {
  const narration = narrationFor(round.attackClass);
  return (
    <li className="arena__round" data-testid={`arena-round-${round.attackId}`}>
      <div className="arena__round-head">
        <span className="arena__round-name">{round.attackName}</span>
        <Badge tone={verdictTone(round.verdict)} data-testid={`arena-verdict-${round.attackId}`}>
          {verdictLabel(round.verdict)}
        </Badge>
      </div>
      {/* Plain-language narration so a non-expert follows along (S125). */}
      <p className="arena__narrate arena__narrate--intent" data-testid={`arena-intent-${round.attackId}`}>
        {narration.attackerIntent}
      </p>
      <div className="arena__round-body">
        <div className="arena__line">
          <span className="arena__line-tag arena__line-tag--atk">Attacker</span>
          <span className="arena__line-text">{round.payload || round.attackClass}</span>
        </div>
        <div className="arena__line">
          <span className="arena__line-tag arena__line-tag--def">Agent</span>
          <span className="arena__line-text">{round.output}</span>
        </div>
      </div>
      <p className="arena__narrate arena__narrate--verdict" data-testid={`arena-response-${round.attackId}`}>
        {agentResponseLine(round.attackClass, round.verdict)}
      </p>
      <p className="arena__narrate arena__narrate--why" data-testid={`arena-why-${round.attackId}`}>
        <span className="arena__why-label">Why it matters:</span> {narration.whyItMatters}{" "}
        <span className="arena__why-fw">{narration.frameworkContext}</span>
      </p>
      <div className="arena__chips" data-testid={`arena-frameworks-${round.attackId}`}>
        {round.frameworks.map((f) => (
          <span key={f} className="arena__chip">
            {f}
          </span>
        ))}
      </div>
    </li>
  );
}
