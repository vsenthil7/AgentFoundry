import { describe, it, expect } from "vitest";
import { AuthClient, AuthApiError } from "../src/auth/authClient.js";

// A fake fetch that returns canned responses keyed by path.
function fakeFetch(
  routes: Record<string, { status: number; body: unknown }>,
): (input: string, init?: RequestInit) => Promise<Response> {
  return async (input: string) => {
    const path = input.replace(/^https?:\/\/[^/]+/, "").replace(/^[^/]*/, (m) => (m.startsWith("/") ? m : ""));
    const key = Object.keys(routes).find((k) => input.endsWith(k)) ?? input;
    const r = routes[key];
    if (!r) return new Response("", { status: 404 });
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  };
}

const session = {
  token: "abc",
  expiresAt: 1,
  user: { id: "acme:u", email: "u@acme.com", tenantId: "acme", roles: ["admin"] },
};

describe("AuthClient (S78)", () => {
  it("register returns the session on 201", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/register": { status: 201, body: session } }));
    const s = await c.register({ tenantId: "acme", tenantName: "Acme", email: "u@acme.com", password: "password1" });
    expect(s.token).toBe("abc");
    expect(s.user.roles).toEqual(["admin"]);
  });

  it("login returns the session on 200", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/login": { status: 200, body: session } }));
    const s = await c.login({ email: "u@acme.com", password: "password1" });
    expect(s.user.email).toBe("u@acme.com");
  });

  it("throws AuthApiError carrying the server error message and status", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/login": { status: 401, body: { error: "Invalid email or password." } } }));
    await expect(c.login({ email: "u@acme.com", password: "x" })).rejects.toMatchObject({
      name: "AuthApiError",
      status: 401,
      message: "Invalid email or password.",
    });
  });

  it("throws a generic AuthApiError when the error body has no message", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/login": { status: 500, body: {} } }));
    await expect(c.login({ email: "u@acme.com", password: "x" })).rejects.toBeInstanceOf(AuthApiError);
  });

  it("me returns the current user", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/me": { status: 200, body: session.user } }));
    const u = await c.me("abc");
    expect(u.email).toBe("u@acme.com");
  });

  it("listUsers returns tenant users", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users": { status: 200, body: { users: [session.user] } } }));
    const r = await c.listUsers("abc");
    expect(r.users.length).toBe(1);
  });

  it("logout posts to the logout endpoint without throwing", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/logout": { status: 200, body: { revoked: true } } }));
    await expect(c.logout("abc")).resolves.toBeUndefined();
  });

  it("handles an empty response body (no JSON)", async () => {
    const emptyFetch = async () => new Response("", { status: 200 });
    const c = new AuthClient("", emptyFetch);
    await expect(c.logout("abc")).resolves.toBeUndefined();
  });

  it("getAuditTrail returns the audit summary + calls", async () => {
    const trail = { summary: { total: 1, errors: 0, errorRate: 0, lastSeq: 1 }, calls: [] };
    const c = new AuthClient("", fakeFetch({ "/audit/api": { status: 200, body: trail } }));
    const r = await c.getAuditTrail("abc");
    expect(r.summary.total).toBe(1);
  });

  it("getBreakers returns tripped agents + transitions", async () => {
    const view = { tripped: ["a"], transitions: [] };
    const c = new AuthClient("", fakeFetch({ "/breakers": { status: 200, body: view } }));
    const r = await c.getBreakers("abc");
    expect(r.tripped).toEqual(["a"]);
  });

  it("resetBreaker posts to the agent reset endpoint", async () => {
    const c = new AuthClient("", fakeFetch({ "/reset": { status: 200, body: { to: "closed" } } }));
    await expect(c.resetBreaker("abc", "agent-x")).resolves.toBeTruthy();
  });

  it("getRuns returns recorded invocations", async () => {
    const c = new AuthClient("", fakeFetch({ "/runs": { status: 200, body: { runs: [{ seq: 1 }] } } }));
    const r = await c.getRuns("abc");
    expect(r.runs.length).toBe(1);
  });

  it("replayRun posts to the run replay endpoint", async () => {
    const c = new AuthClient("", fakeFetch({ "/replay": { status: 200, body: { seq: 2, reproduced: true } } }));
    const r = await c.replayRun("abc", 2);
    expect(r.reproduced).toBe(true);
  });

  it("uses the global fetch by default when no fetchImpl is injected", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(session), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      const c = new AuthClient(); // default baseUrl + default fetchImpl
      const s = await c.login({ email: "u@acme.com", password: "password1" });
      expect(s.token).toBe("abc");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("updateProfile PATCHes the profile and returns the updated user (S96)", async () => {
    const updated = { ...session.user, displayName: "Owner One", email: "new@acme.com" };
    const c = new AuthClient("", fakeFetch({ "/auth/profile": { status: 200, body: updated } }));
    const u = await c.updateProfile("abc", { displayName: "Owner One", email: "new@acme.com" });
    expect(u.displayName).toBe("Owner One");
    expect(u.email).toBe("new@acme.com");
  });

  it("changePassword POSTs and returns the change result (S96)", async () => {
    const c = new AuthClient("", fakeFetch({ "/auth/password": { status: 200, body: { changed: true, otherSessionsRevoked: 2 } } }));
    const r = await c.changePassword("abc", "old12345", "new12345");
    expect(r.changed).toBe(true);
    expect(r.otherSessionsRevoked).toBe(2);
  });

  // ---- S97: tenant-admin user management ----
  const adminUser = { id: "acme:u", email: "u@acme.com", tenantId: "acme", roles: ["viewer"], active: true };

  it("listAdminUsers returns users with the active flag (S97)", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users": { status: 200, body: { users: [adminUser] } } }));
    const r = await c.listAdminUsers("abc");
    expect(r.users[0].active).toBe(true);
  });

  it("adminCreateUser POSTs and returns the created user (S97)", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users": { status: 201, body: adminUser } }));
    const u = await c.adminCreateUser("abc", { email: "u@acme.com", password: "temp12345", roles: ["viewer"] });
    expect(u.email).toBe("u@acme.com");
  });

  it("setUserRoles PATCHes the role set (S97)", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users/acme%3Au/roles": { status: 200, body: { ...adminUser, roles: ["composer"] } } }));
    const u = await c.setUserRoles("abc", "acme:u", ["composer"]);
    expect(u.roles).toEqual(["composer"]);
  });

  it("deactivateUser POSTs and returns the user (S97)", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users/acme%3Au/deactivate": { status: 200, body: { ...adminUser, active: false } } }));
    const u = await c.deactivateUser("abc", "acme:u");
    expect(u.active).toBe(false);
  });

  it("reactivateUser POSTs and returns the user (S97)", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users/acme%3Au/reactivate": { status: 200, body: adminUser } }));
    const u = await c.reactivateUser("abc", "acme:u");
    expect(u.active).toBe(true);
  });

  it("resetUserPassword POSTs and returns reset:true (S97)", async () => {
    const c = new AuthClient("", fakeFetch({ "/admin/users/acme%3Au/reset-password": { status: 200, body: { reset: true } } }));
    const r = await c.resetUserPassword("abc", "acme:u", "temp12345");
    expect(r.reset).toBe(true);
  });
});
