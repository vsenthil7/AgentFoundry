import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App.js";
import { acmeSupportBot, StubModel, type AgentDesign } from "../src/engine/index.js";

// These run in jsdom in CI here (no browser needed) and cover the same flows
// the Playwright suite drives in a real browser. The two are complementary:
// component tests prove the logic; Playwright proves real-browser rendering.

beforeEach(() => cleanup());

describe("App — render", () => {
  it("renders masthead, pipeline and a valid canvas", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "AgentFoundry" })).toBeInTheDocument();
    expect(screen.getByTestId("graph-valid")).toHaveTextContent("VALID");
    expect(screen.getByTestId("coverage-matrix")).toHaveTextContent("YES");
    expect(screen.getByTestId("node-grounding-1")).toBeInTheDocument();
  });

  it("gates downstream controls until prerequisites are met", () => {
    render(<App />);
    expect(screen.queryByTestId("btn-redteam")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-score")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-approve")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-export")).not.toBeInTheDocument();
  });
});

describe("App — full Golden Thread walk", () => {
  it("evaluate → redteam → score → approve → export green", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId("btn-evaluate"));
    expect(screen.getByTestId("grounded-accuracy")).toBeInTheDocument();

    await user.click(screen.getByTestId("btn-redteam"));
    expect(screen.getByTestId("attack-atk-injection-ignore")).toBeInTheDocument();
    for (const id of [
      "atk-injection-ignore",
      "atk-pii-exfil",
      "atk-jailbreak-dan",
      "atk-tool-abuse",
    ]) {
      expect(screen.getByTestId(`attack-status-${id}`)).toHaveTextContent("DEFENDED");
    }

    await user.click(screen.getByTestId("btn-score"));
    expect(screen.getByTestId("weighted-score")).toBeInTheDocument();

    await user.click(screen.getByTestId("btn-approve"));
    expect(screen.getByTestId("approval-result")).toHaveTextContent("APPROVED");

    await user.click(screen.getByTestId("btn-export"));
    expect(screen.getByTestId("export-result")).toHaveTextContent("LOSSLESS");

    // S7/S8: registry record appears with lineage and a clear regression gate.
    expect(screen.getByTestId("registry-state")).toHaveTextContent("deployed");
    expect(screen.getByTestId("lineage-0")).toBeInTheDocument();
    expect(screen.getByTestId("regression-result")).toHaveTextContent("CLEAR");

    // S9: certification tier + badges appear.
    expect(screen.getByTestId("cert-tier")).toBeInTheDocument();
    expect(screen.getByTestId("badge-human_gated")).toBeInTheDocument();
    expect(screen.getByTestId("badge-status-fully_mapped_redteam")).toHaveTextContent(
      "EARNED",
    );

    // S10: marketplace publish + interoperable consume.
    expect(screen.getByTestId("pack-id")).toHaveTextContent("pack-acme");
    expect(screen.getByTestId("consumed-score")).toHaveTextContent("interoperable");
  });
});

describe("App — negative / refusal paths", () => {
  it("rejecting at the human gate blocks export", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("btn-evaluate"));
    await user.click(screen.getByTestId("btn-redteam"));
    await user.click(screen.getByTestId("btn-score"));
    await user.click(screen.getByTestId("btn-reject"));
    expect(screen.getByTestId("approval-result")).toHaveTextContent("REJECTED");
    expect(screen.queryByTestId("btn-export")).not.toBeInTheDocument();
  });
});

describe("App — remove-the-source", () => {
  it("toggling Foundry IQ off lowers grounded accuracy", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("btn-evaluate"));
    const on = parseFloat(
      screen.getByTestId("grounded-accuracy").textContent!.match(/[\d.]+/)![0],
    );
    await user.click(screen.getByTestId("btn-toggle-grounding"));
    const off = parseFloat(
      screen.getByTestId("grounded-accuracy").textContent!.match(/[\d.]+/)![0],
    );
    expect(off).toBeLessThan(on);
  });
});

describe("App — audit log", () => {
  it("records actions", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByTestId("audit-log")).toHaveTextContent("no actions yet");
    await user.click(screen.getByTestId("btn-evaluate"));
    expect(screen.getByTestId("audit-log")).toHaveTextContent("evaluate:");
  });
});

describe("App — score metrics and banners", () => {
  it("shows all five score metrics after scoring", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("btn-evaluate"));
    await user.click(screen.getByTestId("btn-redteam"));
    await user.click(screen.getByTestId("btn-score"));
    const panel = screen.getByTestId("score-panel");
    for (const label of [
      "grounded-accuracy",
      "safety pass rate",
      "consistency",
      "HITL coverage",
      "tool-scope risk",
    ]) {
      expect(panel).toHaveTextContent(label);
    }
  });

  it("toggling grounding off first, then on, restores accuracy (both banner styles)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("btn-evaluate"));
    // off -> fail banner
    await user.click(screen.getByTestId("btn-toggle-grounding"));
    const off = parseFloat(
      screen.getByTestId("grounded-accuracy").textContent!.match(/[\d.]+/)![0],
    );
    expect(off).toBe(0);
    // on -> pass banner
    await user.click(screen.getByTestId("btn-toggle-grounding"));
    const on = parseFloat(
      screen.getByTestId("grounded-accuracy").textContent!.match(/[\d.]+/)![0],
    );
    expect(on).toBeGreaterThan(0);
  });
});

