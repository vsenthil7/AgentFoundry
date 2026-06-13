import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AuthService,
  InvalidCredentialsError,
  EmailTakenError,
  SessionExpiredError,
  WeakPasswordError,
  systemNow,
} from "../src/auth.js";
import { IdentityStore } from "../src/identity.js";
import { FileStore } from "../src/file_store.js";

// Mutable clock for deterministic expiry tests.
class TestClock {
  constructor(public t: number) {}
  now = () => this.t;
}

describe("AuthService (S78 authentication)", () => {
  let identity: IdentityStore;
  let clock: TestClock;
  let auth: AuthService;

  beforeEach(() => {
    identity = new IdentityStore();
    clock = new TestClock(1_000_000);
    auth = new AuthService(identity, null, clock.now, 60_000);
  });

  it("registers the first tenant user as admin and returns a session", () => {
    const r = auth.register({
      tenantId: "acme",
      tenantName: "Acme",
      email: "Owner@Acme.com",
      password: "supersecret",
    });
    expect(r.user.roles).toEqual(["admin"]);
    expect(r.user.email).toBe("owner@acme.com"); // normalized
    expect(r.token).toHaveLength(64); // 32 bytes hex
    expect(r.expiresAt).toBe(1_060_000);
  });

  it("registers subsequent tenant users as viewer by default", () => {
    auth.register({ tenantId: "acme", tenantName: "Acme", email: "a@acme.com", password: "password1" });
    const r2 = auth.register({ tenantId: "acme", tenantName: "Acme", email: "b@acme.com", password: "password1" });
    expect(r2.user.roles).toEqual(["viewer"]);
  });

  it("honors explicit roles when provided", () => {
    const r = auth.register({
      tenantId: "acme",
      tenantName: "Acme",
      email: "rev@acme.com",
      password: "password1",
      roles: ["reviewer", "ops"],
    });
    expect(r.user.roles).toEqual(["reviewer", "ops"]);
  });

  it("rejects a weak password", () => {
    expect(() =>
      auth.register({ tenantId: "acme", tenantName: "Acme", email: "x@acme.com", password: "short" }),
    ).toThrow(WeakPasswordError);
  });

  it("rejects a duplicate email", () => {
    auth.register({ tenantId: "acme", tenantName: "Acme", email: "dup@acme.com", password: "password1" });
    expect(() =>
      auth.register({ tenantId: "acme", tenantName: "Acme", email: "DUP@acme.com", password: "password1" }),
    ).toThrow(EmailTakenError);
  });

  it("logs in with correct credentials and mints a new session", () => {
    auth.register({ tenantId: "acme", tenantName: "Acme", email: "u@acme.com", password: "password1" });
    const r = auth.login("U@acme.com", "password1");
    expect(r.user.email).toBe("u@acme.com");
    expect(r.token).toHaveLength(64);
  });

  it("rejects login with wrong password", () => {
    auth.register({ tenantId: "acme", tenantName: "Acme", email: "u@acme.com", password: "password1" });
    expect(() => auth.login("u@acme.com", "wrongpass")).toThrow(InvalidCredentialsError);
  });

  it("rejects login for unknown email", () => {
    expect(() => auth.login("ghost@acme.com", "password1")).toThrow(InvalidCredentialsError);
  });

  it("resolves a valid session token to the user", () => {
    const r = auth.register({ tenantId: "acme", tenantName: "Acme", email: "u@acme.com", password: "password1" });
    const user = auth.resolve(r.token);
    expect(user.email).toBe("u@acme.com");
  });

  it("rejects an unknown session token", () => {
    expect(() => auth.resolve("deadbeef")).toThrow(SessionExpiredError);
  });

  it("rejects an expired session token and evicts it", () => {
    const r = auth.register({ tenantId: "acme", tenantName: "Acme", email: "u@acme.com", password: "password1" });
    expect(auth.activeSessionCount()).toBe(1);
    clock.t += 60_001; // past TTL
    expect(() => auth.resolve(r.token)).toThrow(SessionExpiredError);
    expect(auth.activeSessionCount()).toBe(0);
  });

  it("logout revokes the session, idempotently", () => {
    const r = auth.register({ tenantId: "acme", tenantName: "Acme", email: "u@acme.com", password: "password1" });
    expect(auth.logout(r.token)).toBe(true);
    expect(() => auth.resolve(r.token)).toThrow(SessionExpiredError);
    expect(auth.logout(r.token)).toBe(false);
  });

  it("isRegistered reflects normalized email presence", () => {
    expect(auth.isRegistered("u@acme.com")).toBe(false);
    auth.register({ tenantId: "acme", tenantName: "Acme", email: "u@acme.com", password: "password1" });
    expect(auth.isRegistered("U@ACME.COM")).toBe(true);
  });

  it("activeSessionCount excludes expired sessions without resolving them", () => {
    auth.register({ tenantId: "acme", tenantName: "Acme", email: "a@acme.com", password: "password1" });
    auth.register({ tenantId: "acme", tenantName: "Acme", email: "b@acme.com", password: "password1" });
    expect(auth.activeSessionCount()).toBe(2);
    clock.t += 60_001;
    expect(auth.activeSessionCount()).toBe(0);
  });

  it("verify returns false (not throw) on a length-mismatched stored hash", () => {
    // Persist a credential with a deliberately short/corrupt hash, rehydrate, and
    // confirm login fails cleanly rather than throwing from timingSafeEqual.
    const store = (() => {
      const m = new Map<string, string>();
      return {
        get: (k: string) => (m.has(k) ? m.get(k)! : null),
        set: (k: string, v: string) => void m.set(k, v),
        delete: (k: string) => m.delete(k),
        keys: (prefix?: string) => [...m.keys()].sort().filter((k) => (prefix ? k.startsWith(prefix) : true)),
      };
    })();
    identity.createTenant({ id: "acme", name: "Acme" });
    identity.createUser({ id: "acme:c@acme.com", tenantId: "acme", email: "c@acme.com", roles: ["admin"] });
    store.set(
      "auth:cred:c@acme.com",
      JSON.stringify({ userId: "acme:c@acme.com", email: "c@acme.com", salt: "00", hash: "ab" }),
    );
    const a = new AuthService(identity, store, clock.now, 60_000);
    expect(() => a.login("c@acme.com", "password1")).toThrow(InvalidCredentialsError);
  });

  it("defaults to the system clock when none is injected", () => {
    const a = new AuthService(new IdentityStore());
    const before = Date.now();
    const r = a.register({ tenantId: "t", tenantName: "T", email: "sys@t.com", password: "password1" });
    // expiresAt is now()+TTL using the real clock; just assert it is in the future.
    expect(r.expiresAt).toBeGreaterThanOrEqual(before);
    expect(a.resolve(r.token).email).toBe("sys@t.com");
  });

  it("systemNow returns a wall-clock millisecond timestamp", () => {
    const before = Date.now();
    const v = systemNow();
    const after = Date.now();
    expect(v).toBeGreaterThanOrEqual(before);
    expect(v).toBeLessThanOrEqual(after);
  });

  it("store-backed logout deletes the persisted session", () => {
    const dir = mkdtempSync(join(tmpdir(), "af-auth-lo-"));
    const p = join(dir, "auth.json");
    const store = new FileStore(p);
    const a = new AuthService(identity, store, clock.now, 60_000);
    const r = a.register({ tenantId: "acme", tenantName: "Acme", email: "u@acme.com", password: "password1" });
    expect(store.keys("auth:sess:").length).toBe(1);
    expect(a.logout(r.token)).toBe(true);
    expect(store.keys("auth:sess:").length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("store-backed expired session is evicted from the persisted store on resolve", () => {
    const dir = mkdtempSync(join(tmpdir(), "af-auth-ex-"));
    const p = join(dir, "auth.json");
    const store = new FileStore(p);
    const a = new AuthService(identity, store, clock.now, 60_000);
    const r = a.register({ tenantId: "acme", tenantName: "Acme", email: "u@acme.com", password: "password1" });
    clock.t += 60_001;
    expect(() => a.resolve(r.token)).toThrow(SessionExpiredError);
    expect(store.keys("auth:sess:").length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers into an existing tenant without recreating it", () => {
    identity.createTenant({ id: "acme", name: "Acme Pre-existing" });
    const r = auth.register({ tenantId: "acme", tenantName: "Ignored", email: "first@acme.com", password: "password1" });
    // Tenant already existed and had no users, so this user is still admin.
    expect(r.user.roles).toEqual(["admin"]);
    expect(identity.hasTenant("acme")).toBe(true);
  });

  describe("durability across restart (FileStore-backed)", () => {
    let dir: string;
    let p: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "af-auth-"));
      p = join(dir, "auth.json");
    });

    it("credentials and sessions survive a new AuthService on the same store", () => {
      const store1 = new FileStore(p);
      const id1 = new IdentityStore();
      const a1 = new AuthService(id1, store1, clock.now, 60_000);
      const reg = a1.register({ tenantId: "acme", tenantName: "Acme", email: "u@acme.com", password: "password1" });

      // Simulate restart: fresh identity store + fresh auth over the SAME store.
      // S89 fix: we do NOT manually re-provision the tenant/user here — rehydrate()
      // must rebuild identity from the persisted credential. (Manually recreating
      // them, as the old test did, masked the "can't log in after restart" bug.)
      const store2 = new FileStore(p);
      const id2 = new IdentityStore();
      const a2 = new AuthService(id2, store2, clock.now, 60_000);

      // Identity was rebuilt purely from the durable store.
      expect(id2.hasTenant("acme")).toBe(true);
      expect(id2.getUser("acme:u@acme.com").roles).toEqual(["admin"]);
      // Login works against rehydrated credentials.
      const loggedIn = a2.login("u@acme.com", "password1");
      expect(loggedIn.user.email).toBe("u@acme.com");
      // Original session token still resolves (rehydrated session).
      expect(a2.resolve(reg.token).email).toBe("u@acme.com");

      rmSync(dir, { recursive: true, force: true });
    });

    it("register -> logout -> restart -> login round-trips with no manual re-provisioning (S89 regression)", () => {
      // This is the exact defect the user hit: register once, then unable to log
      // in again after the process recycled. With durable auth + identity rebuild,
      // the second login must succeed against only the persisted store.
      const id1 = new IdentityStore();
      const a1 = new AuthService(id1, new FileStore(p), clock.now, 60_000);
      const reg = a1.register({ tenantId: "acme", tenantName: "Acme", email: "founder@acme.com", password: "password1" });
      a1.logout(reg.token); // user signs out

      // Restart: brand-new in-memory identity, fresh auth over the same file.
      const id2 = new IdentityStore();
      const a2 = new AuthService(id2, new FileStore(p), clock.now, 60_000);
      const again = a2.login("founder@acme.com", "password1");
      expect(again.user.email).toBe("founder@acme.com");
      expect(again.user.roles).toEqual(["admin"]);

      rmSync(dir, { recursive: true, force: true });
    });

    it("a non-first user's roles survive restart (viewer stays viewer)", () => {
      const a1 = new AuthService(new IdentityStore(), new FileStore(p), clock.now, 60_000);
      a1.register({ tenantId: "acme", tenantName: "Acme", email: "admin@acme.com", password: "password1" });
      a1.register({ tenantId: "acme", tenantName: "Acme", email: "viewer@acme.com", password: "password1" });

      const id2 = new IdentityStore();
      const a2 = new AuthService(id2, new FileStore(p), clock.now, 60_000);
      expect(id2.getUser("acme:viewer@acme.com").roles).toEqual(["viewer"]);
      expect(a2.login("viewer@acme.com", "password1").user.roles).toEqual(["viewer"]);

      rmSync(dir, { recursive: true, force: true });
    });

    it("rebuilds identity from a legacy credential record missing tenantName", () => {
      // A record persisted before S89 carries `user` but no `tenantName`; rehydrate
      // must fall back to the tenantId as the tenant name (covers the ?? branch).
      const store = new FileStore(p);
      store.set(
        "auth:cred:legacy@acme.com",
        JSON.stringify({
          userId: "acme:legacy@acme.com",
          email: "legacy@acme.com",
          salt: "00",
          hash: "ab",
          user: { id: "acme:legacy@acme.com", tenantId: "acme", email: "legacy@acme.com", roles: ["admin"] },
          // tenantName intentionally absent
        }),
      );
      const id2 = new IdentityStore();
      new AuthService(id2, new FileStore(p), clock.now, 60_000);
      expect(id2.hasTenant("acme")).toBe(true);
      expect(id2.getUser("acme:legacy@acme.com").email).toBe("legacy@acme.com");

      rmSync(dir, { recursive: true, force: true });
    });
  });
});
