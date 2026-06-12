import { defineConfig, devices } from "@playwright/test";

// Runs the production build via `vite preview` and drives it on desktop +
// mobile viewports. Browser binaries must be installed (`npx playwright
// install chromium`) — see docs/KNOWN_GAPS.md for the offline-environment note.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "web-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "web-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
