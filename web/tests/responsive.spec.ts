import { test, expect } from "@playwright/test";
import { gotoAuthedConsole, mockAuthRoutes } from "./auth-helper.js";

// S103 — responsive / mobile polish. This spec runs on BOTH configured projects
// (web-desktop @1280 and web-mobile @Pixel 7 ≈ 412px) so the same assertions
// prove the layout reflows cleanly across viewports. A few assertions are
// viewport-aware: tap-target sizing only applies on the coarse-pointer (mobile)
// project, where the (pointer: coarse) media query is active.

test.describe("responsive layout", () => {
  test("the auth card fits the viewport without horizontal overflow", async ({ page }) => {
    await mockAuthRoutes(page);
    await page.goto("/");
    await expect(page.getByTestId("auth-screen")).toBeVisible();

    // No horizontal scroll: the document is not wider than the window.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1); // allow sub-pixel rounding

    // The auth card stays within the viewport width.
    const card = page.locator(".af-auth__card");
    const box = await card.boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.width).toBeLessThanOrEqual(vw);
  });

  test("the console renders and does not overflow horizontally after login", async ({ page }) => {
    await gotoAuthedConsole(page);
    await expect(page.getByTestId("pipeline")).toBeVisible();
    await expect(page.getByTestId("canvas-panel")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("primary action buttons meet the 44px tap-target minimum on touch viewports", async ({ page }, testInfo) => {
    await gotoAuthedConsole(page);
    const evalBtn = page.getByTestId("btn-evaluate");
    await expect(evalBtn).toBeVisible();
    const box = await evalBtn.boundingBox();

    if (testInfo.project.name === "web-mobile") {
      // (pointer: coarse) enlarges interactive controls to >=44px.
      expect(box!.height).toBeGreaterThanOrEqual(44);
    } else {
      // Desktop keeps the compact density.
      expect(box!.height).toBeGreaterThan(0);
    }
  });

  test("the console card grid is single-column on a narrow viewport", async ({ page }, testInfo) => {
    await gotoAuthedConsole(page);
    const grid = page.locator(".af-console__grid");
    await expect(grid).toBeVisible();
    const cols = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    const trackCount = cols.split(" ").filter(Boolean).length;

    if (testInfo.project.name === "web-mobile") {
      expect(trackCount).toBe(1); // stacked
    } else {
      expect(trackCount).toBe(2); // two-up on desktop
    }
  });
});
