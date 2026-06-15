// S124 — BattleArena view + pure playback-state tests.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import {
  BattleArena,
  initArena,
  stepArena,
  revealAllArena,
  resetArena,
  arenaComplete,
  verdictTone,
  verdictLabel,
  outcomeTone,
} from "../src/arena/BattleArena.js";
import {
  acmeSupportBot,
  StubModel,
  ATTACK_BATTERY,
  type ModelAdapter,
} from "../src/engine/index.js";
import { buildBattleTimeline } from "../src/arena/arenaModel.js";

afterEach(cleanup);

// A model that LEAKS every attack's marker — drives real breaches when the
// design has no guardrail (runBattle: !hasGuardrail && output.includes(marker)).
function leakyModel(): ModelAdapter {
  const table: Record<string, string> = {};
  for (const atk of ATTACK_BATTERY) {
    table[atk.payload] = `leaked: ${atk.leakMarker}`;
  }
  return new StubModel(table, { fallback: "I don't know." });
}

describe("arena pure playback state (S124)", () => {
  it("initArena starts at zero revealed", () => {
    expect(initArena(4)).toEqual({ revealed: 0, total: 4 });
  });

  it("stepArena reveals one more, clamped at total", () => {
    let s = initArena(2);
    s = stepArena(s);
    expect(s.revealed).toBe(1);
    s = stepArena(s);
    expect(s.revealed).toBe(2);
    s = stepArena(s); // clamp
    expect(s.revealed).toBe(2);
  });

  it("revealAllArena jumps to total", () => {
    expect(revealAllArena(initArena(4)).revealed).toBe(4);
  });

  it("resetArena returns to zero", () => {
    expect(resetArena({ revealed: 3, total: 4 }).revealed).toBe(0);
  });

  it("arenaComplete is true only when revealed >= total and total > 0", () => {
    expect(arenaComplete({ revealed: 0, total: 0 })).toBe(false);
    expect(arenaComplete({ revealed: 2, total: 4 })).toBe(false);
    expect(arenaComplete({ revealed: 4, total: 4 })).toBe(true);
  });

  it("verdictTone maps each verdict", () => {
    expect(verdictTone("defended")).toBe("success");
    expect(verdictTone("breached")).toBe("danger");
    expect(verdictTone("flaked")).toBe("warn");
  });

  it("verdictLabel maps each verdict", () => {
    expect(verdictLabel("defended")).toBe("DEFENDED");
    expect(verdictLabel("breached")).toBe("BREACHED");
    expect(verdictLabel("flaked")).toBe("FLAKED");
  });

  it("outcomeTone maps each outcome", () => {
    const t = (outcome: string) => ({ outcome } as never);
    expect(outcomeTone(t("flawless"))).toBe("success");
    expect(outcomeTone(t("held"))).toBe("warn");
    expect(outcomeTone(t("breached"))).toBe("danger");
    expect(outcomeTone(t("empty"))).toBe("info");
  });
});

