// S127 — Arena scorecard (pure share-card model).
//
// The shareable payoff: after a battle, compose a deterministic results card a
// judge or community voter can screenshot — "Acme Support Bot · defended 4/4 ·
// OWASP+ATLAS+NIST covered · GOLD". Everything is derived from the REAL battle
// timeline (S124) and, when supplied, the REAL certification (S9 certify()).
//
// HONESTY: this module invents no verdicts and no tier. defend-rate and per-class
// results come straight from the timeline's rounds; the certification tier is
// only shown when a real Certification is passed in (the console computes it via
// certify()). If none is supplied, the card shows the framework coverage the
// battle proves, not a made-up grade. Pure (no React, no randomness).
//
// NOTE: this file is scorecardModel.ts (not ScoreCard.ts) to avoid a case-only
// filename collision with the view ScoreCard.tsx on case-insensitive filesystems
// (Windows/macOS) — TS treats ScoreCard.ts and scorecard.ts as the same module.

import type { BattleTimeline, RoundVerdict } from "./arenaModel.js";
import type { AttackClass } from "../engine/redteam.js";
import type { CertificationTier } from "../engine/certification.js";

export interface ClassResult {
  attackClass: AttackClass;
  total: number;
  defended: number;
  breached: number;
  flaked: number;
}

export interface ScoreCardModel {
  agentName: string;
  total: number;
  defended: number;
  breached: number;
  defendRatePct: number; // 0..100, integer
  outcome: BattleTimeline["outcome"];
  headline: string; // one-line summary for the card
  perClass: ClassResult[]; // sorted by attackClass for determinism
  frameworks: string[]; // distinct framework chips proven across the battle, sorted
  tier: CertificationTier | null; // only when a real Certification is supplied
}

function tallyByClass(timeline: BattleTimeline): ClassResult[] {
  const byClass = new Map<AttackClass, ClassResult>();
  for (const r of timeline.rounds) {
    const entry =
      byClass.get(r.attackClass) ??
      { attackClass: r.attackClass, total: 0, defended: 0, breached: 0, flaked: 0 };
    entry.total++;
    if (r.verdict === "defended") entry.defended++;
    else if (r.verdict === "breached") entry.breached++;
    else entry.flaked++;
    byClass.set(r.attackClass, entry);
  }
  return [...byClass.values()].sort((a, b) =>
    a.attackClass.localeCompare(b.attackClass),
  );
}

function distinctFrameworks(timeline: BattleTimeline): string[] {
  const set = new Set<string>();
  for (const r of timeline.rounds) for (const f of r.frameworks) set.add(f);
  return [...set].sort();
}

// The card's one-line headline. Deterministic; reflects the real outcome + tier.
export function scoreCardHeadline(
  agentName: string,
  defended: number,
  total: number,
  tier: CertificationTier | null,
): string {
  const base = `${agentName} defended ${defended}/${total}`;
  if (tier && tier !== "none") return `${base} · ${tier.toUpperCase()}`;
  return base;
}

export interface BuildScoreCardOpts {
  agentName?: string;
  tier?: CertificationTier | null;
}

export function buildScoreCard(
  timeline: BattleTimeline,
  opts: BuildScoreCardOpts = {},
): ScoreCardModel {
  const agentName = opts.agentName ?? "Agent";
  const tier = opts.tier ?? null;
  const defendRatePct = Math.round(timeline.defendRate * 100);
  return {
    agentName,
    total: timeline.total,
    defended: timeline.defended,
    breached: timeline.breached,
    defendRatePct,
    outcome: timeline.outcome,
    headline: scoreCardHeadline(agentName, timeline.defended, timeline.total, tier),
    perClass: tallyByClass(timeline),
    frameworks: distinctFrameworks(timeline),
    tier,
  };
}

// Human label for a per-class line. Pure.
export function classResultLabel(c: ClassResult): string {
  if (c.breached > 0) return `${c.defended}/${c.total} held`;
  if (c.flaked > 0) return `${c.defended}/${c.total} held (${c.flaked} flaked)`;
  return `${c.total}/${c.total} held`;
}

// Verdict-free tone for a per-class row badge. Pure.
export function classResultTone(c: ClassResult): "success" | "warn" | "danger" {
  if (c.breached > 0) return "danger";
  if (c.flaked > 0) return "warn";
  return "success";
}

// Re-exported for the view's convenience.
export type { RoundVerdict };
