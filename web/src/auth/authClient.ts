// S78 (web) — Auth client. Talks to the AgentFoundry backend /auth/* endpoints.
// Kept transport-thin and injectable (fetchImpl) so it is unit-testable in jsdom
// without a live server. The session token is held in memory by AuthGate, never
// in localStorage (matches the artifact storage policy and avoids XSS token theft
// in this build; a production app would use an httpOnly cookie set by the server).

export interface SessionUser {
  id: string;
  email: string;
  tenantId: string;
  roles: string[];
  // S96: optional self-service display name (present after a profile update or /me).
  displayName?: string;
}

export interface AuthSession {
  token: string;
  expiresAt: number;
  user: SessionUser;
}

// S97: the admin user-management view of a user (adds the active flag).
export interface AdminUser {
  id: string;
  email: string;
  tenantId: string;
  roles: string[];
  displayName?: string;
  active: boolean;
}

// S98: a tenant as seen by the superadmin platform console.
export interface PlatformTenant {
  id: string;
  name: string;
  status: "active" | "suspended";
  userCount?: number;
}

// S99: a human-in-the-loop review queue item (matches the backend reviewView).
export interface ReviewItem {
  id: string;
  agentId: string;
  tenantId: string;
  requestedBy: string;
  weightedScore: number;
  status: "pending" | "approved" | "rejected";
  assignee?: string | null;
  resolvedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

// S102: consolidated platform status (mirrors backend PlatformStatusReport).
export type PlatformState = "healthy" | "degraded" | "down";
export interface PlatformStatusReport {
  state: PlatformState;
  summary: string;
  health: { state: PlatformState; healthyCount: number; totalComponents: number };
  agents: { total: number; deployed: number; retired: number };
  reviews: { pending: number };
  drift: { agentsScanned: number; regressions: number };
  billing: { tenantsBilled: number; periodTotalMinor: number; currency: string };
  flags: string[];
  generatedAt: string;
}

export interface RegisterPayload {
  tenantId: string;
  tenantName: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class AuthClient {
  constructor(
    private readonly baseUrl: string = "",
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {}

  private async request(method: string, path: string, body?: unknown, token?: string): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers["authorization"] = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const msg =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `Request failed (${res.status})`;
      throw new AuthApiError(res.status, msg);
    }
    return data;
  }

  async register(payload: RegisterPayload): Promise<AuthSession> {
    return (await this.request("POST", "/auth/register", payload)) as AuthSession;
  }

  async login(payload: LoginPayload): Promise<AuthSession> {
    return (await this.request("POST", "/auth/login", payload)) as AuthSession;
  }

  async logout(token: string): Promise<void> {
    await this.request("POST", "/auth/logout", {}, token);
  }

  async me(token: string): Promise<SessionUser> {
    return (await this.request("GET", "/auth/me", undefined, token)) as SessionUser;
  }

  // S96 — profile self-service. Update display name and/or email; the server
  // re-checks email uniqueness and keeps the session valid (userId is stable).
  async updateProfile(
    token: string,
    patch: { displayName?: string; email?: string },
  ): Promise<SessionUser> {
    return (await this.request("PATCH", "/auth/profile", patch, token)) as SessionUser;
  }

  // S96 — change own password (verifies current; other sessions are revoked).
  async changePassword(
    token: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ changed: boolean; otherSessionsRevoked: number }> {
    return (await this.request("POST", "/auth/password", { currentPassword, newPassword }, token)) as {
      changed: boolean;
      otherSessionsRevoked: number;
    };
  }

  async listUsers(token: string): Promise<{ users: SessionUser[] }> {
    return (await this.request("GET", "/admin/users", undefined, token)) as { users: SessionUser[] };
  }

  // ---- S97: tenant-admin user management (admin:manage_users) ----
  // Same endpoint as listUsers but typed with the active flag for the admin screen.
  async listAdminUsers(token: string): Promise<{ users: AdminUser[] }> {
    return (await this.request("GET", "/admin/users", undefined, token)) as { users: AdminUser[] };
  }

  async adminCreateUser(
    token: string,
    input: { email: string; password: string; roles: string[]; displayName?: string },
  ): Promise<AdminUser> {
    return (await this.request("POST", "/admin/users", input, token)) as AdminUser;
  }

  async setUserRoles(token: string, userId: string, roles: string[]): Promise<AdminUser> {
    return (await this.request("PATCH", `/admin/users/${encodeURIComponent(userId)}/roles`, { roles }, token)) as AdminUser;
  }

  async deactivateUser(token: string, userId: string): Promise<AdminUser> {
    return (await this.request("POST", `/admin/users/${encodeURIComponent(userId)}/deactivate`, {}, token)) as AdminUser;
  }

  async reactivateUser(token: string, userId: string): Promise<AdminUser> {
    return (await this.request("POST", `/admin/users/${encodeURIComponent(userId)}/reactivate`, {}, token)) as AdminUser;
  }

  async resetUserPassword(token: string, userId: string, newPassword: string): Promise<{ reset: boolean }> {
    return (await this.request("POST", `/admin/users/${encodeURIComponent(userId)}/reset-password`, { newPassword }, token)) as { reset: boolean };
  }

