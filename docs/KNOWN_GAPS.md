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

## 2. Web App.tsx branch coverage ~77%, not 100%
As of S100 the Golden Thread console is rebuilt on the design system (guided stepper,
design-system Card/Button/Badge/Banner) with every `data-testid` preserved so the
component suite and Playwright `golden-thread.spec` stay green. The uncovered branches
are the *false* sides of defensive UI ternaries (e.g. "LEAKED" badge, "INVALID" graph,
"FAILED" export banner, sub-threshold score styling) plus a few `?? []` / `?? "neutral"`
fallbacks. With the deterministic seed agent these states are unreachable from the happy
path. The *logic* that produces failing states is at 100% branch coverage in the backend
suite, where leaked attacks, failing scores and lossy exports are all exercised. Forcing
the UI into impossible states would be theatre; App.tsx is 100% on lines/functions/
statements. Every other web module (ui/*, auth/*, profile/*, admin/*, platform/*,
reviews/*) is at 100% across all four metrics.

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

## 6. Persistence: in-memory, file, AND Postgres — all behind one seam
State sits behind the `KeyValueStore` interface (S14). Three implementations now exist:
`InMemoryStore` (dev/offline), `FileStore` (S77, durable JSON-on-disk, atomic writes),
and **`PostgresStore` (S81, durable + multi-instance scale)**. The server picks the
backend by env: `AF_PG` (Postgres) > `AF_DATA` (file) > in-memory. Because every module
depends only on the interface, switching backends needs **zero engine changes** — the
Postgres path was added without touching any of the 78 modules. PostgresStore keeps an
in-memory read cache (synchronous, preserving the contract) and write-through to
Postgres for durability, hydrating from the table on startup so state survives restart
and scales across instances sharing one database. `pg` is an optional dependency,
loaded lazily only when `AF_PG` is set, so non-Postgres builds stay dependency-free.

## 7. Authentication is real; OIDC/Entra federation is the remaining seam
Login/registration/sessions are real (S78): scrypt salted + constant-time password
hashing, opaque expiring server-side session tokens, RBAC-gated admin endpoints. The
static-token map and the OIDC `verifyToken` seam still exist for federated identity
(Entra/SSO) — wiring a live identity provider needs external credentials and is roadmap.
The password+session path is the primary, fully-tested auth flow.
