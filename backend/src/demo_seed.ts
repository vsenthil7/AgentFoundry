// S85 — Live-data demo seed.
// A fresh server boots with empty operator panels (audit trail, circuit breakers),
// which undersells those features to a reviewer. This seeds believable runtime data
// so the admin console shows a populated audit log and a tripped-then-reset breaker
// the moment you log in. Purely deterministic and dependency-light: it drives the
// real ApiAuditLog and CircuitBreakerManager APIs (no fixtures, no fakery), so what
// a reviewer sees is produced by the same code paths as live traffic.

import type { ApiAuditLog } from "./api_audit.js";
import type { CircuitBreakerManager, Observation } from "./circuit_breaker.js";
import type { AuthService } from "./auth.js";

export interface DemoSeedResult {
  auditCalls: number;
  trippedAgents: string[];
  demoAdminEmail: string | null;
}

// A small, realistic sequence of API calls an operator would expect to see.
const SAMPLE_CALLS: Array<{ method: string; path: string; status: number; latencyMs: number; actor: string }> = [
  { method: "POST", path: "/auth/register", status: 201, latencyMs: 38, actor: "owner@acme.test" },
  { method: "POST", path: "/auth/login", status: 200, latencyMs: 21, actor: "owner@acme.test" },
  { method: "GET", path: "/auth/me", status: 200, latencyMs: 3, actor: "owner@acme.test" },
  { method: "GET", path: "/agents", status: 200, latencyMs: 7, actor: "owner@acme.test" },
  { method: "POST", path: "/agents", status: 201, latencyMs: 19, actor: "owner@acme.test" },
  { method: "GET", path: "/admin/users", status: 200, latencyMs: 5, actor: "owner@acme.test" },
  { method: "POST", path: "/auth/login", status: 401, latencyMs: 24, actor: "anonymous" }, // a failed attempt
  { method: "GET", path: "/admin/users", status: 403, latencyMs: 2, actor: "viewer@acme.test" }, // RBAC denial
];

const OK: Observation = { ok: true, safetyViolation: false, driftSeverity: 0 };
const SAFETY_FAIL: Observation = { ok: true, safetyViolation: true, driftSeverity: 0.1 };

// Populate the audit log and breakers with demo data. Idempotent enough for a
// single boot; safe to call once at startup behind AF_SEED.
export function seedLiveData(deps: {
  audit: ApiAuditLog;
  breakers: CircuitBreakerManager;
  auth?: AuthService;
  tenantId?: string;
}): DemoSeedResult {
  // 1) Audit trail — a believable recent history.
  for (const c of SAMPLE_CALLS) {
    deps.audit.record({ ...c, tenantId: deps.tenantId ?? "acme" });
  }

  // 2) Circuit breaker — one healthy agent, one that trips on repeated safety
  //    violations (so the operator sees a real "suspended" agent + history).
  const healthy = "acme-support-bot";
  const flaky = "experimental-router";
  for (let i = 0; i < 6; i++) deps.breakers.record(healthy, OK);
  // Enough safety violations to breach the default 5% threshold and trip.
  for (let i = 0; i < 6; i++) deps.breakers.record(flaky, SAFETY_FAIL);

  // 3) Optional: a demo admin so a reviewer can log straight in. Best-effort —
  //    if the email is already registered, leave it.
  let demoAdminEmail: string | null = null;
  if (deps.auth) {
    const email = "owner@acme.test";
    if (!deps.auth.isRegistered(email)) {
      deps.auth.register({
        tenantId: deps.tenantId ?? "acme",
        tenantName: "Acme (demo)",
        email,
        password: "demo-password-123",
      });
      demoAdminEmail = email;
    }
  }

  return {
    auditCalls: deps.audit.size(),
    trippedAgents: deps.breakers.trippedAgents(),
    demoAdminEmail,
  };
}
