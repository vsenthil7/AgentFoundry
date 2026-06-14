// S78 — Authentication: registration, login, sessions, password security.
// Builds the credential layer the IdentityStore (S13) intentionally left out:
// IdentityStore models *who* a user is and *what* they may do; this module proves
// *that they are who they claim* (password) and mints short-lived session tokens.
//
// Security posture:
//  - Passwords are never stored. We store scrypt(password, per-user random salt).
//    scrypt is memory-hard; the salt defeats rainbow tables; verification is
//    constant-time (timingSafeEqual) to avoid leaking via timing.
//  - Session tokens are 256-bit random, opaque, and expire. The token never
//    encodes identity; it indexes a server-side session (revocable on logout).
//  - Durable: AuthStore persists over any KeyValueStore (S14/S77), so credentials
//    and sessions survive restart when backed by FileStore.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { KeyValueStore } from "./persistence.js";
import {
  IdentityStore,
  DuplicateTenantError,
  type Role,
  type User,
  type Tenant,
} from "./identity.js";

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
export class InvalidCredentialsError extends AuthError {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}
export class EmailTakenError extends AuthError {
  constructor(email: string) {
    super(`Email already registered: ${email}`);
    this.name = "EmailTakenError";
  }
}
export class SessionExpiredError extends AuthError {
  constructor() {
    super("Session expired or invalid.");
    this.name = "SessionExpiredError";
  }
}
export class WeakPasswordError extends AuthError {
  constructor() {
    super("Password must be at least 8 characters.");
    this.name = "WeakPasswordError";
  }
}
export class IncorrectPasswordError extends AuthError {
  constructor() {
    super("Current password is incorrect.");
    this.name = "IncorrectPasswordError";
  }
}
export class UserDeactivatedError extends AuthError {
  constructor() {
    super("This account has been deactivated.");
    this.name = "UserDeactivatedError";
  }
}
export class LastAdminError extends AuthError {
  constructor() {
    super("Cannot remove or deactivate the last admin of a tenant.");
    this.name = "LastAdminError";
  }
}
export class AuthNotFoundError extends AuthError {
  constructor(what: string) {
    super(`${what} not found.`);
    this.name = "AuthNotFoundError";
  }
}
export class TenantSuspendedError extends AuthError {
  constructor() {
    super("This tenant has been suspended.");
    this.name = "TenantSuspendedError";
  }
}

interface CredentialRecord {
  readonly userId: string;
  readonly email: string;
  readonly salt: string; // hex
  readonly hash: string; // hex
  // S89: persist enough identity to rebuild the IdentityStore on restart, so a
  // rehydrated credential always has a matching user/tenant to log in against.
  readonly user: User;
  readonly tenantName: string;
}

interface SessionRecord {
  readonly token: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly expiresAt: number; // epoch ms
}

// Hash a password with a fresh random salt. Returns {salt, hash} both hex.
function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  return { salt: salt.toString("hex"), hash: derived.toString("hex") };
}

// Constant-time verify: re-derive with the stored salt and compare.
function verifyPassword(password: string, saltHex: string, hashHex: string): boolean {
  const salt = Buffer.from(saltHex, "hex");
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hashHex, "hex");
  // timingSafeEqual throws on length mismatch; guard so a malformed record is a
  // clean "false" rather than an exception.
  if (derived.length !== stored.length) return false;
  return timingSafeEqual(derived, stored);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Default wall-clock source. Exported so the default path is directly testable
// (avoids an uncoverable inline default-parameter arrow).
export function systemNow(): number {
  return Date.now();
}

export interface RegisterInput {
  tenantId: string;
  tenantName: string;
  email: string;
  password: string;
  roles?: readonly Role[];
}

export interface AuthResult {
  user: User;
  token: string;
  expiresAt: number;
}

// AuthService ties credentials + sessions to the IdentityStore. It owns
// registration (which provisions tenant + user + credentials atomically enough
// for this layer), login, session resolution, and logout.
export class AuthService {
  private readonly credByEmail: Map<string, CredentialRecord> = new Map();
  private readonly sessions: Map<string, SessionRecord> = new Map();

  private readonly now: () => number;
  private readonly sessionTtlMs: number;
  private readonly store: KeyValueStore | null;

