import { test, expect, type Page } from "@playwright/test";
import { gotoAuthedConsole } from "./auth-helper.js";

// Functional E2E: the complete Golden Thread, plus negative/refusal paths.
// Runs under both web-desktop and web-mobile projects (see playwright.config).

async function walkToScore(page: Page) {
  await page.getByTestId("btn-evaluate").click();
  await expect(page.getByTestId("grounded-accuracy")).toBeVisible();
  await page.getByTestId("btn-redteam").click();
  await expect(page.getByTestId("attack-atk-injection-ignore")).toBeVisible();
  await page.getByTestId("btn-score").click();
  await expect(page.getByTestId("weighted-score")).toBeVisible();
}

test.describe("AgentFoundry console — Golden Thread", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAuthedConsole(page);
  });

  test("masthead and pipeline render", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "AgentFoundry" })).toBeVisible();
    await expect(page.getByTestId("track-tag")).toHaveText(/AGENT SDLC CONSOLE/);
    await expect(page.getByTestId("lifecycle-state")).toContainText("high risk");
    for (const step of ["compose", "evaluate", "redteam", "score", "approve", "export"]) {
      await expect(page.getByTestId(`step-${step}`)).toBeVisible();
    }
  });

  test("canvas shows a valid graph with all seed nodes", async ({ page }) => {
    await expect(page.getByTestId("graph-valid")).toContainText("VALID");
    await expect(page.getByTestId("node-model-1")).toBeVisible();
    await expect(page.getByTestId("node-grounding-1")).toBeVisible();
    await expect(page.getByTestId("node-guardrail-1")).toBeVisible();
    await expect(page.getByTestId("node-hitl-1")).toBeVisible();
  });

  test("coverage matrix is fully mapped (no unmapped attacks)", async ({ page }) => {
    await expect(page.getByTestId("coverage-matrix")).toContainText("YES");
  });

  test("full walk: evaluate → redteam → score → approve → export green", async ({ page }) => {
    await walkToScore(page);
    await expect(page.getByTestId("weighted-score")).toHaveText(/0\.\d{3}/);

    await page.getByTestId("btn-approve").click();
    await expect(page.getByTestId("approval-result")).toContainText("APPROVED");

    await page.getByTestId("btn-export").click();
    await expect(page.getByTestId("export-result")).toContainText("LOSSLESS");
    await expect(page.getByTestId("export-result")).toContainText("CI ready");

    // S7/S8 registry + regression gate
    await expect(page.getByTestId("registry-state")).toHaveText("deployed");
    await expect(page.getByTestId("lineage-0")).toBeVisible();
    await expect(page.getByTestId("regression-result")).toContainText("CLEAR");

    // S9 certification
    await expect(page.getByTestId("cert-tier")).toBeVisible();
    await expect(page.getByTestId("badge-status-fully_mapped_redteam")).toHaveText(
      "EARNED",
    );

    // S10 marketplace
    await expect(page.getByTestId("pack-id")).toHaveText("pack-acme");
    await expect(page.getByTestId("consumed-score")).toContainText("interoperable");
  });

  test("every fired attack is DEFENDED and shows a framework ID", async ({ page }) => {
    await page.getByTestId("btn-evaluate").click();
    await page.getByTestId("btn-redteam").click();
    for (const id of [
      "atk-injection-ignore",
      "atk-pii-exfil",
      "atk-jailbreak-dan",
      "atk-tool-abuse",
    ]) {
      await expect(page.getByTestId(`attack-status-${id}`)).toHaveText("DEFENDED");
    }
  });

  test("remove-the-source: toggling Foundry IQ off lowers grounded accuracy", async ({ page }) => {
    await page.getByTestId("btn-evaluate").click();
    const onText = await page.getByTestId("grounded-accuracy").textContent();
    const on = parseFloat(onText!.match(/[\d.]+/)![0]);

    await page.getByTestId("btn-toggle-grounding").click();
    await expect(page.getByTestId("btn-toggle-grounding")).toContainText("OFF");
    const offText = await page.getByTestId("grounded-accuracy").textContent();
    const off = parseFloat(offText!.match(/[\d.]+/)![0]);

    expect(off).toBeLessThan(on);
  });

  test("audit log records each action", async ({ page }) => {
    await expect(page.getByTestId("audit-log")).toContainText("no actions yet");
    await page.getByTestId("btn-evaluate").click();
    await expect(page.getByTestId("audit-log")).toContainText("evaluate:");
  });
});

test.describe("Negative / refusal paths", () => {
test.beforeEach(async ({ page }) => {
await gotoAuthedConsole(page);
});

  test("score / approve / export controls are gated until prerequisites met", async ({ page }) => {
    // Before evaluating, redteam/score/approve/export buttons should not exist.
    await expect(page.getByTestId("btn-redteam")).toHaveCount(0);
    await expect(page.getByTestId("btn-score")).toHaveCount(0);
    await expect(page.getByTestId("btn-approve")).toHaveCount(0);
    await expect(page.getByTestId("btn-export")).toHaveCount(0);
  });

  test("rejecting at the human gate blocks export", async ({ page }) => {
    await page.getByTestId("btn-evaluate").click();
    await page.getByTestId("btn-redteam").click();
    await page.getByTestId("btn-score").click();
    await page.getByTestId("btn-reject").click();
    await expect(page.getByTestId("approval-result")).toContainText("REJECTED");
    // Export control must not appear after a rejection.
    await expect(page.getByTestId("btn-export")).toHaveCount(0);
  });
});

test.describe("Mobile-specific layout", () => {
  test("console is usable on a narrow viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "web-mobile", "mobile project only");
    await gotoAuthedConsole(page);
    await expect(page.getByRole("heading", { name: "AgentFoundry" })).toBeVisible();
    // Primary action reachable and tappable on mobile.
    const btn = page.getByTestId("btn-evaluate");
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.getByTestId("grounded-accuracy")).toBeVisible();
  });
});