// A deliberately weak + structurally-broken agent. The console is injectable
// (App accepts design/model props), so these are REAL outcomes of driving a bad
// agent through the same deterministic engine — not forced UI states:
//  - an edge to a missing node -> the compiler reports the graph INVALID
//  - no guardrail node -> the red-team attacks LEAK
//  - an empty model table -> grounded-accuracy collapses and the score fails
//  - a failing score -> sub-threshold styling, "none" certification, unearned badges
function brokenAgent(): AgentDesign {
  const d = acmeSupportBot({ withGrounding: false, withGuardrail: false });
  return {
    ...d,
    // Reference a node that does not exist -> INVALID_EDGE -> invalid graph.
    edges: [...d.edges, { from: "model-1", to: "ghost-node" }],
  };
}

// A leaky model: its fallback output contains every red-team leak marker, so an
// agent with no guardrail node will LEAK every attack. It also knows none of the
// grounded answers, so grounded-accuracy collapses and the score fails. These
// are real engine outcomes of a genuinely unsafe model, not forced UI states.
function leakyModel(): StubModel {
  return new StubModel(
    {},
    { fallback: "SYSTEM_PROMPT_LEAK 4111-1111 ADMIN_PASSWORD EMAIL_SENT" },
  );
}

describe("App — weak/broken agent surfaces the real failure states", () => {
  it("renders an INVALID graph badge and disables evaluate", () => {
    render(<App design={brokenAgent()} model={leakyModel()} />);
    expect(screen.getByTestId("graph-valid")).toHaveTextContent("INVALID");
    // evaluate is gated on a valid graph
    expect(screen.getByTestId("btn-evaluate")).toBeDisabled();
  });

  it("a weak agent leaks attacks, fails the score, and earns no certification", async () => {
    const user = userEvent.setup();
    // Grounding ON (so the high-risk graph is VALID and we can walk the pipeline)
    // but NO guardrail node, driven by a leaky model. The attacks leak, the
    // grounded answers miss, the score fails, and certification is "none" — all
    // real engine outcomes of an unsafe agent, exercised through the real UI.
    const noGuardrail = acmeSupportBot({ withGrounding: true, withGuardrail: false });
    render(<App design={noGuardrail} model={leakyModel()} />);

    expect(screen.getByTestId("graph-valid")).toHaveTextContent("VALID");

    await user.click(screen.getByTestId("btn-evaluate"));
    // grounded-accuracy collapses with a leaky/empty model -> danger banner (false side)
    const acc = parseFloat(
      screen.getByTestId("grounded-accuracy").textContent!.match(/[\d.]+/)![0],
    );
    expect(acc).toBeLessThan(0.5);

    await user.click(screen.getByTestId("btn-redteam"));
    // every attack LEAKED (no guardrail + leaky model) -> danger attack badge (false side)
    const leaked = screen.getAllByText("LEAKED");
    expect(leaked.length).toBeGreaterThan(0);

    await user.click(screen.getByTestId("btn-score"));
    // sub-threshold score -> the --fail styling branch
    const score = screen.getByTestId("weighted-score");
    expect(score.className).toContain("af-console__score--fail");

    // A sub-threshold agent is blocked at the promotion gate: clicking Approve
    // returns threshold_failed, so it never advances to export. This is the
    // honest product behaviour — an unsafe agent cannot be promoted.
    await user.click(screen.getByTestId("btn-approve"));
    expect(screen.getByTestId("approval-result")).toHaveTextContent("REJECTED / blocked");
    expect(screen.queryByTestId("btn-export")).not.toBeInTheDocument();
  });

  it("a GOOD-BUT-IMPERFECT agent passes the gate, exports, and earns silver with an unearned badge", async () => {
    const user = userEvent.setup();
    // The full seed agent (valid graph, guardrail defends every attack) but a
    // model that grounds only ONE of the two golden cases. grounded-accuracy is
    // 0.75: above the 0.8 promotion threshold once weighted (0.8575, so it
    // promotes + exports) but BELOW the 0.9 "Grounded" badge cutoff. This is the
    // real "good enough to ship, not perfect" case a governance product must
    // handle: the agent exports, earns 6/7 badges (silver), and the Grounded
    // badge renders as unearned. None of this is forced — it is the engine's
    // deterministic output for this model.
    const partialModel = new StubModel(
      {
        "ctx:Support hours are 9am to 5pm.:What are your support hours?":
          "Our support hours are 9am to 5pm.",
        // refund question deliberately unanswered -> one golden case misses
      },
      { fallback: "I don't know." },
    );
    render(<App design={acmeSupportBot()} model={partialModel} />);

    await user.click(screen.getByTestId("btn-evaluate"));
    await user.click(screen.getByTestId("btn-redteam"));
    // guardrail present -> every attack still DEFENDED even with this model
    for (const id of ["atk-injection-ignore", "atk-pii-exfil", "atk-jailbreak-dan", "atk-tool-abuse"]) {
      expect(screen.getByTestId(`attack-status-${id}`)).toHaveTextContent("DEFENDED");
    }

    await user.click(screen.getByTestId("btn-score"));
    // passing score -> the --pass styling branch (not --fail)
    expect(screen.getByTestId("weighted-score").className).toContain("af-console__score--pass");

    await user.click(screen.getByTestId("btn-approve"));
    expect(screen.getByTestId("approval-result")).toHaveTextContent("APPROVED");
    await user.click(screen.getByTestId("btn-export"));

    // exported successfully -> LOSSLESS, registry deployed, regression CLEAR
    expect(screen.getByTestId("export-result")).toHaveTextContent("LOSSLESS");
    expect(screen.getByTestId("registry-state")).toHaveTextContent("deployed");

    // certification is silver (6/7), NOT gold -> tier text + the unearned-badge
    // "—" branch (the Grounded badge is genuinely not earned at acc 0.75 < 0.9).
    expect(screen.getByTestId("cert-tier")).toHaveTextContent("SILVER");
    expect(screen.getByTestId("badge-status-grounded")).toHaveTextContent("—");
  });
});
