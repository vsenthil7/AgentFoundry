import { describe, it, expect, beforeEach } from "vitest";
import { buildApi, type ApiDeps } from "../src/api_server.js";
import { GovernedRegistry } from "../src/governed_registry.js";
import { IdentityStore } from "../src/identity.js";
import { ReviewQueue, InMemoryChannel } from "../src/notifications.js";
import { EventBus, type WebhookTransport } from "../src/events.js";
import { AuthService } from "../src/auth.js";
import type { ApiRequest } from "../src/api.js";

const okTransport: WebhookTransport = { post: async () => true };

function setup() {
  const identity = new IdentityStore();
  const auth = new AuthService(identity);
  const deps: ApiDeps = {
    identity,
    registry: new GovernedRegistry(),
    reviews: new ReviewQueue(new InMemoryChannel()),
    events: new EventBus({ transport: okTransport }),
    auth,
    tokens: new Map<string, string>(),
  };
  return { deps, router: buildApi(deps), auth };
}

function req(over: Partial<ApiRequest>): ApiRequest {
  return {
    method: "GET",
    path: "/",
    headers: {},
    query: {},
    params: {},
    body: null,
    ...over,
  };
}

function bearer(token: string, over: Partial<ApiRequest>): ApiRequest {
  return req({ ...over, headers: { authorization: `Bearer ${token}` } });
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => (ctx = setup()));