  constructor(
    private readonly identity: IdentityStore,
    store?: KeyValueStore | null,
    now?: () => number,
    sessionTtlMs?: number,
  ) {
    if (store) {
      this.store = store;
    } else {
      this.store = null;
    }
    if (now) {
      this.now = now;
    } else {
      this.now = systemNow;
    }
    if (sessionTtlMs !== undefined) {
      this.sessionTtlMs = sessionTtlMs;
    } else {
      this.sessionTtlMs = DEFAULT_SESSION_TTL_MS;
    }
    if (this.store) this.rehydrate();
  }

  // Load persisted credentials + sessions from the backing store (durability).
  // S89 fix: also rebuild the tenant + user in the IdentityStore from each
  // credential, so login() after a restart finds a matching user (previously the
  // credential survived but the in-memory IdentityStore was empty -> login threw
  // UserNotFoundError, surfacing as "registered once, can't log in again").
  private rehydrate(): void {
    for (const key of this.store!.keys("auth:cred:")) {
      const rec = JSON.parse(this.store!.get(key)!) as CredentialRecord;
      this.credByEmail.set(rec.email, rec);
      // Reconstruct identity (idempotent; tolerant of partial/legacy records).
      if (rec.user) {
        if (!this.identity.hasTenant(rec.user.tenantId)) {
          this.identity.createTenant({ id: rec.user.tenantId, name: rec.tenantName ?? rec.user.tenantId });
        }
        this.identity.upsertUser(rec.user);
      }
    }
    for (const key of this.store!.keys("auth:sess:")) {
      const rec = JSON.parse(this.store!.get(key)!) as SessionRecord;
      this.sessions.set(rec.token, rec);
    }
  }

  private persistCred(rec: CredentialRecord): void {
    if (this.store) this.store.set(`auth:cred:${rec.email}`, JSON.stringify(rec));
  }
  private persistSession(rec: SessionRecord): void {
    if (this.store) this.store.set(`auth:sess:${rec.token}`, JSON.stringify(rec));
  }
  private dropSession(token: string): void {
    if (this.store) this.store.delete(`auth:sess:${token}`);
  }

  // The first user of a tenant becomes admin unless roles are given explicitly.
  register(input: RegisterInput): AuthResult {
    const email = normalizeEmail(input.email);
    if (input.password.length < 8) throw new WeakPasswordError();
    if (this.credByEmail.has(email)) throw new EmailTakenError(email);

    if (!this.identity.hasTenant(input.tenantId)) {
      const tenant: Tenant = { id: input.tenantId, name: input.tenantName };
      this.identity.createTenant(tenant);
    }

    const isFirstUser = this.identity.usersInTenant(input.tenantId).length === 0;
    const roles: readonly Role[] =
      input.roles && input.roles.length > 0
        ? input.roles
        : isFirstUser
          ? ["admin"]
          : ["viewer"];

    const userId = `${input.tenantId}:${email}`;
    const user: User = { id: userId, tenantId: input.tenantId, email, roles };
    this.identity.createUser(user);

    const { salt, hash } = hashPassword(input.password);
    const cred: CredentialRecord = {
      userId,
      email,
      salt,
      hash,
      user,
      tenantName: input.tenantName,
    };
    this.credByEmail.set(email, cred);
    this.persistCred(cred);

    return this.mintSession(user);
  }

  login(email: string, password: string): AuthResult {
    const norm = normalizeEmail(email);
    const cred = this.credByEmail.get(norm);
    if (!cred) throw new InvalidCredentialsError();
    if (!verifyPassword(password, cred.salt, cred.hash)) {
      throw new InvalidCredentialsError();
    }
    // The credential is valid, but the IdentityStore lookups below can throw if a
    // rehydrated/persisted record is inconsistent with the in-memory identity
    // (e.g. a durable store carried across a schema change, or a partial legacy
    // record). Self-heal: reconstruct the user/tenant from the credential's own
    // embedded copy rather than 500-ing. A login must never surface an unmapped
    // error to the API boundary.
    const user = this.resolveOrHealUser(cred);
    // S91: deactivated accounts cannot authenticate.
    if (user.active === false) throw new UserDeactivatedError();
    // S92: users of a suspended tenant cannot authenticate (superadmins exempt,
    // so platform operators can still sign in to manage a suspended tenant).
    if (!user.roles.includes("superadmin") && this.tenantStatusOf(user.tenantId) === "suspended") {
      throw new TenantSuspendedError();
    }
    return this.mintSession(user);
  }

