# AgentFoundry — Requirement → Test Traceability Matrix

**Purpose:** prove every capability claim is backed by an executing test, with a direct
requirement → source module → test file → assertion-count link. This is the audit trail a
reviewer or buyer uses to confirm the product is tested, not asserted.

**Verification environment:** Windows 11, Node v24.16.0, normal network.
**Last verified:** 2026-06-12.

## Headline numbers (re-runnable)
| Surface | Command | Result |
|---|---|---|
| Backend unit/functional/negative | `cd backend && npx vitest run --coverage` | 82 files · **997 tests** · 100% lines/branches/funcs/stmts |
| Run the whole product locally | `make run` (or `cd backend && npm run serve`) | API + web console on http://localhost:8080 |
| Web component (jsdom) | `cd web && npx vitest run --coverage` | 4 files · 45 tests · authClient/AuthGate/AdminConsole 100% lines/branches; App.tsx branch 77% |
| Web production build | `cd web && npm run build` | 44 modules, succeeds |
| Offline Golden Thread | `cd backend && npx tsx src/bin-demo.ts` | 79 steps, zero network |
| Playwright E2E (desktop+mobile) | `cd web && npx playwright test` | **29 passed, 1 skipped** (incl. auth shell) |

## Coverage discipline
The 100% gate is enforced in `backend/vitest.config.ts` (`thresholds: lines/functions/branches/statements = 100`).
Presentation/entry files (`index.ts`, `types.ts`, `bin-demo.ts`, `demo.ts`, `gen-governance-report.ts`)
are smoke-tested via `tests/demo.test.ts` and excluded from the strict gate (their defensive
branches mirror states already at 100% in the engine units). A build that drops below 100% on any
gated module fails CI.

## Requirement → module → test mapping