describe("auth endpoints (S78)", () => {
  const reg = (over: Record<string, unknown> = {}) =>
    req({
      method: "POST",
      path: "/auth/register",
      body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret", ...over },
    });

  it("registers the first user as admin and returns a session token (201)", async () => {
    const res = await ctx.router.handle(reg());
    expect(res.status).toBe(201);
    const b = res.body as { token: string; user: { roles: string[]; email: string } };
    expect(b.token).toHaveLength(64);
    expect(b.user.roles).toEqual(["admin"]);
    expect(b.user.email).toBe("owner@acme.com");
  });

  it("rejects registration missing fields (400)", async () => {
    const res = await ctx.router.handle(
      req({ method: "POST", path: "/auth/register", body: { email: "x@acme.com" } }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects register/login with a null body (400, not a crash)", async () => {
    const r = await ctx.router.handle(req({ method: "POST", path: "/auth/register", body: null }));
    expect(r.status).toBe(400);
    const l = await ctx.router.handle(req({ method: "POST", path: "/auth/login", body: null }));
    expect(l.status).toBe(400);
  });

  it("rejects a weak password (400)", async () => {
    const res = await ctx.router.handle(reg({ password: "short" }));
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate email (409)", async () => {
    await ctx.router.handle(reg());
    const res = await ctx.router.handle(reg());
    expect(res.status).toBe(409);
  });

  it("logs in with correct credentials (200) and rejects wrong password (401)", async () => {
    await ctx.router.handle(reg());
    const ok = await ctx.router.handle(
      req({ method: "POST", path: "/auth/login", body: { email: "owner@acme.com", password: "supersecret" } }),
    );
    expect(ok.status).toBe(200);
    const bad = await ctx.router.handle(
      req({ method: "POST", path: "/auth/login", body: { email: "owner@acme.com", password: "nope12345" } }),
    );
    expect(bad.status).toBe(401);
  });

  it("rejects login missing fields (400)", async () => {
    const res = await ctx.router.handle(req({ method: "POST", path: "/auth/login", body: {} }));
    expect(res.status).toBe(400);
  });

  it("a session token authenticates protected routes; /auth/me returns the user", async () => {
    const r = (await ctx.router.handle(reg())).body as { token: string };
    const me = await ctx.router.handle(bearer(r.token, { method: "GET", path: "/auth/me" }));
    expect(me.status).toBe(200);
    expect((me.body as { email: string }).email).toBe("owner@acme.com");
  });

  it("protected route without a token is 401", async () => {
    const res = await ctx.router.handle(req({ method: "GET", path: "/auth/me" }));
    expect(res.status).toBe(401);
  });

  it("logout revokes the session so the token no longer authenticates", async () => {
    const r = (await ctx.router.handle(reg())).body as { token: string };
    const out = await ctx.router.handle(bearer(r.token, { method: "POST", path: "/auth/logout" }));
    expect(out.status).toBe(200);
    expect((out.body as { revoked: boolean }).revoked).toBe(true);
    const me = await ctx.router.handle(bearer(r.token, { method: "GET", path: "/auth/me" }));
    expect(me.status).toBe(401);
  });

  it("admin can list tenant users; viewer is forbidden (403)", async () => {
    const adminTok = ((await ctx.router.handle(reg())).body as { token: string }).token;
    // Second user in same tenant -> viewer by default.
    const viewerTok = (
      (await ctx.router.handle(reg({ email: "v@acme.com" }))).body as { token: string }
    ).token;

    const asAdmin = await ctx.router.handle(bearer(adminTok, { method: "GET", path: "/admin/users" }));
    expect(asAdmin.status).toBe(200);
    expect((asAdmin.body as { users: unknown[] }).users.length).toBe(2);

    const asViewer = await ctx.router.handle(bearer(viewerTok, { method: "GET", path: "/admin/users" }));
    expect(asViewer.status).toBe(403);
  });

  it("returns 404 for auth endpoints when no AuthService is configured", async () => {
    const identity = new IdentityStore();
    const deps: ApiDeps = {
      identity,
      registry: new GovernedRegistry(),
      reviews: new ReviewQueue(new InMemoryChannel()),
      events: new EventBus({ transport: okTransport }),
      tokens: new Map<string, string>(),
    };
    const router = buildApi(deps);
    const res = await router.handle(reg());
    expect(res.status).toBe(404);
    const login = await router.handle(req({ method: "POST", path: "/auth/login", body: { email: "a@b.com", password: "password1" } }));
    expect(login.status).toBe(404);
    const logout = await router.handle(req({ method: "POST", path: "/auth/logout" }));
    expect(logout.status).toBe(404);
  });

  it("static token map still works alongside the AuthService (mixed mode)", async () => {
    ctx.deps.identity.createTenant({ id: "legacy", name: "Legacy" });
    ctx.deps.identity.createUser({ id: "legacy-admin", tenantId: "legacy", email: "la@legacy.com", roles: ["admin"] });
    ctx.deps.tokens.set("legacy-token", "legacy-admin");
    const me = await ctx.router.handle(bearer("legacy-token", { method: "GET", path: "/auth/me" }));
    expect(me.status).toBe(200);
    expect((me.body as { id: string }).id).toBe("legacy-admin");
  });

  it("logout with no/invalid token is a clean 200 revoked:false", async () => {
    const out = await ctx.router.handle(req({ method: "POST", path: "/auth/logout" }));
    expect(out.status).toBe(200);
    expect((out.body as { revoked: boolean }).revoked).toBe(false);
  });

  it("an unexpected error from register/login bubbles up as 500 (not swallowed)", async () => {
    // Stub AuthService whose register/login throw a generic (unmapped) error.
    const boom = new Error("unexpected");
    const stub = {
      register() {
        throw boom;
      },
      login() {
        throw boom;
      },
      logout: () => false,
      resolve() {
        throw boom;
      },
    } as unknown as AuthService;
    const identity = new IdentityStore();
    const router = buildApi({
      identity,
      registry: new GovernedRegistry(),
      reviews: new ReviewQueue(new InMemoryChannel()),
      events: new EventBus({ transport: okTransport }),
      auth: stub,
      tokens: new Map<string, string>(),
    });
    const regRes = await router.handle(reg());
    expect(regRes.status).toBe(500);
    const loginRes = await router.handle(
      req({ method: "POST", path: "/auth/login", body: { email: "owner@acme.com", password: "supersecret" } }),
    );
    expect(loginRes.status).toBe(500);
  });
});

describe("profile + password endpoints (S90)", () => {
  const reg = (over: Record<string, unknown> = {}) =>
    req({
      method: "POST",
      path: "/auth/register",
      body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret", ...over },
    });
  const tokenFrom = async (over: Record<string, unknown> = {}) =>
    ((await ctx.router.handle(reg(over))).body as { token: string }).token;

  it("PATCH /auth/profile updates display name and email", async () => {
    const tok = await tokenFrom();
    const res = await ctx.router.handle(
      bearer(tok, { method: "PATCH", path: "/auth/profile", body: { displayName: "Ada", email: "ada@acme.com" } }),
    );
    expect(res.status).toBe(200);
    const b = res.body as { displayName: string; email: string };
    expect(b.displayName).toBe("Ada");
    expect(b.email).toBe("ada@acme.com");
    // /auth/me reflects it
    const me = await ctx.router.handle(bearer(tok, { method: "GET", path: "/auth/me" }));
    expect((me.body as { displayName: string }).displayName).toBe("Ada");
  });

  it("PATCH /auth/profile with no fields is 400", async () => {
    const tok = await tokenFrom();
    const res = await ctx.router.handle(bearer(tok, { method: "PATCH", path: "/auth/profile", body: {} }));
    expect(res.status).toBe(400);
  });

  it("PATCH /auth/profile with a colliding email is 409", async () => {
    const adminTok = await tokenFrom();
    await tokenFrom({ email: "other@acme.com" }); // a second user
    const res = await ctx.router.handle(
      bearer(adminTok, { method: "PATCH", path: "/auth/profile", body: { email: "other@acme.com" } }),
    );
    expect(res.status).toBe(409);
  });

  it("PATCH /auth/profile with an invalid email is 400", async () => {
    const tok = await tokenFrom();
    const res = await ctx.router.handle(
      bearer(tok, { method: "PATCH", path: "/auth/profile", body: { email: "nope" } }),
    );
    expect(res.status).toBe(400);
  });

  it("PATCH /auth/profile without auth is 401", async () => {
    const res = await ctx.router.handle(req({ method: "PATCH", path: "/auth/profile", body: { displayName: "x" } }));
    expect(res.status).toBe(401);
  });

  it("POST /auth/password changes the password (200) and the old one stops working", async () => {
    const tok = await tokenFrom();
    const res = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/auth/password", body: { currentPassword: "supersecret", newPassword: "brandnew123" } }),
    );
    expect(res.status).toBe(200);
    expect((res.body as { changed: boolean }).changed).toBe(true);
    const bad = await ctx.router.handle(
      req({ method: "POST", path: "/auth/login", body: { email: "owner@acme.com", password: "supersecret" } }),
    );
    expect(bad.status).toBe(401);
    const good = await ctx.router.handle(
      req({ method: "POST", path: "/auth/login", body: { email: "owner@acme.com", password: "brandnew123" } }),
    );
    expect(good.status).toBe(200);
  });

  it("POST /auth/password with wrong current password is 401", async () => {
    const tok = await tokenFrom();
    const res = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/auth/password", body: { currentPassword: "wrong", newPassword: "brandnew123" } }),
    );
    expect(res.status).toBe(401);
  });

  it("POST /auth/password with a weak new password is 400", async () => {
    const tok = await tokenFrom();
    const res = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/auth/password", body: { currentPassword: "supersecret", newPassword: "x" } }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /auth/password missing fields is 400", async () => {
    const tok = await tokenFrom();
    const res = await ctx.router.handle(bearer(tok, { method: "POST", path: "/auth/password", body: {} }));
    expect(res.status).toBe(400);
  });

  it("profile/password endpoints are 404 when no AuthService is configured", async () => {
    const identity = new IdentityStore();
    identity.createTenant({ id: "t", name: "T" });
    identity.createUser({ id: "u", tenantId: "t", email: "u@t.com", roles: ["admin"] });
    const tokens = new Map<string, string>([["tok", "u"]]);
    const router = buildApi({
      identity,
      registry: new GovernedRegistry(),
      reviews: new ReviewQueue(new InMemoryChannel()),
      events: new EventBus({ transport: okTransport }),
      tokens,
    });
    const prof = await router.handle(bearer("tok", { method: "PATCH", path: "/auth/profile", body: { displayName: "x" } }));
    expect(prof.status).toBe(404);
    const pw = await router.handle(
      bearer("tok", { method: "POST", path: "/auth/password", body: { currentPassword: "a", newPassword: "brandnew123" } }),
    );
    expect(pw.status).toBe(404);
  });

  it("/admin/users marks a deactivated user active:false", async () => {
    const adminTok = await tokenFrom();
    await tokenFrom({ email: "v@acme.com" }); // viewer
    ctx.deps.identity.updateUser("acme:v@acme.com", { active: false });
    const res = await ctx.router.handle(bearer(adminTok, { method: "GET", path: "/admin/users" }));
    const users = (res.body as { users: Array<{ email: string; active: boolean }> }).users;
    expect(users.find((u) => u.email === "v@acme.com")!.active).toBe(false);
    expect(users.find((u) => u.email === "owner@acme.com")!.active).toBe(true);
  });

  it("profile/password handlers rethrow unmapped errors as 500", async () => {
    const identity = new IdentityStore();
    identity.createTenant({ id: "acme", name: "Acme" });
    identity.createUser({ id: "acme:u@acme.com", tenantId: "acme", email: "u@acme.com", roles: ["admin"] });
    const boom = new Error("unexpected");
    const stub = {
      resolve: () => identity.getUser("acme:u@acme.com"),
      updateProfile() {
        throw boom;
      },
      changePassword() {
        throw boom;
      },
    } as unknown as AuthService;
    const router = buildApi({
      identity,
      registry: new GovernedRegistry(),
      reviews: new ReviewQueue(new InMemoryChannel()),
      events: new EventBus({ transport: okTransport }),
      auth: stub,
      tokens: new Map<string, string>(),
    });
    const prof = await router.handle(bearer("any", { method: "PATCH", path: "/auth/profile", body: { displayName: "x" } }));
    expect(prof.status).toBe(500);
    const pw = await router.handle(
      bearer("any", { method: "POST", path: "/auth/password", body: { currentPassword: "a", newPassword: "brandnew123" } }),
    );
    expect(pw.status).toBe(500);
  });
});