  // Resolve the user behind a verified credential, self-healing the IdentityStore
  // from the credential's embedded user/tenant if the live store is missing or
  // inconsistent (durability edge: stale store, schema drift, partial record).
  // Falls back to the credential's embedded user as a last resort so a verified
  // password always yields a usable identity instead of an unmapped throw.
  private resolveOrHealUser(cred: CredentialRecord): User {
    try {
      return this.identity.getUser(cred.userId);
    } catch {
      // The user is missing from the live IdentityStore. Rebuild it from the
      // credential's embedded copy if present, else fail cleanly as bad creds.
      // The embedded user is the authoritative persisted identity, so we return
      // it directly after re-seeding the store (rather than re-reading, which
      // would only differ if the record were internally inconsistent).
      if (!cred.user) throw new InvalidCredentialsError();
      if (!this.identity.hasTenant(cred.user.tenantId)) {
        this.identity.createTenant({ id: cred.user.tenantId, name: cred.tenantName ?? cred.user.tenantId });
      }
      this.identity.upsertUser(cred.user);
      return cred.user;
    }
  }

  // Tenant status that never throws: a missing/legacy tenant is treated as active
  // (a verified user whose tenant record is absent is not "suspended").
  private tenantStatusOf(tenantId: string): "active" | "suspended" | undefined {
    try {
      return this.identity.getTenant(tenantId).status;
    } catch {
      return undefined;
    }
  }

  private mintSession(user: User): AuthResult {
    const token = randomBytes(TOKEN_BYTES).toString("hex");
    const expiresAt = this.now() + this.sessionTtlMs;
    const rec: SessionRecord = { token, userId: user.id, tenantId: user.tenantId, expiresAt };
    this.sessions.set(token, rec);
    this.persistSession(rec);
    return { user, token, expiresAt };
  }

  // Resolve a session token to its user, enforcing expiry. Expired sessions are
  // evicted on access (lazy cleanup).
  resolve(token: string): User {
    const rec = this.sessions.get(token);
    if (!rec) throw new SessionExpiredError();
    if (rec.expiresAt <= this.now()) {
      this.sessions.delete(token);
      this.dropSession(token);
      throw new SessionExpiredError();
    }
    return this.identity.getUser(rec.userId);
  }

  // Logout: revoke a single session. Idempotent.
  logout(token: string): boolean {
    const existed = this.sessions.delete(token);
    if (existed) this.dropSession(token);
    return existed;
  }

  // Operational: count of live (non-expired) sessions.
  activeSessionCount(): number {
    const now = this.now();
    let n = 0;
    for (const rec of this.sessions.values()) {
      if (rec.expiresAt > now) n++;
    }
    return n;
  }

  // Whether an email is already registered (for pre-submit UX checks).
  isRegistered(email: string): boolean {
    return this.credByEmail.has(normalizeEmail(email));
  }

