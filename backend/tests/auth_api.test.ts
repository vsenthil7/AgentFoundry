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

  it("PATCH /auth/profile email-only returns a user without a displayName", async () => {
    const tok = await tokenFrom();
    const res = await ctx.router.handle(
      bearer(tok, { method: "PATCH", path: "/auth/profile", body: { email: "only@acme.com" } }),
    );
    expect(res.status).toBe(200);
    const b = res.body as { email: string; displayName?: string };
    expect(b.email).toBe("only@acme.com");
    expect(b.displayName).toBeUndefined();
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

describe("tenant-admin user management endpoints (S91)", () => {
  const reg = (over: Record<string, unknown> = {}) =>
    req({
      method: "POST",
      path: "/auth/register",
      body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret", ...over },
    });
  const adminToken = async () => ((await ctx.router.handle(reg())).body as { token: string }).token;

  it("admin creates a user (201) and it appears in the list", async () => {
    const tok = await adminToken();
    const res = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users", body: { email: "dev@acme.com", password: "temp12345", roles: ["composer"] } }),
    );
    expect(res.status).toBe(201);
    expect((res.body as { roles: string[] }).roles).toEqual(["composer"]);
    const list = await ctx.router.handle(bearer(tok, { method: "GET", path: "/admin/users" }));
    expect((list.body as { users: unknown[] }).users.length).toBe(2);
  });

  it("non-admin cannot create users (403)", async () => {
    const adminTok = await adminToken();
    await ctx.router.handle(
      bearer(adminTok, { method: "POST", path: "/admin/users", body: { email: "v@acme.com", password: "temp12345", roles: ["viewer"] } }),
    );
    const viewerTok = ((await ctx.router.handle(req({ method: "POST", path: "/auth/login", body: { email: "v@acme.com", password: "temp12345" } }))).body as { token: string }).token;
    const res = await ctx.router.handle(
      bearer(viewerTok, { method: "POST", path: "/admin/users", body: { email: "z@acme.com", password: "temp12345", roles: ["viewer"] } }),
    );
    expect(res.status).toBe(403);
  });

  it("create user validation: missing fields 400, duplicate 409", async () => {
    const tok = await adminToken();
    const missing = await ctx.router.handle(bearer(tok, { method: "POST", path: "/admin/users", body: { email: "x@acme.com" } }));
    expect(missing.status).toBe(400);
    const dup = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users", body: { email: "owner@acme.com", password: "temp12345", roles: ["viewer"] } }),
    );
    expect(dup.status).toBe(409);
    const weak = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users", body: { email: "weak@acme.com", password: "short", roles: ["viewer"] } }),
    );
    expect(weak.status).toBe(400);
  });

  it("PATCH roles updates a user; last-admin guard returns 409", async () => {
    const tok = await adminToken();
    await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users", body: { email: "u@acme.com", password: "temp12345", roles: ["viewer"] } }),
    );
    const ok = await ctx.router.handle(
      bearer(tok, { method: "PATCH", path: "/admin/users/acme:u@acme.com/roles", body: { roles: ["composer"] } }),
    );
    expect(ok.status).toBe(200);
    expect((ok.body as { roles: string[] }).roles).toEqual(["composer"]);
    // Demoting the only admin (owner) is blocked.
    const guard = await ctx.router.handle(
      bearer(tok, { method: "PATCH", path: "/admin/users/acme:owner@acme.com/roles", body: { roles: ["viewer"] } }),
    );
    expect(guard.status).toBe(409);
  });

  it("PATCH roles with empty roles is 400", async () => {
    const tok = await adminToken();
    await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users", body: { email: "u@acme.com", password: "temp12345", roles: ["viewer"] } }),
    );
    const res = await ctx.router.handle(
      bearer(tok, { method: "PATCH", path: "/admin/users/acme:u@acme.com/roles", body: { roles: [] } }),
    );
    expect(res.status).toBe(400);
  });

  it("deactivate + reactivate a user (200 each); last-admin deactivate 409", async () => {
    const tok = await adminToken();
    await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users", body: { email: "u@acme.com", password: "temp12345", roles: ["viewer"] } }),
    );
    const deact = await ctx.router.handle(bearer(tok, { method: "POST", path: "/admin/users/acme:u@acme.com/deactivate" }));
    expect(deact.status).toBe(200);
    expect((deact.body as { active: boolean }).active).toBe(false);
    // S91/S92: a deactivated user is blocked at login with 403.
    const blocked = await ctx.router.handle(req({ method: "POST", path: "/auth/login", body: { email: "u@acme.com", password: "temp12345" } }));
    expect(blocked.status).toBe(403);
    const react = await ctx.router.handle(bearer(tok, { method: "POST", path: "/admin/users/acme:u@acme.com/reactivate" }));
    expect(react.status).toBe(200);
    expect((react.body as { active: boolean }).active).toBe(true);
    const guard = await ctx.router.handle(bearer(tok, { method: "POST", path: "/admin/users/acme:owner@acme.com/deactivate" }));
    expect(guard.status).toBe(409);
  });

  it("reset-password (200) lets the user log in with the new password; missing/weak 400", async () => {
    const tok = await adminToken();
    await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users", body: { email: "u@acme.com", password: "temp12345", roles: ["viewer"] } }),
    );
    const reset = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users/acme:u@acme.com/reset-password", body: { newPassword: "fresh12345" } }),
    );
    expect(reset.status).toBe(200);
    const login = await ctx.router.handle(req({ method: "POST", path: "/auth/login", body: { email: "u@acme.com", password: "fresh12345" } }));
    expect(login.status).toBe(200);
    const missing = await ctx.router.handle(bearer(tok, { method: "POST", path: "/admin/users/acme:u@acme.com/reset-password", body: {} }));
    expect(missing.status).toBe(400);
    const weak = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users/acme:u@acme.com/reset-password", body: { newPassword: "x" } }),
    );
    expect(weak.status).toBe(400);
  });

  it("managing a user in another tenant is 403; unknown user is 404", async () => {
    const tok = await adminToken();
    // Another tenant + user via a separate registration.
    await ctx.router.handle(
      req({ method: "POST", path: "/auth/register", body: { tenantId: "other", tenantName: "Other", email: "x@other.com", password: "password1" } }),
    );
    const cross = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users/other:x@other.com/deactivate" }),
    );
    expect(cross.status).toBe(403);
    const crossRoles = await ctx.router.handle(
      bearer(tok, { method: "PATCH", path: "/admin/users/other:x@other.com/roles", body: { roles: ["viewer"] } }),
    );
    expect(crossRoles.status).toBe(403);
    const crossReset = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users/other:x@other.com/reset-password", body: { newPassword: "temp12345" } }),
    );
    expect(crossReset.status).toBe(403);
    const crossReact = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users/other:x@other.com/reactivate" }),
    );
    expect(crossReact.status).toBe(403);
    const missing = await ctx.router.handle(bearer(tok, { method: "POST", path: "/admin/users/acme:ghost@acme.com/deactivate" }));
    expect(missing.status).toBe(404);
  });

  it("create user without a roles field defaults to viewer", async () => {
    const tok = await adminToken();
    const res = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users", body: { email: "norole@acme.com", password: "temp12345" } }),
    );
    expect(res.status).toBe(201);
    expect((res.body as { roles: string[] }).roles).toEqual(["viewer"]);
  });

  it("create user with an empty roles array defaults to viewer", async () => {
    const tok = await adminToken();
    const res = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users", body: { email: "emptyroles@acme.com", password: "temp12345", roles: [] } }),
    );
    expect(res.status).toBe(201);
    expect((res.body as { roles: string[] }).roles).toEqual(["viewer"]);
  });

  it("create user with a displayName echoes it back", async () => {
    const tok = await adminToken();
    const res = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users", body: { email: "named@acme.com", password: "temp12345", roles: ["viewer"], displayName: "Named User" } }),
    );
    expect(res.status).toBe(201);
    expect((res.body as { displayName?: string }).displayName).toBe("Named User");
  });

  it("admin routes tolerate a null body (no crash, clean 400s)", async () => {
    const tok = await adminToken();
    await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/admin/users", body: { email: "u@acme.com", password: "temp12345", roles: ["viewer"] } }),
    );
    // Each handler reads (req.body ?? {}) — a null body must fall to the default and 400.
    const create = await ctx.router.handle(bearer(tok, { method: "POST", path: "/admin/users", body: null }));
    expect(create.status).toBe(400);
    const roles = await ctx.router.handle(bearer(tok, { method: "PATCH", path: "/admin/users/acme:u@acme.com/roles", body: null }));
    expect(roles.status).toBe(400);
    const reset = await ctx.router.handle(bearer(tok, { method: "POST", path: "/admin/users/acme:u@acme.com/reset-password", body: null }));
    expect(reset.status).toBe(400);
    // S90 profile/password also tolerate null bodies.
    const prof = await ctx.router.handle(bearer(tok, { method: "PATCH", path: "/auth/profile", body: null }));
    expect(prof.status).toBe(400);
    const pw = await ctx.router.handle(bearer(tok, { method: "POST", path: "/auth/password", body: null }));
    expect(pw.status).toBe(400);
  });

  it("admin user-management handlers rethrow unmapped errors as 500", async () => {
    const identity = new IdentityStore();
    identity.createTenant({ id: "acme", name: "Acme" });
    identity.createUser({ id: "acme:admin@acme.com", tenantId: "acme", email: "admin@acme.com", roles: ["admin"] });
    identity.createUser({ id: "acme:u@acme.com", tenantId: "acme", email: "u@acme.com", roles: ["viewer"] });
    const boom = new Error("unexpected");
    const stub = {
      resolve: () => identity.getUser("acme:admin@acme.com"),
      adminCreateUser() {
        throw boom;
      },
      setUserRoles() {
        throw boom;
      },
      deactivateUser() {
        throw boom;
      },
      reactivateUser() {
        throw boom;
      },
      resetUserPassword() {
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
    const create = await router.handle(bearer("x", { method: "POST", path: "/admin/users", body: { email: "a@acme.com", password: "temp12345", roles: ["viewer"] } }));
    expect(create.status).toBe(500);
    const roles = await router.handle(bearer("x", { method: "PATCH", path: "/admin/users/acme:u@acme.com/roles", body: { roles: ["composer"] } }));
    expect(roles.status).toBe(500);
    const deact = await router.handle(bearer("x", { method: "POST", path: "/admin/users/acme:u@acme.com/deactivate" }));
    expect(deact.status).toBe(500);
    const reset = await router.handle(bearer("x", { method: "POST", path: "/admin/users/acme:u@acme.com/reset-password", body: { newPassword: "temp12345" } }));
    expect(reset.status).toBe(500);
  });

  it("create user maps an unknown-tenant AuthNotFoundError to 404", async () => {
    const identity = new IdentityStore();
    identity.createTenant({ id: "acme", name: "Acme" });
    identity.createUser({ id: "acme:admin@acme.com", tenantId: "acme", email: "admin@acme.com", roles: ["admin"] });
    const { AuthNotFoundError } = await import("../src/auth.js");
    const stub = {
      resolve: () => identity.getUser("acme:admin@acme.com"),
      adminCreateUser() {
        throw new AuthNotFoundError("tenant acme");
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
    const res = await router.handle(bearer("x", { method: "POST", path: "/admin/users", body: { email: "a@acme.com", password: "temp12345", roles: ["viewer"] } }));
    expect(res.status).toBe(404);
  });

  it("admin user-management endpoints are 404 when no AuthService is configured", async () => {
    const identity = new IdentityStore();
    identity.createTenant({ id: "t", name: "T" });
    identity.createUser({ id: "u", tenantId: "t", email: "u@t.com", roles: ["admin"] });
    identity.createUser({ id: "u2", tenantId: "t", email: "u2@t.com", roles: ["viewer"] });
    const router = buildApi({
      identity,
      registry: new GovernedRegistry(),
      reviews: new ReviewQueue(new InMemoryChannel()),
      events: new EventBus({ transport: okTransport }),
      tokens: new Map<string, string>([["tok", "u"]]),
    });
    const create = await router.handle(bearer("tok", { method: "POST", path: "/admin/users", body: { email: "a@t.com", password: "temp12345", roles: ["viewer"] } }));
    expect(create.status).toBe(404);
    const roles = await router.handle(bearer("tok", { method: "PATCH", path: "/admin/users/u2/roles", body: { roles: ["composer"] } }));
    expect(roles.status).toBe(404);
    const deact = await router.handle(bearer("tok", { method: "POST", path: "/admin/users/u2/deactivate" }));
    expect(deact.status).toBe(404);
    const react = await router.handle(bearer("tok", { method: "POST", path: "/admin/users/u2/reactivate" }));
    expect(react.status).toBe(404);
    const reset = await router.handle(bearer("tok", { method: "POST", path: "/admin/users/u2/reset-password", body: { newPassword: "temp12345" } }));
    expect(reset.status).toBe(404);
  });
});

describe("superadmin platform console endpoints (S92)", () => {
  // Provision a superadmin and log in to get a platform-scoped token.
  const superToken = async () => {
    ctx.auth.provisionSuperadmin("root@platform.io", "superpw12345");
    return ((await ctx.router.handle(req({ method: "POST", path: "/auth/login", body: { email: "root@platform.io", password: "superpw12345" } }))).body as { token: string }).token;
  };
  // A normal tenant admin token.
  const adminToken = async () =>
    ((await ctx.router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;

  it("superadmin lists all tenants with counts + status", async () => {
    await adminToken(); // creates the acme tenant
    const tok = await superToken();
    const res = await ctx.router.handle(bearer(tok, { method: "GET", path: "/platform/tenants" }));
    expect(res.status).toBe(200);
    const tenants = (res.body as { tenants: Array<{ id: string; status: string; userCount: number }> }).tenants;
    const acme = tenants.find((t) => t.id === "acme")!;
    expect(acme.status).toBe("active");
    expect(acme.userCount).toBe(1);
  });

  it("a normal admin is forbidden from the platform console (403)", async () => {
    const tok = await adminToken();
    const res = await ctx.router.handle(bearer(tok, { method: "GET", path: "/platform/tenants" }));
    expect(res.status).toBe(403);
  });

  it("superadmin reads any tenant's users; unknown tenant is 404", async () => {
    await adminToken();
    const tok = await superToken();
    const ok = await ctx.router.handle(bearer(tok, { method: "GET", path: "/platform/tenants/acme/users" }));
    expect(ok.status).toBe(200);
    expect((ok.body as { users: unknown[] }).users.length).toBe(1);
    const missing = await ctx.router.handle(bearer(tok, { method: "GET", path: "/platform/tenants/ghost/users" }));
    expect(missing.status).toBe(404);
  });

  it("superadmin provisions a new tenant (201); duplicate is 409; missing fields 400", async () => {
    const tok = await superToken();
    const created = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/platform/tenants", body: { tenantId: "globex", tenantName: "Globex", adminEmail: "a@globex.com", adminPassword: "password1" } }),
    );
    expect(created.status).toBe(201);
    expect((created.body as { admin: { roles: string[] } }).admin.roles).toEqual(["admin"]);
    const dup = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/platform/tenants", body: { tenantId: "globex", tenantName: "Globex2", adminEmail: "b@globex.com", adminPassword: "password1" } }),
    );
    expect(dup.status).toBe(409);
    const missing = await ctx.router.handle(bearer(tok, { method: "POST", path: "/platform/tenants", body: { tenantId: "x" } }));
    expect(missing.status).toBe(400);
  });

  it("superadmin provision-tenant maps a weak admin password to 400", async () => {
    const tok = await superToken();
    const res = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/platform/tenants", body: { tenantId: "weakco", tenantName: "WeakCo", adminEmail: "a@weakco.com", adminPassword: "short" } }),
    );
    expect(res.status).toBe(400);
  });

  it("superadmin provision-tenant maps an already-used admin email to 409", async () => {
    await adminToken(); // registers owner@acme.com in tenant acme
    const tok = await superToken();
    const res = await ctx.router.handle(
      bearer(tok, { method: "POST", path: "/platform/tenants", body: { tenantId: "newco", tenantName: "NewCo", adminEmail: "owner@acme.com", adminPassword: "password1" } }),
    );
    expect(res.status).toBe(409);
  });

  it("superadmin provision-tenant tolerates a null body (400)", async () => {
    const tok = await superToken();
    const res = await ctx.router.handle(bearer(tok, { method: "POST", path: "/platform/tenants", body: null }));
    expect(res.status).toBe(400);
  });

  it("platform provision-tenant rethrows an unmapped error as 500", async () => {
    const identity = new IdentityStore();
    identity.createTenant({ id: "platform", name: "Platform" });
    identity.createUser({ id: "platform:su", tenantId: "platform", email: "su@platform.io", roles: ["superadmin"] });
    const boom = new Error("unexpected");
    const stub = {
      resolve: () => identity.getUser("platform:su"),
      provisionTenant() {
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
    const res = await router.handle(
      bearer("x", { method: "POST", path: "/platform/tenants", body: { tenantId: "n", tenantName: "N", adminEmail: "a@n.com", adminPassword: "password1" } }),
    );
    expect(res.status).toBe(500);
  });

  it("superadmin suspends + reactivates a tenant; unknown tenant 404", async () => {
    await adminToken();
    const tok = await superToken();
    const susp = await ctx.router.handle(bearer(tok, { method: "POST", path: "/platform/tenants/acme/suspend" }));
    expect(susp.status).toBe(200);
    expect((susp.body as { status: string }).status).toBe("suspended");
    // Suspended tenant's admin can no longer log in.
    const blocked = await ctx.router.handle(req({ method: "POST", path: "/auth/login", body: { email: "owner@acme.com", password: "supersecret" } }));
    expect(blocked.status).toBe(403);
    const act = await ctx.router.handle(bearer(tok, { method: "POST", path: "/platform/tenants/acme/activate" }));
    expect(act.status).toBe(200);
    expect((act.body as { status: string }).status).toBe("active");
    const susMissing = await ctx.router.handle(bearer(tok, { method: "POST", path: "/platform/tenants/ghost/suspend" }));
    expect(susMissing.status).toBe(404);
    const actMissing = await ctx.router.handle(bearer(tok, { method: "POST", path: "/platform/tenants/ghost/activate" }));
    expect(actMissing.status).toBe(404);
  });

  it("platform endpoints are 404 when no AuthService is configured", async () => {
    const identity = new IdentityStore();
    identity.createTenant({ id: "t", name: "T" });
    identity.createUser({ id: "su", tenantId: "t", email: "su@t.com", roles: ["superadmin"] });
    const router = buildApi({
      identity,
      registry: new GovernedRegistry(),
      reviews: new ReviewQueue(new InMemoryChannel()),
      events: new EventBus({ transport: okTransport }),
      tokens: new Map<string, string>([["sutok", "su"]]),
    });
    // GET tenants works (no auth needed for read), but the mutating routes 404.
    const list = await router.handle(bearer("sutok", { method: "GET", path: "/platform/tenants" }));
    expect(list.status).toBe(200);
    const create = await router.handle(bearer("sutok", { method: "POST", path: "/platform/tenants", body: { tenantId: "n", tenantName: "N", adminEmail: "a@n.com", adminPassword: "password1" } }));
    expect(create.status).toBe(404);
    const susp = await router.handle(bearer("sutok", { method: "POST", path: "/platform/tenants/t/suspend" }));
    expect(susp.status).toBe(404);
    const act = await router.handle(bearer("sutok", { method: "POST", path: "/platform/tenants/t/activate" }));
    expect(act.status).toBe(404);
  });
});
