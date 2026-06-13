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
}

export interface AuthSession {
  token: string;
  expiresAt: number;
  user: SessionUser;
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

  async listUsers(token: string): Promise<{ users: SessionUser[] }> {
    return (await this.request("GET", "/admin/users", undefined, token)) as { users: SessionUser[] };
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