  // S90 — profile self-service: update the caller's display name and/or email.
  // Email is re-checked for uniqueness and the credential is re-keyed; the userId
  // (tenant:original-email) stays stable so sessions and references survive.
  updateProfile(userId: string, patch: { displayName?: string; email?: string }): User {
    const user = this.identity.getUser(userId); // throws if unknown
    const cred = this.credForUserId(userId);

    let nextEmail = user.email;
    if (patch.email !== undefined) {
      const norm = normalizeEmail(patch.email);
      if (norm.length === 0 || !norm.includes("@")) throw new AuthError("A valid email is required.");
      if (norm !== user.email && this.credByEmail.has(norm)) throw new EmailTakenError(norm);
      nextEmail = norm;
    }

    const updated = this.identity.updateUser(userId, {
      email: nextEmail,
      ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() } : {}),
    });

    // Re-key + repersist the credential to mirror the new email/identity.
    const oldEmail = cred.email;
    const nextCred: CredentialRecord = { ...cred, email: nextEmail, user: updated };
    if (nextEmail !== oldEmail) {
      this.credByEmail.delete(oldEmail);
      if (this.store) this.store.delete(`auth:cred:${oldEmail}`);
    }
    this.credByEmail.set(nextEmail, nextCred);
    this.persistCred(nextCred);
    return updated;
  }

  // S90 — change the caller's password: verify the current one (constant-time),
  // enforce strength, re-hash, persist, and revoke all OTHER sessions (the caller
  // keeps the session they used). Returns the count of sessions revoked.
  changePassword(userId: string, currentPassword: string, nextPassword: string, keepToken?: string): number {
    const cred = this.credForUserId(userId);
    if (!verifyPassword(currentPassword, cred.salt, cred.hash)) throw new IncorrectPasswordError();
    if (nextPassword.length < 8) throw new WeakPasswordError();

    const { salt, hash } = hashPassword(nextPassword);
    const nextCred: CredentialRecord = { ...cred, salt, hash };
    this.credByEmail.set(cred.email, nextCred);
    this.persistCred(nextCred);

    // Revoke other sessions for this user (password change = security event).
    let revoked = 0;
    for (const [token, rec] of [...this.sessions]) {
      if (rec.userId === userId && token !== keepToken) {
        this.sessions.delete(token);
        this.dropSession(token);
        revoked++;
      }
    }
    return revoked;
  }

  // Find the credential record for a userId (throws if none).
  private credForUserId(userId: string): CredentialRecord {
    for (const cred of this.credByEmail.values()) {
      if (cred.userId === userId) return cred;
    }
    throw new InvalidCredentialsError();
  }

  // ---- S91: tenant-admin user management (caller must be an admin; all actions
  // are scoped to the admin's own tenant by the API layer). These operate on the
  // identity + credential stores and keep both in sync + persisted. ----

  // Create a user in a tenant with an explicit role set and an initial password
  // (the admin shares a temp password out-of-band; the user changes it via S90).
  adminCreateUser(input: {
    tenantId: string;
    email: string;
    password: string;
    roles: readonly Role[];
    displayName?: string;
  }): User {
    const email = normalizeEmail(input.email);
    if (input.password.length < 8) throw new WeakPasswordError();
    if (this.credByEmail.has(email)) throw new EmailTakenError(email);
    if (!this.identity.hasTenant(input.tenantId)) throw new AuthNotFoundError(`tenant ${input.tenantId}`);

    const userId = `${input.tenantId}:${email}`;
    const user: User = {
      id: userId,
      tenantId: input.tenantId,
      email,
      roles: input.roles.length > 0 ? input.roles : ["viewer"],
      ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
      active: true,
    };
    this.identity.createUser(user);

    const { salt, hash } = hashPassword(input.password);
    const cred: CredentialRecord = { userId, email, salt, hash, user, tenantName: this.tenantNameFor(input.tenantId) };
    this.credByEmail.set(email, cred);
    this.persistCred(cred);
    return user;
  }

  // Replace a user's role set. Guards the last-admin invariant.
  setUserRoles(userId: string, roles: readonly Role[]): User {
    const user = this.identity.getUser(userId);
    const losingAdmin = user.roles.includes("admin") && !roles.includes("admin");
    if (losingAdmin && this.isLastAdmin(user)) throw new LastAdminError();
    const updated = this.identity.updateUser(userId, { roles });
    this.syncCred(updated);
    return updated;
  }

  // Deactivate a user (cannot log in; existing sessions revoked). Last-admin guard.
  deactivateUser(userId: string): User {
    const user = this.identity.getUser(userId);
    if (user.roles.includes("admin") && this.isLastAdmin(user)) throw new LastAdminError();
    const updated = this.identity.updateUser(userId, { active: false });
    this.syncCred(updated);
    // Revoke any live sessions for the now-deactivated user.
    for (const [token, rec] of [...this.sessions]) {
      if (rec.userId === userId) {
        this.sessions.delete(token);
        this.dropSession(token);
      }
    }
    return updated;
  }

  reactivateUser(userId: string): User {
    this.identity.getUser(userId); // throws if unknown
    const updated = this.identity.updateUser(userId, { active: true });
    this.syncCred(updated);
    return updated;
  }

  // Admin resets a user's password to a new value (e.g. a generated temp password).
  resetUserPassword(userId: string, newPassword: string): void {
    if (newPassword.length < 8) throw new WeakPasswordError();
    const cred = this.credForUserId(userId);
    const { salt, hash } = hashPassword(newPassword);
    const nextCred: CredentialRecord = { ...cred, salt, hash };
    this.credByEmail.set(cred.email, nextCred);
    this.persistCred(nextCred);
    // Force re-login everywhere.
    for (const [token, rec] of [...this.sessions]) {
      if (rec.userId === userId) {
        this.sessions.delete(token);
        this.dropSession(token);
      }
    }
  }

  // Whether this user is the only active admin in their tenant.
  private isLastAdmin(user: User): boolean {
    const admins = this.identity
      .usersInTenant(user.tenantId)
      .filter((u) => u.roles.includes("admin") && u.active !== false);
    return admins.length === 1 && admins[0].id === user.id;
  }

  // Mirror an updated identity user back into its persisted credential record.
  private syncCred(user: User): void {
    const cred = this.credForUserId(user.id);
    const nextCred: CredentialRecord = { ...cred, user };
    this.credByEmail.set(cred.email, nextCred);
    this.persistCred(nextCred);
  }

  // Best-effort tenant display name (falls back to the id) for credential records.
  private tenantNameFor(tenantId: string): string {
    for (const cred of this.credByEmail.values()) {
      if (cred.user?.tenantId === tenantId) return cred.tenantName;
    }
    return tenantId;
  }

  // ---- S92: superadmin provisioning (platform operator, cross-tenant) ----

  // Provision (or promote) the platform superadmin at boot. Idempotent:
  //  - if the email is unregistered, create it in a dedicated platform tenant
  //    with the superadmin role and the given password;
  //  - if it already exists, ensure it carries the superadmin role.
  // Returns the resulting user. Never exposed as a self-service path — callers
  // wire this from a trusted boot env (AF_SUPERADMIN_EMAIL/PASSWORD).
  provisionSuperadmin(email: string, password: string, opts?: { tenantId?: string; tenantName?: string }): User {
    const norm = normalizeEmail(email);
    const existing = this.credByEmail.get(norm);
    if (existing) {
      const current = this.identity.getUser(existing.userId);
      if (current.roles.includes("superadmin")) return current;
      const nextRoles: Role[] = [...current.roles, "superadmin"];
      const updated = this.identity.updateUser(current.id, { roles: nextRoles });
      this.syncCred(updated);
      return updated;
    }
    if (password.length < 8) throw new WeakPasswordError();
    const tenantId = opts?.tenantId ?? "platform";
    const tenantName = opts?.tenantName ?? "Platform";
    if (!this.identity.hasTenant(tenantId)) this.identity.createTenant({ id: tenantId, name: tenantName });
    const userId = `${tenantId}:${norm}`;
    const user: User = { id: userId, tenantId, email: norm, roles: ["superadmin"], active: true };
    this.identity.createUser(user);
    const { salt, hash } = hashPassword(password);
    const cred: CredentialRecord = { userId, email: norm, salt, hash, user, tenantName };
    this.credByEmail.set(norm, cred);
    this.persistCred(cred);
    return user;
  }

  // S92: provision a brand-new tenant with its first (admin) user. Used by the
  // platform console. Throws if the tenant id or the email already exists.
  provisionTenant(input: { tenantId: string; tenantName: string; adminEmail: string; adminPassword: string }): { tenant: Tenant; admin: User } {
    if (this.identity.hasTenant(input.tenantId)) throw new DuplicateTenantError(input.tenantId);
    const result = this.register({
      tenantId: input.tenantId,
      tenantName: input.tenantName,
      email: input.adminEmail,
      password: input.adminPassword,
    });
    return { tenant: this.identity.getTenant(input.tenantId), admin: result.user };
  }

  // S92: suspend / reactivate a tenant. Suspending revokes all live sessions of
  // that tenant's users so access is cut immediately.
  setTenantStatus(tenantId: string, status: "active" | "suspended"): Tenant {
    const tenant = this.identity.setTenantStatus(tenantId, status);
    if (status === "suspended") {
      for (const [token, rec] of [...this.sessions]) {
        if (rec.tenantId === tenantId) {
          this.sessions.delete(token);
          this.dropSession(token);
        }
      }
    }
    return tenant;
  }
}
