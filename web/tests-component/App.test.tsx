import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App.js";

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
