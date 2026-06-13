import { test, expect } from "@playwright/test";
import { mockAuthRoutes } from "./auth-helper.js";

// E2E for the S78 auth shell: login, registration, admin panel, logout —
// driven in a real browser on desktop + mobile, with /auth/* routes mocked.

test.describe("AgentFoundry auth shell (S78)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthRoutes(page);
  });

  test("shows the login screen first (console is gated)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("auth-screen")).toBeVisible();
    await expect(page.getByTestId("auth-submit")).toHaveText("Sign in");
    // Console must NOT be visible before auth.
    await expect(page.getByTestId("authed-shell")).toHaveCount(0);
  });

  test("login renders the console, session bar and (admin) user panel", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("f-email").fill("owner@acme.com");
    await page.getByTestId("f-password").fill("supersecret");
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("authed-shell")).toBeVisible();
    await expect(page.getByTestId("session-bar")).toContainText("owner@acme.com");
    await expect(page.getByTestId("admin-panel")).toBeVisible();
    // Admin panel lists the tenant users with their roles.
    await expect(page.getByTestId("admin-panel")).toContainText("viewer");
    // The gated console is now rendered.
    await expect(page.getByRole("heading", { name: "AgentFoundry" })).toBeVisible();
  });

  test("registration flow exposes tenant fields and creates a session", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("auth-toggle").click();
    await expect(page.getByTestId("f-tenantId")).toBeVisible();
    await page.getByTestId("f-tenantId").fill("acme");
    await page.getByTestId("f-tenantName").fill("Acme");
    await page.getByTestId("f-email").fill("owner@acme.com");
    await page.getByTestId("f-password").fill("supersecret");
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("authed-shell")).toBeVisible();
  });

  test("logout returns to the login screen", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("f-email").fill("owner@acme.com");
    await page.getByTestId("f-password").fill("supersecret");
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("authed-shell")).toBeVisible();
    await page.getByTestId("logout-btn").click();
    await expect(page.getByTestId("auth-screen")).toBeVisible();
  });

  test("negative: bad credentials show an error and keep the console hidden", async ({ page }) => {
    // Override the login route to fail for this test.
    await page.route("**/auth/login", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Invalid email or password." }) }),
    );
    await page.goto("/");
    await page.getByTestId("f-email").fill("owner@acme.com");
    await page.getByTestId("f-password").fill("wrongpass");
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("auth-error")).toContainText("Invalid email or password.");
    await expect(page.getByTestId("authed-shell")).toHaveCount(0);
  });
});
