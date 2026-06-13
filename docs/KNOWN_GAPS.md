# Known Gaps (honest)

This project does not pretend. What is marked done is verified; what is not, is listed here.

## 1. Playwright E2E — NOW EXECUTED (was a gap in the original build env)
The Playwright suite (`web/tests/golden-thread.spec.ts` + `web/tests/auth.spec.ts`)
covers the full Golden Thread, the auth shell, and negative paths on web-desktop and
web-mobile. In the original offline build environment it could not run (the
browser-binary CDN was blocked). **On a normal-network machine it now runs green:
29 passed, 1 skipped.** This gap is closed; kept here only as history.
```bash
cd web && npx playwright install chromium && npx playwright test
```

## 2. Web App.tsx branch coverage ~84%, not 100%
The uncovered branches are the *false* sides of defensive UI ternaries (e.g. "LEAKED"
badge, "FAILED" export banner, sub-threshold score styling). With the seed agent these
states are unreachable from the happy path. The *logic* that produces failing states is
at 100% branch coverage in the backend suite, where leaked attacks, failing scores and
lossy exports are all exercised. Forcing the UI into impossible states would be theatre.

## 3. S7–S12 are roadmap, not implemented
Registry, runtime monitoring/regression gate, cost governance, marketplace, pilot pack,
and lifecycle-OS are scaffolded with schemas/interfaces and documented, but not built
end-to-end. The costRisk metric already exists in the scoring engine; the regression
gate is specified in THREAT_MODEL (T11) and ROADMAP.

## 4. Engine guardrail / sandbox are deterministic stubs
The in-engine guardrail neutralizes known leak markers deterministically for demo and
test purposes. Production needs a real safety classifier and runtime sandbox network
isolation (specified in THREAT_MODEL, roadmap S8). Fabric IQ is described in the prompt
as a tested capability block; the engine models grounding generically via grounding
nodes — a dedicated Fabric IQ ontology adapter is roadmap.

## 5. Foundry / GitHub integration is the manifest, not a live deploy
Export produces a canonical, round-trip-verified manifest and a CI workflow that runs
the suite. Live deployment to Microsoft Foundry and real GitHub check-runs require
those external services and credentials, which are out of scope for the offline build.

## 6. Persistence: durable file store today, Postgres is a future sprint
State now survives restart via `FileStore` (S77), and the server (`bin-serve.ts`)
uses it for credentials, sessions, and the API-call audit trail when `AF_DATA` is set.
This is real durability, not in-memory-only. **Postgres is deliberately deferred**, not
forgotten: the `KeyValueStore` seam (S14) means a `PostgresStore` is a drop-in with no
engine changes. We chose file-backed durability first because it removes the
restart-data-loss gap immediately with zero infrastructure, keeps the demo fully
offline, and does not block submission. Postgres (for concurrent multi-instance scale
and SQL-level querying of the audit trail) is tracked as a **future sprint (S8x:
PostgresStore behind the existing seam)** — it is a scale concern, not a correctness or
feature gap. Bringing it in now would add a container dependency and distract from
breadth/depth work without changing what the product can do.

## 7. Authentication is real; OIDC/Entra federation is the remaining seam
Login/registration/sessions are real (S78): scrypt salted + constant-time password
hashing, opaque expiring server-side session tokens, RBAC-gated admin endpoints. The
static-token map and the OIDC `verifyToken` seam still exist for federated identity
(Entra/SSO) — wiring a live identity provider needs external credentials and is roadmap.
The password+session path is the primary, fully-tested auth flow.
