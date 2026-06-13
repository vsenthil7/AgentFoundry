import { type Page } from "@playwright/test";

// Shared E2E auth helper. The console is gated behind AuthGate (S78), which calls
// the backend /auth/* endpoints. For browser E2E we intercept those routes so the
// suite proves real-browser rendering of the login → authed → console flow without
// needing a live backend (offline-first, matches the demo-offline principle).

const ADMIN_SESSION = {
  token: "e2e-admin-token",
  expiresAt: 4102444800000, // far future
  user: { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"] },
};

const TENANT_USERS = {
  users: [
    ADMIN_SESSION.user,
    { id: "acme:v@acme.com", email: "v@acme.com", tenantId: "acme", roles: ["viewer"] },
  ],
};

function jsonRoute(status: number, body: unknown) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

// Install /auth/* and /admin/* mocks for an admin session.
export async function mockAuthRoutes(page: Page): Promise<void> {
  await page.route("**/auth/login", (route) => route.fulfill(jsonRoute(200, ADMIN_SESSION)));
  await page.route("**/auth/register", (route) => route.fulfill(jsonRoute(201, ADMIN_SESSION)));
  await page.route("**/auth/logout", (route) => route.fulfill(jsonRoute(200, { revoked: true })));
  await page.route("**/auth/me", (route) => route.fulfill(jsonRoute(200, ADMIN_SESSION.user)));
  await page.route("**/admin/users", (route) => route.fulfill(jsonRoute(200, TENANT_USERS)));
  await page.route("**/audit/api", (route) =>
    route.fulfill(
      jsonRoute(200, {
        summary: { total: 2, errors: 0, errorRate: 0, lastSeq: 2 },
        calls: [
          { seq: 1, timestamp: "t", method: "POST", path: "/auth/login", status: 200, latencyMs: 4, actor: "owner@acme.com", tenantId: "acme" },
          { seq: 2, timestamp: "t", method: "GET", path: "/admin/users", status: 200, latencyMs: 2, actor: "owner@acme.com", tenantId: "acme" },
        ],
      }),
    ),
  );
  await page.route("**/breakers", (route) =>
    route.fulfill(jsonRoute(200, { tripped: [], transitions: [] })),
  );
  await page.route("**/runs", (route) =>
    route.fulfill(
      jsonRoute(200, {
        runs: [
          { seq: 1, agentId: "acme-support-bot", version: "1.0.0", timestamp: "t", input: "hours?", output: "9-5", verdict: { safe: true, categories: [] } },
        ],
      }),
    ),
  );
}

// Navigate, mock auth, and log in as admin so the console is rendered.
export async function gotoAuthedConsole(page: Page): Promise<void> {
  await mockAuthRoutes(page);
  await page.goto("/");
  await page.getByTestId("f-email").fill("owner@acme.com");
  await page.getByTestId("f-password").fill("supersecret");
  await page.getByTestId("auth-submit").click();
  await page.getByTestId("authed-shell").waitFor();
}