| # | Requirement (capability) | Source module | Test file | Tests |
|---|---|---|---|---|
| R01 | Deterministic graph compile + SDLC/cycle/wiring validation | `compiler.ts` | `compiler.test.ts` | 12 |
| R02 | Purpose → deterministic eval-case generation + run harness | `eval.ts` | `eval.test.ts` | 5 |
| R03 | Battle-Mode red team, OWASP/ATLAS/NIST mapping, anti-weaponization refusal | `redteam.ts` | `redteam.test.ts` | 9 |
| R04 | Deterministic weighted scoring with provenance (tamper test) | `scoring.ts` | `scoring.test.ts` | 8 |
| R05 | Human promotion gate + immutable approval record | `promotion.ts` | `promotion_export.test.ts` | 6 |
| R06 | Export to Foundry manifest, round-trip fidelity | `export.ts` | `promotion_export.test.ts` | (shared) |
| R07 | Agent registry, lifecycle state machine, lineage, retirement | `registry.ts` | `registry.test.ts` | 21 |
| R08 | Runtime monitoring, drift detection, regression gate, incident log | `monitoring.ts` | `monitoring.test.ts` | 15 |
| R09 | Cost governance + certification badges/tiers | `cost.ts`, `certification.ts` | `cost.test.ts`, `certification.test.ts`, `cost_cert_integration.test.ts` | 10+9+3 |
| R10 | Marketplace: publish/catalog/tier-gate/interoperable consume | `marketplace.ts` | `marketplace.test.ts`, `marketplace_interop.test.ts` | 19+2 |
| R11 | Governance report (live aggregation) | `governance.ts` | `governance.test.ts` | 16 |
| R12 | Identity, RBAC, multi-tenancy, tenant isolation | `identity.ts`, `governed_registry.ts` | `identity.test.ts`, `governed_registry.test.ts` | 19+15 |
| R13 | Persistence seam + tamper-evident hash-chain audit ledger | `persistence.ts` | `persistence.test.ts` | 17 |
| R14 | Real guardrail classifier (injection/PII/jailbreak/secret) + LLM adapter | `guardrail.ts`, `llm_adapter.ts` | `guardrail.test.ts`, `guardrail_integration.test.ts`, `llm_adapter.test.ts` | 16+6+14 |
| R15 | Notifications + approval routing | `notifications.ts` | `notifications.test.ts` | 16 |
| R16 | Secrets vault + connectors (MCP/OpenAPI/A2A), masking, rotation | `secrets.ts` | `secrets.test.ts` | 25 |
| R17 | Platform observability (counters/gauges/histograms/percentiles) | `observability.ts` | `observability.test.ts` | 18 |
| R18 | Data retention + residency controls | `data_governance.ts` | `data_governance.test.ts` | 21 |
| R19 | Enforced sandbox (egress allowlist, mocked tools, caps, quarantine) | `sandbox.ts` | `sandbox.test.ts` | 15 |
| R20 | Event bus + HMAC-signed webhooks, retry, filtering | `events.ts` | `events.test.ts` | 18 |
| R21 | HTTP API: router, auth/logging middleware, RBAC-gated lifecycle | `api.ts`, `api_server.ts` | `api.test.ts`, `api_server.test.ts` | 14+53 |
| R22 | Policy-as-code promotion rules + registry | `policy.ts` | `policy.test.ts`, `policy_quota_integration.test.ts` | 20+4 |
| R23 | Rate limiting (token bucket) + per-tenant quotas | `ratelimit.ts` | `ratelimit.test.ts` | 17 |
| R24 | Agent versioning, structural diff, rollback to approved | `versioning.ts` | `versioning.test.ts` | 22 |
| R25 | Deterministic scheduler (no real timers) | `scheduler.ts` | `scheduler.test.ts` | 13 |
| R26 | Node HTTP server binding (real-socket roundtrip) | `http_server.ts` | `http_server.test.ts` | 14 |
| R27 | OpenAPI 3.1 spec generator | `openapi.ts` | `openapi.test.ts` | 11 |
| R28 | OIDC/SSO token validation + JIT provisioning | `oidc.ts` | `oidc.test.ts` | 13 |
| R29 | JSON-schema validation + route-level enforcement | `schema.ts`, `schema_middleware.ts` | `schema.test.ts`, `schema_middleware.test.ts` | 21+9 |
| R30 | Billing/usage metering + invoice persistence/history | `billing.ts`, `invoice_store.ts` | `billing.test.ts`, `invoice_store.test.ts`, `billing_close.test.ts` | 15+13+6 |
| R31 | Usage alerts + anomaly detection + alert dispatch | `usage_alerts.ts`, `alert_dispatch.ts` | `usage_alerts.test.ts`, `alert_dispatch.test.ts` | 15+10 |
| R32 | Data replication + failover | `replication.ts` | `replication.test.ts` | 20 |
| R33 | Behavioral drift monitoring vs approved baseline | `behavioral_monitor.ts` | `behavioral_monitor.test.ts` | 13 |
| R34 | Platform health aggregation + /healthz | `health.ts` | `health.test.ts` | 13 |
| R35 | Tenant onboarding/offboarding (transactional) | `tenant_lifecycle.ts` | `tenant_lifecycle.test.ts` | 11 |
| R36 | Backup/restore (DR), drill, scheduled backup | `backup.ts`, `restore_drill.ts`, `scheduled_backup.ts` | `backup.test.ts`, `restore_drill.test.ts`, `scheduled_backup.test.ts` | 15+10+5 |
| R37 | SLA/uptime tracking + scheduled evaluation | `sla.ts`, `sla_eval.ts` | `sla.test.ts`, `sla_eval.test.ts` | 12+5 |
| R38 | Signed audit export + DR runbook generator | `audit_export.ts`, `dr_runbook.ts` | `audit_export.test.ts`, `dr_runbook.test.ts` | 9+14 |
| R39 | Per-tenant config profiles, diff, apply, audited apply | `tenant_profile.ts`, `profile_apply.ts`, `audited_profile.ts`, `audited_apply.ts` | `tenant_profile.test.ts`, `profile_apply.test.ts`, `audited_profile.test.ts`, `audited_apply.test.ts` | 23+6+6+3 |
| R40 | Config drift detection + scheduled scan | `config_drift.ts`, `config_drift_scan.ts` | `config_drift.test.ts`, `config_drift_scan.test.ts` | 6+7 |
| R41 | Consolidated platform status, history, recorder, webhooks | `platform_status.ts`, `status_history.ts`, `status_recorder.ts`, `status_webhooks.ts` | matching `*.test.ts` | 14+7+7+7 |
| R42 | Compliance pack, snapshot, snapshot diff | `compliance_pack.ts`, `compliance_snapshot.ts`, `compliance_diff.ts` | matching `*.test.ts` | 8+6+10 |
| R43 | Tenant config export/import (profile transfer) | `profile_transfer.ts` | `profile_transfer.test.ts` | 10 |
| R44 | Audit-backed event store | `audited_events.ts` | `audited_events.test.ts` | 7 |
| R45 | **Durable file-backed persistence (survives restart)** — S77 | `file_store.ts` | `file_store.test.ts` | 12 |
| R46 | **Authentication: register/login/logout/sessions + admin UI** — S78 | `auth.ts`, `api_server.ts` (+web `auth/authClient.ts`, `auth/AuthGate.tsx`) | `auth.test.ts`, `auth_api.test.ts` (+web `authClient.test.tsx`, `AuthGate.test.tsx`, e2e `auth.spec.ts`) | 20+15 backend, 8+13 web, 5 e2e |
| R47 | **Runnable server + API-call audit trail** — S79 | `bin-serve.ts`, `api_audit.ts` | `api_audit.test.ts` (server entrypoint verified live, excluded from gate) | 7 |
| R48 | **PostgresStore (durable + multi-instance scale)** — S81 | `postgres_store.ts` | `postgres_store.test.ts` | 11 |
| R49 | **Agent circuit breaker (runtime containment / auto-suspend)** — S82 | `circuit_breaker.ts` | `circuit_breaker.test.ts` | 16 |
| R50 | **Web admin console: users / API-audit / circuit-breaker operator view** — S83 | web `auth/AdminConsole.tsx` (+ `authClient.ts` getAuditTrail/getBreakers/resetBreaker) | web `AdminConsole.test.tsx`, `authClient.test.tsx`, e2e `auth.spec.ts` | 12+3 component, 1 e2e |
| R51 | **Live rate-limit enforcement (429 + Retry-After, per-principal)** — S84 | `rate_limit_middleware.ts` (wires `ratelimit.ts` into the live server) | `rate_limit_middleware.test.ts` | 12 |
| R52 | **Live-data demo seed (populated operator console on first load)** — S85 | `demo_seed.ts` | `demo_seed.test.ts` | 6 |
| R53 | **Agent run-replay (record + deterministic decision replay)** — S86 | `run_replay.ts` | `run_replay.test.ts` | 10 |
| R-INT | End-to-end integrations (golden thread, lifecycle, policy+quota) | (engine) | `golden_thread.test.ts`, `lifecycle_integration.test.ts`, `policy_quota_integration.test.ts`, `edge_cases.test.ts` | 6+3+4+12 |

