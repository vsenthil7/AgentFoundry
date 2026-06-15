import { test, expect, type Page } from "@playwright/test";
import { gotoAuthedConsole } from "./auth-helper.js";

// S129 — Battle Mode Arena E2E (the creative arc in a real browser).
//
// The creative arc (S124–S128) had full jsdom component coverage but no
// Playwright. This drives the full Loadout → Battle Arena → ScoreCard loop
// through the REAL auth gate and the REAL "⚔ Battle Arena" sidebar nav, on both
// the web-desktop and web-mobile projects (see playwright.config).
//
// Everything the arena shows is produced by the deterministic engine running in
// the browser (the web engine mirror) — no network, no mocked verdicts. The seed
// agent (Acme Support Bot) defends all four battery attacks, so the climax is a
// flawless 4/4 defence.

// Navigate from the authed console to the Battle Arena via the real sidebar nav.
async function gotoArena(page: Page): Promise<void> {
  await gotoAuthedConsole(page);
  // The headline nav item is labelled "⚔ Battle Arena" (all roles).
  await page.getByRole("button", { name: /Battle Arena/ }).click();
  await expect(page.getByTestId("loadout-screen")).toBeVisible();
}

test.describe("Battle Mode Arena — creative arc E2E (S129)", () => {
  test("nav → Loadout renders with both defences on and a HARDENED risk read", async ({ page }) => {
    await gotoArena(page);
    // Compose-your-defender: both capabilities default ON.
    await expect(page.getByTestId("loadout-toggle-guardrail")).toHaveText("ON");
    await expect(page.getByTestId("loadout-toggle-grounding")).toHaveText("ON");
    // The honest risk read for a fully-defended loadout.
    await expect(page.getByTestId("loadout-risk")).toHaveText("HARDENED");
    // The arena is not shown until the agent is sent in.
    await expect(page.getByTestId("loadout-arena")).toHaveCount(0);
  });

  test("toggling the guardrail off updates the risk read to EXPOSED live", async ({ page }) => {
    await gotoArena(page);
    await page.getByTestId("loadout-toggle-guardrail").click();
    await expect(page.getByTestId("loadout-toggle-guardrail")).toHaveText("OFF");
    await expect(page.getByTestId("loadout-risk")).toHaveText("EXPOSED");
    // Turning it back on restores HARDENED.
    await page.getByTestId("loadout-toggle-guardrail").click();
    await expect(page.getByTestId("loadout-risk")).toHaveText("HARDENED");
  });

  test("send into the arena → step round-by-round, defend-rate climbs, frameworks + narration show", async ({ page }) => {
    await gotoArena(page);
    await page.getByTestId("loadout-fight").click();
    await expect(page.getByTestId("battle-arena")).toBeVisible();
    await expect(page.getByTestId("arena-agent")).toContainText("Acme Support Bot");

    // Before any attack: awaiting state, 0% defended.
    await expect(page.getByTestId("arena-shield")).toContainText("awaiting");
    await expect(page.getByTestId("arena-defendrate")).toHaveText("0%");

    // Begin the battle → first round revealed, defended (seed agent has a guardrail).
    const next = page.getByTestId("arena-next");
    await expect(next).toHaveText("Begin battle");
    await next.click();
    await expect(page.getByTestId("arena-next")).toHaveText("Next attack");
    await expect(page.getByTestId("arena-verdict-atk-injection-ignore")).toHaveText("DEFENDED");
    // Framework chips + plain-language narration render for the revealed round.
    await expect(page.getByTestId("arena-frameworks-atk-injection-ignore")).toBeVisible();
    await expect(page.getByTestId("arena-intent-atk-injection-ignore")).not.toBeEmpty();
    await expect(page.getByTestId("arena-why-atk-injection-ignore")).toContainText("Why it matters");
    // Defend-rate now reflects one defended round.
    await expect(page.getByTestId("arena-defendrate")).toHaveText("100%");
  });

  test("play to end → flawless climax, 100% defended, all four seed attacks DEFENDED", async ({ page }) => {
    await gotoArena(page);
    await page.getByTestId("loadout-fight").click();
    await page.getByTestId("arena-skip").click();

    // Deterministic climax: the guarded seed agent holds every attack.
    await expect(page.getByTestId("arena-outcome")).toContainText("Flawless defence");
    await expect(page.getByTestId("arena-defendrate")).toHaveText("100%");
    for (const id of [
      "atk-injection-ignore",
      "atk-pii-exfil",
      "atk-jailbreak-dan",
      "atk-tool-abuse",
    ]) {
      await expect(page.getByTestId(`arena-verdict-${id}`)).toHaveText("DEFENDED");
    }
    // Controls disabled once complete.
    await expect(page.getByTestId("arena-next")).toBeDisabled();
    await expect(page.getByTestId("arena-skip")).toBeDisabled();
  });

  test("ScoreCard appears at the climax and its Replay button resets the battle", async ({ page }) => {
    await gotoArena(page);
    await page.getByTestId("loadout-fight").click();
    await page.getByTestId("arena-skip").click();

    // The shareable scorecard summarises the real battle.
    await expect(page.getByTestId("scorecard")).toBeVisible();
    await expect(page.getByTestId("scorecard-headline")).toContainText("Acme Support Bot defended 4/4");
    await expect(page.getByTestId("scorecard-defendrate")).toHaveText("100%");
    // No certification tier is injected from the arena, so the card shows the
    // honest outcome badge (FLAWLESS) rather than an invented grade.
    await expect(page.getByTestId("scorecard-outcome")).toHaveText("FLAWLESS");
    // The frameworks the battle exercised are listed.
    await expect(page.getByTestId("scorecard-frameworks")).toContainText("OWASP");

    // Replay re-runs the same deterministic battle from the start.
    await page.getByTestId("scorecard-replay").click();
    await expect(page.getByTestId("arena-outcome")).toHaveCount(0);
    await expect(page.getByTestId("scorecard")).toHaveCount(0);
    await expect(page.getByTestId("arena-round")).toContainText("0 /");
  });

  test("mobile: the arena and scorecard are usable at a narrow viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "web-mobile", "mobile project only");
    await gotoArena(page);
    // Loadout is reachable and the fight button is tappable on mobile.
    const fight = page.getByTestId("loadout-fight");
    await expect(fight).toBeVisible();
    await fight.click();
    await expect(page.getByTestId("battle-arena")).toBeVisible();
    await page.getByTestId("arena-skip").click();
    await expect(page.getByTestId("scorecard")).toBeVisible();
    await expect(page.getByTestId("scorecard-headline")).toBeVisible();
  });
});
