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

interface CredentialRecord {
  readonly userId: string;
  readonly email: string;
  readonly salt: string; // hex
  readonly hash: string; // hex
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
  private rehydrate(): void {
    for (const key of this.store!.keys("auth:cred:")) {
      const rec = JSON.parse(this.store!.get(key)!) as CredentialRecord;
      this.credByEmail.set(rec.email, rec);
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
    const cred: CredentialRecord = { userId, email, salt, hash };
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
    const user = this.identity.getUser(cred.userId);
    return this.mintSession(user);
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
}