## Differentiator tests (the claims that distinguish this from a demo)
| Claim | Proven by |
|---|---|
| Score is computed, not theatrical | `scoring.test.ts` tamper test (hand-verified math) |
| Grounding measurably reduces hallucination | demo step [3]/[4]: grounded-accuracy 1.000 → 0.000 with Foundry IQ off |
| Export is the real artifact | `promotion_export.test.ts` round-trip byte-identical |
| Red team refuses to weaponize | `redteam.test.ts` anti-weaponization (rejects third-party/external targets) |

## Web E2E traceability (Playwright)
`web/tests/golden-thread.spec.ts` — runs on `web-desktop` + `web-mobile` projects:
- masthead/pipeline render · canvas valid graph · coverage matrix fully mapped
- full walk evaluate→redteam→score→approve→export green
- every fired attack DEFENDED with a framework ID
- remove-the-source lowers grounded accuracy in the UI
- audit log records each action
- **negative:** score/approve/export gated until prerequisites met; rejecting at human gate blocks export
- mobile: usable on narrow viewport

## Open items (honest — see docs/KNOWN_GAPS.md)
- Web App.tsx branch coverage 77% (false sides of defensive UI ternaries; backend covers the failing states at 100%).
- In-memory is the default store; `FileStore` (S77) adds durability and `PostgresStore` (S81) adds multi-instance scale — all behind the same `KeyValueStore` seam, env-selected at the server.
- OIDC/Entra verifyToken seam and live Foundry/GitHub deploy require external credentials (out of offline-build scope).
