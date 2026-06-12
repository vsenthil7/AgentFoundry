// S13 — Identity, RBAC & multi-tenancy.
// Tenants isolate all data. Users belong to a tenant and hold roles; roles map
// to a fixed permission set. Every privileged action checks a permission.

export type Role = "composer" | "reviewer" | "ops" | "admin" | "viewer";

export type Permission =
  | "agent:create"
  | "agent:read"
  | "agent:promote_request"
  | "agent:approve"
  | "agent:deploy"
  | "agent:retire"
  | "marketplace:publish"
  | "marketplace:consume"
  | "governance:report"
  | "admin:manage_users";

// Role → permissions. Admin is a superset; viewer is read-only.
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  composer: ["agent:create", "agent:read", "agent:promote_request", "marketplace:consume"],
  reviewer: ["agent:read", "agent:approve", "governance:report"],
  ops: ["agent:read", "agent:deploy", "agent:retire", "marketplace:publish"],
  admin: [
    "agent:create",
    "agent:read",
    "agent:promote_request",
    "agent:approve",
    "agent:deploy",
    "agent:retire",
    "marketplace:publish",
    "marketplace:consume",
    "governance:report",
    "admin:manage_users",
  ],
  viewer: ["agent:read"],
};

export interface Tenant {
  readonly id: string;
  readonly name: string;
}

export interface User {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly roles: readonly Role[];
}

export class TenantIsolationError extends Error {
  constructor(userTenant: string, resourceTenant: string) {
    super(
      `Cross-tenant access denied: user tenant '${userTenant}' != resource tenant '${resourceTenant}'.`,
    );
    this.name = "TenantIsolationError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(userId: string, permission: Permission) {
    super(`User '${userId}' lacks permission '${permission}'.`);
    this.name = "PermissionDeniedError";
  }
}

export class UserNotFoundError extends Error {
  constructor(id: string) {
    super(`User not found: ${id}`);
    this.name = "UserNotFoundError";
  }
}

export class DuplicateUserError extends Error {
  constructor(id: string) {
    super(`User already exists: ${id}`);
    this.name = "DuplicateUserError";
  }
}

// Compute the effective permission set for a user (union across roles).
export function permissionsFor(user: User): Set<Permission> {
  const perms = new Set<Permission>();
  for (const role of user.roles) {
    for (const p of ROLE_PERMISSIONS[role]) perms.add(p);
  }
  return perms;
}

export function hasPermission(user: User, permission: Permission): boolean {
  return permissionsFor(user).has(permission);
}

// Throws unless the user holds the permission.
export function requirePermission(user: User, permission: Permission): void {
  if (!hasPermission(user, permission)) {
    throw new PermissionDeniedError(user.id, permission);
  }
}

// Throws unless the user's tenant matches the resource's tenant.
export function requireSameTenant(user: User, resourceTenantId: string): void {
  if (user.tenantId !== resourceTenantId) {
    throw new TenantIsolationError(user.tenantId, resourceTenantId);
  }
}

export class IdentityStore {
  private readonly tenants = new Map<string, Tenant>();
  private readonly users = new Map<string, User>();

  createTenant(tenant: Tenant): Tenant {
    this.tenants.set(tenant.id, Object.freeze({ ...tenant }));
    return this.tenants.get(tenant.id)!;
  }

  hasTenant(id: string): boolean {
    return this.tenants.has(id);
  }

  // Remove a tenant and cascade-delete its users. Returns true if it existed.
  removeTenant(id: string): boolean {
    if (!this.tenants.has(id)) return false;
    for (const [userId, user] of [...this.users]) {
      if (user.tenantId === id) this.users.delete(userId);
    }
    this.tenants.delete(id);
    return true;
  }

  createUser(user: User): User {
    if (this.users.has(user.id)) throw new DuplicateUserError(user.id);
    if (!this.tenants.has(user.tenantId)) {
      throw new UserNotFoundError(`tenant ${user.tenantId}`);
    }
    const frozen = Object.freeze({ ...user, roles: Object.freeze([...user.roles]) });
    this.users.set(user.id, frozen);
    return frozen;
  }

  getUser(id: string): User {
    const u = this.users.get(id);
    if (!u) throw new UserNotFoundError(id);
    return u;
  }

  // Just-in-time provisioning for federated (OIDC/SSO) identities: create the
  // user if absent, or update roles/email if the token claims have changed.
  // Requires the tenant to exist (tenants are provisioned out of band).
  upsertUser(user: User): User {
    if (!this.tenants.has(user.tenantId)) {
      throw new UserNotFoundError(`tenant ${user.tenantId}`);
    }
    const frozen = Object.freeze({ ...user, roles: Object.freeze([...user.roles]) });
    this.users.set(user.id, frozen);
    return frozen;
  }

  // List users in a tenant (deterministic by id).
  usersInTenant(tenantId: string): User[] {
    return [...this.users.values()]
      .filter((u) => u.tenantId === tenantId)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
