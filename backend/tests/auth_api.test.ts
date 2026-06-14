import { describe, it, expect, beforeEach } from "vitest";
import { buildApi, type ApiDeps } from "../src/api_server.js";
import { GovernedRegistry } from "../src/governed_registry.js";
import { IdentityStore } from "../src/identity.js";
import { ReviewQueue, InMemoryChannel } from "../src/notifications.js";
import { EventBus, type WebhookTransport } from "../src/events.js";
import { AuthService } from "../src/auth.js";
import { SecretsVault } from "../src/secrets.js";
import { BillingEngine } from "../src/billing.js";
import { InvoiceStore } from "../src/invoice_store.js";
import { SlaTracker } from "../src/sla.js";
import { DataGovernance } from "../src/data_governance.js";
import { Marketplace } from "../src/marketplace.js";
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

describe("human-in-the-loop reviewer queue endpoints (S93)", () => {
  // Register an admin (owner) and create a reviewer in the same tenant.
  const setupReviewer = async () => {
    const ownerTok = ((await ctx.router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;
    await ctx.router.handle(bearer(ownerTok, { method: "POST", path: "/admin/users", body: { email: "rev@acme.com", password: "reviewer123", roles: ["reviewer"] } }));
    const revTok = ((await ctx.router.handle(req({ method: "POST", path: "/auth/login", body: { email: "rev@acme.com", password: "reviewer123" } }))).body as { token: string }).token;
    return { ownerTok, revTok };
  };
  // Seed a pending review item for a tenant directly via the queue.
  const seedReview = (tenantId: string, agentId = "agent-1") =>
    ctx.deps.reviews.submit({ agentId, tenantId, requestedBy: "composer@acme.com", weightedScore: 0.8 });

  it("a reviewer reads a pending review item (200, tenant-scoped)", async () => {
    const { revTok } = await setupReviewer();
    const item = seedReview("acme");
    const res = await ctx.router.handle(bearer(revTok, { method: "GET", path: `/reviews/${item.id}` }));
    expect(res.status).toBe(200);
    const b = res.body as { id: string; status: string; agentId: string };
    expect(b.id).toBe(item.id);
    expect(b.status).toBe("pending");
    expect(b.agentId).toBe("agent-1");
  });

  it("GET /reviews/:id is 404 for an unknown id and 403 cross-tenant", async () => {
    const { revTok } = await setupReviewer();
    const missing = await ctx.router.handle(bearer(revTok, { method: "GET", path: "/reviews/nope" }));
    expect(missing.status).toBe(404);
    const otherItem = seedReview("other-tenant");
    const cross = await ctx.router.handle(bearer(revTok, { method: "GET", path: `/reviews/${otherItem.id}` }));
    expect(cross.status).toBe(403);
  });

  it("a non-reviewer (viewer) is forbidden (403)", async () => {
    const ownerTok = ((await ctx.router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;
    await ctx.router.handle(bearer(ownerTok, { method: "POST", path: "/admin/users", body: { email: "v@acme.com", password: "viewer1234", roles: ["viewer"] } }));
    const vTok = ((await ctx.router.handle(req({ method: "POST", path: "/auth/login", body: { email: "v@acme.com", password: "viewer1234" } }))).body as { token: string }).token;
    const item = seedReview("acme");
    const res = await ctx.router.handle(bearer(vTok, { method: "GET", path: `/reviews/${item.id}` }));
    expect(res.status).toBe(403);
  });

  it("an admin (manage_users) may also act on the queue", async () => {
    const { ownerTok } = await setupReviewer();
    const item = seedReview("acme");
    const res = await ctx.router.handle(bearer(ownerTok, { method: "GET", path: `/reviews/${item.id}` }));
    expect(res.status).toBe(200);
  });

  it("approve resolves the item (200) and a second resolve is 409", async () => {
    const { revTok } = await setupReviewer();
    const item = seedReview("acme");
    const ok = await ctx.router.handle(bearer(revTok, { method: "POST", path: `/reviews/${item.id}/approve` }));
    expect(ok.status).toBe(200);
    expect((ok.body as { status: string }).status).toBe("approved");
    // Re-approving an already-resolved item is an invalid action -> 409.
    const again = await ctx.router.handle(bearer(revTok, { method: "POST", path: `/reviews/${item.id}/approve` }));
    expect(again.status).toBe(409);
  });

  it("reject requires a reason (400) and records it (200)", async () => {
    const { revTok } = await setupReviewer();
    const item = seedReview("acme");
    const noReason = await ctx.router.handle(bearer(revTok, { method: "POST", path: `/reviews/${item.id}/reject`, body: {} }));
    expect(noReason.status).toBe(400);
    const blank = await ctx.router.handle(bearer(revTok, { method: "POST", path: `/reviews/${item.id}/reject`, body: { reason: "   " } }));
    expect(blank.status).toBe(400);
    const ok = await ctx.router.handle(bearer(revTok, { method: "POST", path: `/reviews/${item.id}/reject`, body: { reason: "insufficient eval coverage" } }));
    expect(ok.status).toBe(200);
    expect((ok.body as { status: string }).status).toBe("rejected");
  });

  it("reject of an already-resolved item is 409", async () => {
    const { revTok } = await setupReviewer();
    const item = seedReview("acme");
    await ctx.router.handle(bearer(revTok, { method: "POST", path: `/reviews/${item.id}/approve` }));
    const res = await ctx.router.handle(bearer(revTok, { method: "POST", path: `/reviews/${item.id}/reject`, body: { reason: "too late" } }));
    expect(res.status).toBe(409);
  });

  it("approve + reject are 404 unknown / 403 cross-tenant", async () => {
    const { revTok } = await setupReviewer();
    const approveMissing = await ctx.router.handle(bearer(revTok, { method: "POST", path: "/reviews/nope/approve" }));
    expect(approveMissing.status).toBe(404);
    const rejectMissing = await ctx.router.handle(bearer(revTok, { method: "POST", path: "/reviews/nope/reject", body: { reason: "x" } }));
    expect(rejectMissing.status).toBe(404);
    const other = seedReview("other-tenant");
    const approveCross = await ctx.router.handle(bearer(revTok, { method: "POST", path: `/reviews/${other.id}/approve` }));
    expect(approveCross.status).toBe(403);
    const rejectCross = await ctx.router.handle(bearer(revTok, { method: "POST", path: `/reviews/${other.id}/reject`, body: { reason: "x" } }));
    expect(rejectCross.status).toBe(403);
  });

  it("GET /reviews lists the tenant's pending items", async () => {
    const { revTok } = await setupReviewer();
    seedReview("acme", "agent-a");
    seedReview("acme", "agent-b");
    seedReview("other-tenant", "agent-c");
    const res = await ctx.router.handle(bearer(revTok, { method: "GET", path: "/reviews" }));
    expect(res.status).toBe(200);
    const items = res.body as Array<{ tenantId: string }>;
    expect(items.length).toBe(2);
    expect(items.every((i) => i.tenantId === "acme")).toBe(true);
  });

  it("reject tolerates a null body (400)", async () => {
    const { revTok } = await setupReviewer();
    const item = seedReview("acme");
    const res = await ctx.router.handle(bearer(revTok, { method: "POST", path: `/reviews/${item.id}/reject`, body: null }));
    expect(res.status).toBe(400);
  });

  it("approve + reject rethrow an unmapped queue error as 500", async () => {
    const identity = new IdentityStore();
    identity.createTenant({ id: "acme", name: "Acme" });
    identity.createUser({ id: "acme:rev", tenantId: "acme", email: "rev@acme.com", roles: ["reviewer"] });
    const boom = new Error("queue exploded");
    const reviews = new ReviewQueue(new InMemoryChannel());
    const item = reviews.submit({ agentId: "a", tenantId: "acme", requestedBy: "c@acme.com", weightedScore: 0.5 });
    // Force resolve() to throw a non-InvalidReviewActionError.
    (reviews as unknown as { resolve: () => never }).resolve = () => {
      throw boom;
    };
    const router = buildApi({
      identity,
      registry: new GovernedRegistry(),
      reviews,
      events: new EventBus({ transport: okTransport }),
      auth: { resolve: () => identity.getUser("acme:rev") } as unknown as AuthService,
      tokens: new Map<string, string>(),
    });
    const approve = await router.handle(bearer("x", { method: "POST", path: `/reviews/${item.id}/approve` }));
    expect(approve.status).toBe(500);
    const reject = await router.handle(bearer("x", { method: "POST", path: `/reviews/${item.id}/reject`, body: { reason: "r" } }));
    expect(reject.status).toBe(500);
  });
});

describe("secrets & connectors read endpoints (S106)", () => {
  // Build an API with a SecretsVault seeded for tenant 'acme'.
  const setupVault = async () => {
    const identity = new IdentityStore();
    const auth = new AuthService(identity);
    const vault = new SecretsVault();
    const deps: ApiDeps = {
      identity,
      registry: new GovernedRegistry(),
      reviews: new ReviewQueue(new InMemoryChannel()),
      events: new EventBus({ transport: okTransport }),
      auth,
      secretsVault: vault,
      tokens: new Map<string, string>(),
    };
    const router = buildApi(deps);
    // Register the tenant admin (owner@acme.com -> admin).
    const ownerTok = ((await router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;
    const admin = identity.getUser("acme:owner@acme.com");
    // Seed two secrets + a connector that references one.
    vault.putSecret(admin, { id: "openai-key", name: "OpenAI API key", value: "sk-abcdef123456WXYZ" });
    vault.putSecret(admin, { id: "db-pass", name: "DB password", value: "p@ssw0rd-LONG-tail" });
    vault.registerConnector(admin, { id: "oai", tenantId: "acme", kind: "openapi", name: "OpenAI", endpoint: "https://api.openai.com", secretId: "openai-key" });
    return { router, identity, auth, vault, ownerTok };
  };

  it("admin lists masked secrets (200) — plaintext is never returned", async () => {
    const { router, ownerTok } = await setupVault();
    const res = await router.handle(bearer(ownerTok, { method: "GET", path: "/secrets" }));
    expect(res.status).toBe(200);
    const secrets = (res.body as { secrets: Array<{ id: string; masked: string }> }).secrets;
    expect(secrets.map((s) => s.id)).toEqual(["db-pass", "openai-key"]); // sorted by id
    // Masked: first 2 + last 4, redacted middle; the raw value must not appear.
    const oai = secrets.find((s) => s.id === "openai-key")!;
    expect(oai.masked).toBe("sk\u2026WXYZ");
    expect(JSON.stringify(res.body)).not.toContain("sk-abcdef123456WXYZ");
  });

  it("admin lists connectors (200) with the secret reference", async () => {
    const { router, ownerTok } = await setupVault();
    const res = await router.handle(bearer(ownerTok, { method: "GET", path: "/connectors" }));
    expect(res.status).toBe(200);
    const connectors = (res.body as { connectors: Array<{ id: string; kind: string; secretId: string }> }).connectors;
    expect(connectors.length).toBe(1);
    expect(connectors[0].kind).toBe("openapi");
    expect(connectors[0].secretId).toBe("openai-key");
  });

  it("a non-admin (viewer) is forbidden from both (403)", async () => {
    const { router, ownerTok } = await setupVault();
    await router.handle(bearer(ownerTok, { method: "POST", path: "/admin/users", body: { email: "v@acme.com", password: "viewer1234", roles: ["viewer"] } }));
    const vTok = ((await router.handle(req({ method: "POST", path: "/auth/login", body: { email: "v@acme.com", password: "viewer1234" } }))).body as { token: string }).token;
    expect((await router.handle(bearer(vTok, { method: "GET", path: "/secrets" }))).status).toBe(403);
    expect((await router.handle(bearer(vTok, { method: "GET", path: "/connectors" }))).status).toBe(403);
  });

  it("secrets are tenant-scoped — another tenant's admin sees none", async () => {
    const { router } = await setupVault();
    // A second tenant + admin; its vault view is empty (no secrets seeded for it).
    const otherTok = ((await router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "other", tenantName: "Other", email: "o@other.com", password: "supersecret" } }))).body as { token: string }).token;
    const res = await router.handle(bearer(otherTok, { method: "GET", path: "/secrets" }));
    expect(res.status).toBe(200);
    expect((res.body as { secrets: unknown[] }).secrets).toEqual([]);
  });

  it("both endpoints are 404 when no secrets vault is configured", async () => {
    // ctx (from the top-level beforeEach) has no secretsVault.
    const tok = ((await ctx.router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;
    expect((await ctx.router.handle(bearer(tok, { method: "GET", path: "/secrets" }))).status).toBe(404);
    expect((await ctx.router.handle(bearer(tok, { method: "GET", path: "/connectors" }))).status).toBe(404);
  });
});

describe("billing & invoices read endpoints (S107)", () => {
  // Build an API with a BillingEngine (seeded usage for 'acme') + InvoiceStore.
  const setupBilling = async () => {
    const identity = new IdentityStore();
    const auth = new AuthService(identity);
    const billing = new BillingEngine({ unitPrices: { agents: 100, eval_runs: 5 }, currency: "USD", platformFee: 2000 });
    const invoices = new InvoiceStore();
    const deps: ApiDeps = {
      identity,
      registry: new GovernedRegistry(),
      reviews: new ReviewQueue(new InMemoryChannel()),
      events: new EventBus({ transport: okTransport }),
      auth,
      billingEngine: billing,
      invoiceStore: invoices,
      tokens: new Map<string, string>(),
    };
    const router = buildApi(deps);
    const ownerTok = ((await router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;
    // Meter some current-period usage.
    billing.meter("acme", "agents", 3);
    billing.meter("acme", "eval_runs", 10);
    // Persist two prior invoices so history + period-over-period have data.
    invoices.save({ tenantId: "acme", period: "2025-11", currency: "USD", lineItems: [], subtotal: 5000, total: 5000 });
    invoices.save({ tenantId: "acme", period: "2025-12", currency: "USD", lineItems: [], subtotal: 8000, total: 8000 });
    return { router, billing, invoices, ownerTok };
  };

  it("admin reads the current-period invoice (200) with priced line items in minor units", async () => {
    const { router, ownerTok } = await setupBilling();
    const res = await router.handle(bearer(ownerTok, { method: "GET", path: "/billing/current" }));
    expect(res.status).toBe(200);
    const inv = res.body as { currency: string; total: number; lineItems: Array<{ resource: string; amount: number }> };
    expect(inv.currency).toBe("USD");
    // 3 agents * 100 + 10 eval_runs * 5 + 2000 platform fee = 300 + 50 + 2000 = 2350.
    expect(inv.total).toBe(2350);
    expect(inv.lineItems.find((l) => l.resource === "agents")!.amount).toBe(300);
    expect(inv.lineItems.find((l) => l.resource === "platform_fee")!.amount).toBe(2000);
  });

  it("admin reads invoice history + lifetime summary + period-over-period (200)", async () => {
    const { router, ownerTok } = await setupBilling();
    const res = await router.handle(bearer(ownerTok, { method: "GET", path: "/billing/history" }));
    expect(res.status).toBe(200);
    const b = res.body as {
      invoices: Array<{ period: string; total: number }>;
      summary: { invoiceCount: number; lifetimeTotal: number };
      periodOverPeriod: { delta: number; pct: number } | null;
    };
    expect(b.invoices.map((i) => i.period)).toEqual(["2025-11", "2025-12"]); // sorted asc
    expect(b.summary.invoiceCount).toBe(2);
    expect(b.summary.lifetimeTotal).toBe(13000);
    expect(b.periodOverPeriod!.delta).toBe(3000); // 8000 - 5000
    expect(b.periodOverPeriod!.pct).toBeCloseTo(60);
  });

  it("a non-admin (viewer) is forbidden from both (403)", async () => {
    const { router, ownerTok } = await setupBilling();
    await router.handle(bearer(ownerTok, { method: "POST", path: "/admin/users", body: { email: "v@acme.com", password: "viewer1234", roles: ["viewer"] } }));
    const vTok = ((await router.handle(req({ method: "POST", path: "/auth/login", body: { email: "v@acme.com", password: "viewer1234" } }))).body as { token: string }).token;
    expect((await router.handle(bearer(vTok, { method: "GET", path: "/billing/current" }))).status).toBe(403);
    expect((await router.handle(bearer(vTok, { method: "GET", path: "/billing/history" }))).status).toBe(403);
  });

  it("billing is tenant-scoped — another tenant's admin sees an empty history", async () => {
    const { router } = await setupBilling();
    const otherTok = ((await router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "other", tenantName: "Other", email: "o@other.com", password: "supersecret" } }))).body as { token: string }).token;
    const res = await router.handle(bearer(otherTok, { method: "GET", path: "/billing/history" }));
    expect(res.status).toBe(200);
    const b = res.body as { invoices: unknown[]; summary: { invoiceCount: number } };
    expect(b.invoices).toEqual([]);
    expect(b.summary.invoiceCount).toBe(0);
  });

  it("both endpoints are 404 when billing/invoice deps are not configured", async () => {
    const tok = ((await ctx.router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;
    expect((await ctx.router.handle(bearer(tok, { method: "GET", path: "/billing/current" }))).status).toBe(404);
    expect((await ctx.router.handle(bearer(tok, { method: "GET", path: "/billing/history" }))).status).toBe(404);
  });
});

describe("SLA / uptime read endpoint (S110)", () => {
  // Build an API whose slaProvider serves per-agent SLA reports for a tenant.
  // The tracker has one healthy agent (no downtime) and one breaching agent
  // (a long outage inside the window). The provider is tenant-keyed: the demo
  // tenant 'acme' has both agents; any other tenant has none.
  const setupSla = async () => {
    const identity = new IdentityStore();
    const auth = new AuthService(identity);
    const sla = new SlaTracker();
    const WINDOW_START = 0;
    const WINDOW_END = 30 * 24 * 60 * 60 * 1000; // 30 days
    // healthy-bot: up the whole window.
    sla.setTarget("healthy-bot", { target: 0.999 });
    sla.record("healthy-bot", "up", WINDOW_START);
    // flaky-bot: down for 5 days mid-window -> breaches 99.9%.
    sla.setTarget("flaky-bot", { target: 0.999 });
    sla.record("flaky-bot", "up", WINDOW_START);
    sla.record("flaky-bot", "down", 10 * 24 * 60 * 60 * 1000);
    sla.record("flaky-bot", "up", 15 * 24 * 60 * 60 * 1000);
    const agentsByTenant: Record<string, string[]> = { acme: ["healthy-bot", "flaky-bot"] };
    const deps: ApiDeps = {
      identity,
      registry: new GovernedRegistry(),
      reviews: new ReviewQueue(new InMemoryChannel()),
      events: new EventBus({ transport: okTransport }),
      auth,
      slaProvider: (tenantId: string) => ({
        agents: (agentsByTenant[tenantId] ?? []).map((id) => sla.report(id, WINDOW_START, WINDOW_END)),
      }),
      tokens: new Map<string, string>(),
    };
    const router = buildApi(deps);
    const ownerTok = ((await router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;
    return { router, ownerTok };
  };

  it("admin reads per-agent SLA reports (200) with uptime, target and breach flag", async () => {
    const { router, ownerTok } = await setupSla();
    const res = await router.handle(bearer(ownerTok, { method: "GET", path: "/sla" }));
    expect(res.status).toBe(200);
    const body = res.body as { agents: Array<{ agentId: string; uptime: number; target: number; breached: boolean }> };
    expect(body.agents.map((a) => a.agentId)).toEqual(["healthy-bot", "flaky-bot"]);
    const healthy = body.agents.find((a) => a.agentId === "healthy-bot")!;
    const flaky = body.agents.find((a) => a.agentId === "flaky-bot")!;
    expect(healthy.uptime).toBe(1);
    expect(healthy.breached).toBe(false);
    // flaky-bot was down 5 of 30 days -> ~83.3% uptime, well under 99.9%.
    expect(flaky.breached).toBe(true);
    expect(flaky.uptime).toBeLessThan(0.9);
  });

  it("a non-admin (viewer) is forbidden (403)", async () => {
    const { router, ownerTok } = await setupSla();
    await router.handle(bearer(ownerTok, { method: "POST", path: "/admin/users", body: { email: "v@acme.com", password: "viewer1234", roles: ["viewer"] } }));
    const vTok = ((await router.handle(req({ method: "POST", path: "/auth/login", body: { email: "v@acme.com", password: "viewer1234" } }))).body as { token: string }).token;
    expect((await router.handle(bearer(vTok, { method: "GET", path: "/sla" }))).status).toBe(403);
  });

  it("is tenant-scoped — another tenant's admin sees no agents", async () => {
    const { router } = await setupSla();
    const otherTok = ((await router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "other", tenantName: "Other", email: "o@other.com", password: "supersecret" } }))).body as { token: string }).token;
    const res = await router.handle(bearer(otherTok, { method: "GET", path: "/sla" }));
    expect(res.status).toBe(200);
    expect((res.body as { agents: unknown[] }).agents).toEqual([]);
  });

  it("is 404 when no SLA provider is configured", async () => {
    const tok = ((await ctx.router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;
    expect((await ctx.router.handle(bearer(tok, { method: "GET", path: "/sla" }))).status).toBe(404);
  });
});

describe("Data residency & retention read endpoint (S113)", () => {
  // Build an API whose dataGovernanceProvider serves a tenant's retention policy
  // + residency report from the S19 DataGovernance engine. 'acme' has a policy
  // and two placed records (eu + uk); other tenants have no policy.
  const setupGov = async () => {
    const identity = new IdentityStore();
    const auth = new AuthService(identity);
    const gov = new DataGovernance(() => 0);
    gov.setPolicy({ tenantId: "acme", retentionDays: { audit_log: 365, runtime_trace: 30 }, allowedRegions: ["eu", "uk"] });
    gov.place({ id: "r1", tenantId: "acme", dataClass: "audit_log", region: "eu", createdAt: new Date(0).toISOString() });
    gov.place({ id: "r2", tenantId: "acme", dataClass: "runtime_trace", region: "uk", createdAt: new Date(0).toISOString() });
    const deps: ApiDeps = {
      identity,
      registry: new GovernedRegistry(),
      reviews: new ReviewQueue(new InMemoryChannel()),
      events: new EventBus({ transport: okTransport }),
      auth,
      dataGovernanceProvider: (tenantId: string) => {
        let policy: ReturnType<DataGovernance["getPolicy"]> | null = null;
        try {
          policy = gov.getPolicy(tenantId);
        } catch {
          policy = null;
        }
        return {
          allowedRegions: policy ? policy.allowedRegions : [],
          retentionDays: policy ? policy.retentionDays : {},
          residency: gov.residencyReport(tenantId),
        };
      },
      tokens: new Map<string, string>(),
    };
    const router = buildApi(deps);
    const ownerTok = ((await router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;
    return { router, ownerTok };
  };

  it("admin reads the retention policy + residency report (200)", async () => {
    const { router, ownerTok } = await setupGov();
    const res = await router.handle(bearer(ownerTok, { method: "GET", path: "/governance/data" }));
    expect(res.status).toBe(200);
    const body = res.body as { allowedRegions: string[]; retentionDays: Record<string, number>; residency: Record<string, number> };
    expect(body.allowedRegions).toEqual(["eu", "uk"]);
    expect(body.retentionDays.audit_log).toBe(365);
    expect(body.residency).toEqual({ eu: 1, uk: 1 });
  });

  it("a non-admin (viewer) is forbidden (403)", async () => {
    const { router, ownerTok } = await setupGov();
    await router.handle(bearer(ownerTok, { method: "POST", path: "/admin/users", body: { email: "v@acme.com", password: "viewer1234", roles: ["viewer"] } }));
    const vTok = ((await router.handle(req({ method: "POST", path: "/auth/login", body: { email: "v@acme.com", password: "viewer1234" } }))).body as { token: string }).token;
    expect((await router.handle(bearer(vTok, { method: "GET", path: "/governance/data" }))).status).toBe(403);
  });

  it("is tenant-scoped — another tenant's admin sees empty policy + residency", async () => {
    const { router } = await setupGov();
    const otherTok = ((await router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "other", tenantName: "Other", email: "o@other.com", password: "supersecret" } }))).body as { token: string }).token;
    const res = await router.handle(bearer(otherTok, { method: "GET", path: "/governance/data" }));
    expect(res.status).toBe(200);
    const body = res.body as { allowedRegions: string[]; residency: Record<string, number> };
    expect(body.allowedRegions).toEqual([]);
    expect(body.residency).toEqual({});
  });

  it("is 404 when no data-governance provider is configured", async () => {
    const tok = ((await ctx.router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;
    expect((await ctx.router.handle(bearer(tok, { method: "GET", path: "/governance/data" }))).status).toBe(404);
  });
});

describe("Marketplace catalog read endpoint (S114)", () => {
  // Build an API whose marketplaceProvider serves the platform-wide catalog with
  // install counts from the S10 Marketplace engine. Two packs published; one is
  // consumed twice so the install count is non-zero.
  const setupMarket = async () => {
    const identity = new IdentityStore();
    const auth = new AuthService(identity);
    const market = new Marketplace();
    market.publish({ id: "eval-basic", kind: "eval_pack", name: "Basic Eval", publisher: "acme", version: "1.0.0", certificationTier: "silver", publishedAt: new Date(0).toISOString(), cases: [{ id: "c1", input: "hi", expected: "ok" } as never] });
    market.publish({ id: "redteam-owasp", kind: "redteam_pack", name: "OWASP Red Team", publisher: "foundry", version: "2.1.0", certificationTier: "gold", publishedAt: new Date(0).toISOString(), attacks: [{ id: "a1" } as never] });
    market.consume("redteam-owasp");
    market.consume("redteam-owasp");
    const deps: ApiDeps = {
      identity,
      registry: new GovernedRegistry(),
      reviews: new ReviewQueue(new InMemoryChannel()),
      events: new EventBus({ transport: okTransport }),
      auth,
      marketplaceProvider: () => ({
        packs: market.browse().map((p) => ({
          id: p.id,
          kind: p.kind,
          name: p.name,
          publisher: p.publisher,
          version: p.version,
          certificationTier: p.certificationTier,
          installs: market.installCount(p.id),
        })),
      }),
      tokens: new Map<string, string>(),
    };
    const router = buildApi(deps);
    const ownerTok = ((await router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;
    return { router, ownerTok };
  };

  it("any authed user browses the catalog with install counts (200)", async () => {
    const { router, ownerTok } = await setupMarket();
    const res = await router.handle(bearer(ownerTok, { method: "GET", path: "/marketplace" }));
    expect(res.status).toBe(200);
    const body = res.body as { packs: Array<{ id: string; kind: string; certificationTier: string; installs: number }> };
    expect(body.packs.map((p) => p.id)).toEqual(["eval-basic", "redteam-owasp"]); // sorted by id
    expect(body.packs.find((p) => p.id === "redteam-owasp")!.installs).toBe(2);
    expect(body.packs.find((p) => p.id === "eval-basic")!.installs).toBe(0);
  });

  it("a viewer (non-admin) can also browse — marketplace is not admin-gated", async () => {
    const { router, ownerTok } = await setupMarket();
    await router.handle(bearer(ownerTok, { method: "POST", path: "/admin/users", body: { email: "v@acme.com", password: "viewer1234", roles: ["viewer"] } }));
    const vTok = ((await router.handle(req({ method: "POST", path: "/auth/login", body: { email: "v@acme.com", password: "viewer1234" } }))).body as { token: string }).token;
    expect((await router.handle(bearer(vTok, { method: "GET", path: "/marketplace" }))).status).toBe(200);
  });

  it("requires authentication (401 without a token)", async () => {
    const { router } = await setupMarket();
    expect((await router.handle(req({ method: "GET", path: "/marketplace" }))).status).toBe(401);
  });

  it("is 404 when no marketplace provider is configured", async () => {
    const tok = ((await ctx.router.handle(req({ method: "POST", path: "/auth/register", body: { tenantId: "acme", tenantName: "Acme", email: "owner@acme.com", password: "supersecret" } }))).body as { token: string }).token;
    expect((await ctx.router.handle(bearer(tok, { method: "GET", path: "/marketplace" }))).status).toBe(404);
  });
});