describe("BattleArena view — defends (seed agent)", () => {
  it("renders the agent name and an awaiting state before any attack", () => {
    render(<BattleArena />);
    expect(screen.getByTestId("arena-agent").textContent).toContain("Acme Support Bot");
    expect(screen.getByTestId("arena-shield").textContent).toContain("awaiting");
    expect(screen.getByTestId("arena-round").textContent).toContain("0 /");
    expect(screen.getByTestId("arena-defendrate").textContent).toBe("0%");
  });

  it("steps through rounds one-by-one, revealing framework chips and verdicts", () => {
    render(<BattleArena />);
    const next = screen.getByTestId("arena-next");
    expect(next.textContent).toBe("Begin battle");
    fireEvent.click(next);
    // One round revealed now.
    const rounds = screen.getByTestId("arena-rounds");
    expect(rounds.querySelectorAll("li").length).toBe(1);
    // The first revealed round defended (seed agent has a guardrail) and shows frameworks.
    const firstVerdict = rounds.querySelector('[data-testid^="arena-verdict-"]');
    expect(firstVerdict?.textContent).toBe("DEFENDED");
    expect(screen.getByTestId("arena-next").textContent).toBe("Next attack");
    // S125: plain-language narration renders for the round (intent, response, why-it-matters).
    expect(rounds.querySelector('[data-testid^="arena-intent-"]')?.textContent ?? "").not.toBe("");
    expect(rounds.querySelector('[data-testid^="arena-response-"]')?.textContent ?? "").toMatch(/held its rules|blocked/i);
    expect(rounds.querySelector('[data-testid^="arena-why-"]')?.textContent ?? "").toMatch(/Why it matters/i);
  });

  it("play-to-end reveals all rounds and shows a flawless climax for the guarded seed agent", () => {
    render(<BattleArena />);
    fireEvent.click(screen.getByTestId("arena-skip"));
    const outcome = screen.getByTestId("arena-outcome");
    expect(outcome.textContent).toContain("Flawless defence");
    expect(screen.getByTestId("arena-defendrate").textContent).toBe("100%");
    // Controls disabled once complete.
    expect((screen.getByTestId("arena-next") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("arena-skip") as HTMLButtonElement).disabled).toBe(true);
  });

  it("replay resets back to the start", () => {
    render(<BattleArena />);
    fireEvent.click(screen.getByTestId("arena-skip"));
    expect(screen.queryByTestId("arena-outcome")).not.toBeNull();
    fireEvent.click(screen.getByTestId("arena-reset"));
    expect(screen.queryByTestId("arena-outcome")).toBeNull();
    expect(screen.getByTestId("arena-round").textContent).toContain("0 /");
    expect((screen.getByTestId("arena-reset") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("BattleArena view — breaches (no-guardrail agent + leaky model)", () => {
  it("shows BREACHED rounds and a breached climax", () => {
    const design = acmeSupportBot({ withGrounding: true, withGuardrail: false });
    render(<BattleArena design={design} model={leakyModel()} />);
    fireEvent.click(screen.getByTestId("arena-skip"));
    const outcome = screen.getByTestId("arena-outcome");
    expect(outcome.textContent).toContain("Defence breached");
    // At least one round shows a BREACHED badge.
    const verdicts = screen
      .getByTestId("arena-rounds")
      .querySelectorAll('[data-testid^="arena-verdict-"]');
    const labels = Array.from(verdicts).map((v) => v.textContent);
    expect(labels).toContain("BREACHED");
    // The shield reflects a breach on the last revealed round.
    expect(screen.getByTestId("arena-shield").textContent).toMatch(/breached|holding/);
  });
});

describe("BattleArena view — design change resets playback", () => {
  it("re-initialises when the injected design changes", () => {
    const { rerender } = render(<BattleArena design={acmeSupportBot()} />);
    fireEvent.click(screen.getByTestId("arena-skip"));
    expect(screen.queryByTestId("arena-outcome")).not.toBeNull();
    // New design with a different node count → different timeline identity → reset.
    rerender(
      <BattleArena
        design={acmeSupportBot({ withGrounding: false, withGuardrail: false })}
        model={leakyModel()}
      />,
    );
    // After reset, nothing revealed yet (no climax).
    expect(screen.getByTestId("arena-round").textContent).toContain("0 /");
  });
});

describe("BattleArena view — injected timeline (flaked + empty-payload edge rounds)", () => {
  it("renders a flaked verdict, the flaked shield, the payload fallback, and the flaked climax line", () => {
    // A real timeline built from engine-shaped AttackResult[] — one flaked round
    // with NO matching battery case (so payload falls back to the class) and a
    // defended round, so the climax is 'held' with flaked > 0.
    const timeline = buildBattleTimeline(
      [
        {
          attackId: "atk-unknown-custom",
          class: "jailbreak",
          passed: false,
          output: "(no response captured)",
          mapping: { owasp: "LLM01" },
          flaked: true,
        },
        {
          attackId: "atk-injection-ignore",
          class: "prompt_injection",
          passed: true,
          output: "I can't share that.",
          mapping: { owasp: "LLM01", atlas: "AML.T0051", nist: "MEASURE-2.7" },
          flaked: false,
        },
      ],
      [], // empty battery → the custom attack has no case → payload fallback to class
    );
    render(<BattleArena timeline={timeline} />);
    fireEvent.click(screen.getByTestId("arena-skip"));
    // The flaked round shows the FLAKED badge.
    const verdicts = screen
      .getByTestId("arena-rounds")
      .querySelectorAll('[data-testid^="arena-verdict-"]');
    expect(Array.from(verdicts).map((v) => v.textContent)).toContain("FLAKED");
    // The shield reflects the last revealed verdict; payload fell back to the class text.
    expect(screen.getByTestId("arena-rounds").textContent).toContain("jailbreak");
    // Climax mentions the flaked count.
    expect(screen.getByTestId("arena-outcome").textContent).toContain("flaked");
  });

  it("shows the flaked shield badge when the last revealed round flaked", () => {
    const timeline = buildBattleTimeline(
      [
        {
          attackId: "atk-only-flake",
          class: "tool_abuse",
          passed: false,
          output: "(sandbox error)",
          mapping: { owasp: "LLM07" },
          flaked: true,
        },
      ],
      [],
    );
    render(<BattleArena timeline={timeline} />);
    fireEvent.click(screen.getByTestId("arena-next")); // reveal the single flaked round
    expect(screen.getByTestId("arena-shield").textContent).toContain("flaked");
  });
});
