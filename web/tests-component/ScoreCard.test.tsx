// S127 — Arena scorecard tests (pure model + view).

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  buildScoreCard,
  scoreCardHeadline,
  classResultLabel,
  classResultTone,
} from "../src/arena/scorecardModel.js";
import { ScoreCard } from "../src/arena/ScoreCard.js";
import { buildBattleTimeline } from "../src/arena/arenaModel.js";
import type { AttackResult } from "../src/engine/index.js";

afterEach(cleanup);

// Helpers to build real timelines from engine-shaped results.
function result(over: Partial<AttackResult> & { attackId: string }): AttackResult {
  return {
    attackId: over.attackId,
    class: over.class ?? "prompt_injection",
    passed: over.passed ?? true,
    output: over.output ?? "ok",
    mapping: over.mapping ?? { owasp: "LLM01" },
    flaked: over.flaked ?? false,
  };
}

const flawless = () =>
  buildBattleTimeline(
    [
      result({ attackId: "a", class: "prompt_injection", passed: true, mapping: { owasp: "LLM01", atlas: "AML.T0051" } }),
      result({ attackId: "b", class: "pii_exfiltration", passed: true, mapping: { owasp: "LLM06" } }),
    ],
    [],
  );

const breached = () =>
  buildBattleTimeline(
    [
      result({ attackId: "a", class: "prompt_injection", passed: true, mapping: { owasp: "LLM01" } }),
      result({ attackId: "b", class: "jailbreak", passed: false, mapping: { owasp: "LLM01" } }),
    ],
    [],
  );

const flaked = () =>
  buildBattleTimeline(
    [result({ attackId: "a", class: "tool_abuse", passed: false, flaked: true, mapping: { owasp: "LLM07" } })],
    [],
  );

describe("scorecard pure model (S127)", () => {
  it("buildScoreCard summarises a flawless battle, frameworks sorted + distinct", () => {
    const m = buildScoreCard(flawless(), { agentName: "Acme Bot" });
    expect(m.agentName).toBe("Acme Bot");
    expect(m.total).toBe(2);
    expect(m.defended).toBe(2);
    expect(m.breached).toBe(0);
    expect(m.defendRatePct).toBe(100);
    expect(m.outcome).toBe("flawless");
    // Distinct, sorted framework chips across both rounds.
    expect(m.frameworks).toEqual(["ATLAS AML.T0051", "OWASP LLM01", "OWASP LLM06"]);
    // tier is null unless supplied.
    expect(m.tier).toBeNull();
  });

  it("buildScoreCard reflects a breached battle", () => {
    const m = buildScoreCard(breached(), { agentName: "Acme Bot" });
    expect(m.defendRatePct).toBe(50);
    expect(m.outcome).toBe("breached");
    expect(m.breached).toBe(1);
  });

  it("per-class tally is sorted and counts verdicts", () => {
    const m = buildScoreCard(breached());
    const classes = m.perClass.map((c) => c.attackClass);
    expect(classes).toEqual([...classes].sort());
    const jb = m.perClass.find((c) => c.attackClass === "jailbreak")!;
    expect(jb.breached).toBe(1);
    expect(jb.defended).toBe(0);
  });

  it("defaults agentName to 'Agent' when not supplied", () => {
    expect(buildScoreCard(flawless()).agentName).toBe("Agent");
  });

  it("scoreCardHeadline includes the tier only when earned (not 'none')", () => {
    expect(scoreCardHeadline("Bot", 4, 4, "gold")).toContain("GOLD");
    expect(scoreCardHeadline("Bot", 4, 4, "none")).not.toContain("NONE");
    expect(scoreCardHeadline("Bot", 4, 4, null)).toBe("Bot defended 4/4");
  });

  it("classResultLabel and classResultTone reflect held / breached / flaked", () => {
    const held = { attackClass: "prompt_injection" as const, total: 2, defended: 2, breached: 0, flaked: 0 };
    const broke = { attackClass: "jailbreak" as const, total: 2, defended: 1, breached: 1, flaked: 0 };
    const flak = { attackClass: "tool_abuse" as const, total: 1, defended: 0, breached: 0, flaked: 1 };
    expect(classResultLabel(held)).toBe("2/2 held");
    expect(classResultTone(held)).toBe("success");
    expect(classResultLabel(broke)).toContain("held");
    expect(classResultTone(broke)).toBe("danger");
    expect(classResultLabel(flak)).toContain("flaked");
    expect(classResultTone(flak)).toBe("warn");
  });
});

describe("ScoreCard view (S127)", () => {
  it("renders the headline, defend-rate, per-class rows and frameworks from a timeline", () => {
    render(<ScoreCard timeline={flawless()} agentName="Acme Bot" />);
    expect(screen.getByTestId("scorecard-headline").textContent).toContain("Acme Bot defended 2/2");
    expect(screen.getByTestId("scorecard-defendrate").textContent).toBe("100%");
    expect(screen.getByTestId("scorecard-classes")).toBeTruthy();
    expect(screen.getByTestId("scorecard-frameworks").textContent).toContain("OWASP LLM01");
    // No tier supplied → shows the outcome badge instead.
    expect(screen.getByTestId("scorecard-outcome").textContent).toBe("FLAWLESS");
  });

  it("shows the certification tier badge when a real tier is supplied", () => {
    render(<ScoreCard timeline={flawless()} agentName="Acme Bot" tier="gold" />);
    expect(screen.getByTestId("scorecard-tier").textContent).toBe("GOLD");
    expect(screen.getByTestId("scorecard-headline").textContent).toContain("GOLD");
  });

  it("renders a prebuilt model and a working replay button", () => {
    const model = buildScoreCard(breached(), { agentName: "Acme Bot", tier: "bronze" });
    let replayed = 0;
    render(<ScoreCard model={model} onReplay={() => (replayed += 1)} />);
    expect(screen.getByTestId("scorecard-tier").textContent).toBe("BRONZE");
    fireEvent.click(screen.getByTestId("scorecard-replay"));
    expect(replayed).toBe(1);
  });

  it("renders a flaked battle's class row", () => {
    render(<ScoreCard timeline={flaked()} agentName="Bot" />);
    expect(screen.getByTestId("scorecard-class-tool_abuse").textContent).toMatch(/flaked/i);
  });

  it("shows an empty state when neither model nor timeline is given", () => {
    render(<ScoreCard />);
    expect(screen.getByTestId("scorecard-empty")).toBeTruthy();
  });
});
