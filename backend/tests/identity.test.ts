import { describe, it, expect, beforeEach } from "vitest";
import {
  IdentityStore,
  permissionsFor,
  hasPermission,
  requirePermission,
  requireSameTenant,
  PermissionDeniedError,
  TenantIsolationError,
  UserNotFoundError,
  DuplicateUserError,
  type User,
  type Role,
} from "../src/identity.js";

function user(roles: Role[], tenantId = "t1", id = "u1"): User {
  return { id, tenantId, email: `${id}@acme.test`, roles };
}

describe("permissionsFor", () => {
  it("composer gets create/read/promote/consume", () => {
    const p = permissionsFor(user(["composer"]));
    expect(p.has("agent:create")).toBe(true);
    expect(p.has("agent:approve")).toBe(false);
  });

  it("reviewer can approve but not create", () => {
    const p = permissionsFor(user(["reviewer"]));
    expect(p.has("agent:approve")).toBe(true);
    expect(p.has("agent:create")).toBe(false);
  });

  it("admin holds every permission", () => {
    const p = permissionsFor(user(["admin"]));
    expect(p.has("admin:manage_users")).toBe(true);
    expect(p.has("agent:deploy")).toBe(true);
  });

  it("viewer is read-only", () => {
    const p = permissionsFor(user(["viewer"]));
    expect([...p]).toEqual(["agent:read"]);
  });

  it("unions permissions across multiple roles", () => {
    const p = permissionsFor(user(["composer", "reviewer"]));
    expect(p.has("agent:create")).toBe(true);
    expect(p.has("agent:approve")).toBe(true);
  });
});

describe("hasPermission / requirePermission", () => {
  it("hasPermission reflects the set", () => {
    expect(hasPermission(user(["ops"]), "agent:deploy")).toBe(true);
    expect(hasPermission(user(["ops"]), "agent:approve")).toBe(false);
  });

  it("requirePermission throws when missing", () => {
    expect(() => requirePermission(user(["viewer"]), "agent:deploy")).toThrow(
      PermissionDeniedError,
    );
  });

  it("requirePermission passes when present", () => {
    expect(() => requirePermission(user(["admin"]), "agent:deploy")).not.toThrow();
  });
});

describe("requireSameTenant", () => {
  it("passes within the same tenant", () => {
    expect(() => requireSameTenant(user(["admin"], "t1"), "t1")).not.toThrow();
  });
  it("throws across tenants", () => {
    expect(() => requireSameTenant(user(["admin"], "t1"), "t2")).toThrow(
      TenantIsolationError,
    );
  });
});

describe("IdentityStore", () => {
  let store: IdentityStore;
  beforeEach(() => {
    store = new IdentityStore();
    store.createTenant({ id: "t1", name: "Acme" });
  });

  it("creates and reads a user", () => {
    store.createUser(user(["composer"]));
    expect(store.getUser("u1").email).toBe("u1@acme.test");
  });

  it("removeTenant returns false for an unknown tenant", () => {
    expect(store.removeTenant("ghost")).toBe(false);
  });

  it("removeTenant cascades user deletion and returns true", () => {
    store.createUser(user(["composer"]));
    expect(store.removeTenant("t1")).toBe(true);
    expect(store.hasTenant("t1")).toBe(false);
    expect(() => store.getUser("u1")).toThrow();
  });

  it("freezes created users", () => {
    const u = store.createUser(user(["composer"]));
    expect(Object.isFrozen(u)).toBe(true);
  });

  it("rejects a duplicate user", () => {
    store.createUser(user(["composer"]));
    expect(() => store.createUser(user(["composer"]))).toThrow(DuplicateUserError);
  });

  it("rejects a user in a nonexistent tenant", () => {
    expect(() => store.createUser(user(["composer"], "ghost"))).toThrow(
      UserNotFoundError,
    );
  });

  it("throws for an unknown user", () => {
    expect(() => store.getUser("ghost")).toThrow(UserNotFoundError);
  });

  it("hasTenant reflects presence", () => {
    expect(store.hasTenant("t1")).toBe(true);
    expect(store.hasTenant("t2")).toBe(false);
  });

  it("lists users in a tenant deterministically", () => {
    store.createTenant({ id: "t2", name: "Other" });
    store.createUser(user(["composer"], "t1", "u-b"));
    store.createUser(user(["composer"], "t1", "u-a"));
    store.createUser(user(["composer"], "t2", "u-c"));
    expect(store.usersInTenant("t1").map((u) => u.id)).toEqual(["u-a", "u-b"]);
  });
});