  // ---- S98: superadmin platform console (admin:platform, cross-tenant) ----
  async listTenants(token: string): Promise<{ tenants: PlatformTenant[] }> {
    return (await this.request("GET", "/platform/tenants", undefined, token)) as { tenants: PlatformTenant[] };
  }

  async listTenantUsers(token: string, tenantId: string): Promise<{ users: AdminUser[] }> {
    return (await this.request("GET", `/platform/tenants/${encodeURIComponent(tenantId)}/users`, undefined, token)) as { users: AdminUser[] };
  }

  async provisionTenant(
    token: string,
    input: { tenantId: string; tenantName: string; adminEmail: string; adminPassword: string },
  ): Promise<{ tenant: PlatformTenant; admin: AdminUser }> {
    return (await this.request("POST", "/platform/tenants", input, token)) as { tenant: PlatformTenant; admin: AdminUser };
  }

  async suspendTenant(token: string, tenantId: string): Promise<PlatformTenant> {
    return (await this.request("POST", `/platform/tenants/${encodeURIComponent(tenantId)}/suspend`, {}, token)) as PlatformTenant;
  }

  async activateTenant(token: string, tenantId: string): Promise<PlatformTenant> {
    return (await this.request("POST", `/platform/tenants/${encodeURIComponent(tenantId)}/activate`, {}, token)) as PlatformTenant;
  }

  // ---- S99: human-in-the-loop reviewer queue (reviewer or admin) ----
  async listReviews(token: string): Promise<ReviewItem[]> {
    return (await this.request("GET", "/reviews", undefined, token)) as ReviewItem[];
  }

  async getReview(token: string, id: string): Promise<ReviewItem> {
    return (await this.request("GET", `/reviews/${encodeURIComponent(id)}`, undefined, token)) as ReviewItem;
  }

  async approveReview(token: string, id: string): Promise<ReviewItem> {
    return (await this.request("POST", `/reviews/${encodeURIComponent(id)}/approve`, {}, token)) as ReviewItem;
  }

  async rejectReview(token: string, id: string, reason: string): Promise<ReviewItem> {
    return (await this.request("POST", `/reviews/${encodeURIComponent(id)}/reject`, { reason }, token)) as ReviewItem;
  }

  // ---- S102: consolidated platform status (operator dashboard) ----
  async getStatus(token: string): Promise<PlatformStatusReport> {
    return (await this.request("GET", "/status", undefined, token)) as PlatformStatusReport;
  }

  async getAuditTrail(token: string): Promise<AuditTrail> {
    return (await this.request("GET", "/audit/api", undefined, token)) as AuditTrail;
  }

  async getBreakers(token: string): Promise<BreakerView> {
    return (await this.request("GET", "/breakers", undefined, token)) as BreakerView;
  }

  async resetBreaker(token: string, agentId: string): Promise<unknown> {
    return this.request("POST", `/breakers/${encodeURIComponent(agentId)}/reset`, {}, token);
  }

  async getRuns(token: string): Promise<{ runs: RunRecord[] }> {
    return (await this.request("GET", "/runs", undefined, token)) as { runs: RunRecord[] };
  }

  async replayRun(token: string, seq: number): Promise<ReplayResult> {
    return (await this.request("POST", `/runs/${seq}/replay`, {}, token)) as ReplayResult;
  }

  // ---- S106: secrets & connectors read surface (admin-only, masked) ----
  async listSecrets(token: string): Promise<{ secrets: MaskedSecret[] }> {
    return (await this.request("GET", "/secrets", undefined, token)) as { secrets: MaskedSecret[] };
  }

  async listConnectors(token: string): Promise<{ connectors: ConnectorDef[] }> {
    return (await this.request("GET", "/connectors", undefined, token)) as { connectors: ConnectorDef[] };
  }
}

export interface ApiCall {
  seq: number;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  actor: string;
  tenantId: string | null;
}
export interface AuditTrail {
  summary: { total: number; errors: number; errorRate: number; lastSeq: number };
  calls: ApiCall[];
}

export interface BreakerTransition {
  agentId: string;
  from: string;
  to: string;
  at: number;
  reason: string;
}
export interface BreakerView {
  tripped: string[];
  transitions: BreakerTransition[];
}

export interface GuardrailVerdict {
  safe: boolean;
  categories: string[];
}
export interface RunRecord {
  seq: number;
  agentId: string;
  version: string;
  timestamp: string;
  input: string;
  output: string;
  verdict: GuardrailVerdict;
}
export interface ReplayResult {
  seq: number;
  agentId: string;
  recomputed: GuardrailVerdict;
  reproduced: boolean;
  divergence: string | null;
}

// S106: masked secret + connector views (mirror the backend secrets module).
export interface MaskedSecret {
  id: string;
  tenantId: string;
  name: string;
  masked: string;
  createdAt: string;
}
export type ConnectorKind = "mcp" | "openapi" | "a2a";
export interface ConnectorDef {
  id: string;
  tenantId: string;
  kind: ConnectorKind;
  name: string;
  endpoint: string;
  secretId: string;
}
