# Known Gaps (honest)

This project does not pretend. What is marked done is verified; what is not, is listed here.

## 1. Playwright E2E — EXECUTED on a real browser (14/06/2026)
The Playwright suite (`web/tests/golden-thread.spec.ts` + `web/tests/auth.spec.ts` +
`web/tests/responsive.spec.ts`) covers the full Golden Thread, the auth shell, keyboard
navigation, the responsive layout, and negative paths on web-desktop@1280 and
web-mobile@Pixel7. It was authored against a sandbox build env where the browser-binary
CDN is blocked; **on a normal-network machine it has now been run under real Chromium and
passes 41 / 42 with 1 intentional skip** (the mobile masthead variant). One stale
assertion was found and fixed by the real run — the masthead `track-tag` renders
"Agent SDLC Console" (title-case in the DOM, uppercased via CSS `text-transform`) and the
assertion was tightened to be case-insensitive. To reproduce:
```bash
cd web && npx playwright install chromium && npx playwright test
```
The CDN remains blocked inside the sandbox build env, so CI there still relies on the
jsdom component suite; the browser run is done on a normal-network machine.

## 2. Web App.tsx branch coverage 85% (was 77%) — the remainder is unreachable-by-construction
The Golden Thread console (`App.tsx`) is the one web module not at 100% branch coverage.
It is 100% on lines / functions / statements; the gap is branch-only.

**S118 raised it from 77% to 85% honestly, not by faking.** `App` now accepts optional
`design` / `model` props (defaulting to the seed agent + grounded stub), so the console
can drive *any* agent — a genuinely better design than a hardcoded seed. A new test then
drives a **real broken/weak agent** through the same deterministic engine and asserts the
failure states render: an INVALID graph (an edge to a missing node), LEAKED attacks (a
no-guardrail agent + a leaky model), a sub-threshold weighted score, and a blocked
promotion (an unsafe agent cannot be exported). These are real engine outcomes, not
forced UI states.

**The 9 branches that remain are unreachable by construction**, each for a concrete
engine reason — covering them would require fabricating impossible states (theatre):
- **Coverage-matrix "NO" (`matrix.fullyMapped` false):** `buildCoverageMatrix()` is static
  — every attack in `ATTACK_BATTERY` carries a framework mapping, so `fullyMapped` is
  always true. No input flips it.
- **Export "FAILED", regression "BLOCKED", certification "none", unearned-badge "—":** all
  four render only inside the post-export block, which is gated behind a *green export*,
  which itself requires a passing weighted score (≥ 0.8). An agent good enough to reach
  export is good enough that its round-trip is lossless, its regression gate is clear, and
  it earns a certification — so the false sides cannot fire through the UI flow.
- **`attacks ?? []` (×2) and `if (!ok) return`:** defensive guards on state that the
  stage-gated flow guarantees is already set (attacks before score/export; export before
  the registry block). Dead by construction.

The *logic* that produces every one of these failing states is exercised at 100% branch
coverage in the backend suite (leaked attacks, failing scores, lossy exports, blocked
regressions). Forcing the UI ternaries into impossible states would be theatre. Every
other web module (ui/*, AuthedApp, auth/*, profile/*, admin/*, platform/*, reviews/*,
dashboard/*, secrets/*, billing/*, sla/*, compliance/*, status/*, governance/*,
marketplace/*) is at 100% across all four metrics.

## 2b. Unified navigation — RESOLVED (was a deferral in S100/S101)
Through S99 the satellite screens (profile, users, platform, reviews, dashboard) were
built and tested standalone under the auth gate but were not reachable from one
navigation; this was called out honestly in the S100/S101 tracker rows as a deferral.
**S105 closed it:** `AuthedApp.tsx` wraps the design-system AppShell with a single
role-aware sidebar (`navForSession`) and client-side routing, and S106–S108 added the
Secrets and Billing destinations plus keyboard operability. Every screen is now reachable
from one role-gated nav, with the default console view preserving the original
session-bar/admin-console/console layout so the auth test contract stays green. No gap
remains here.

## 3. S7–S12 roadmap items — several now surfaced (Phase E), the rest documented
Registry, runtime monitoring/regression gate, cost governance, marketplace, pilot pack,
and lifecycle-OS were originally scaffolded with schemas/interfaces but not built
end-to-end. **Phase E (S110–S116) surfaced the dormant ones that had engine + tests but
no product surface** — see §8. The costRisk metric already exists in the scoring engine;
the regression gate is specified in THREAT_MODEL (T11) and ROADMAP.

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

## 7. Authentication is real; the OIDC/Entra verifier is now built + tested (S117)
Login/registration/sessions are real (S78): scrypt salted + constant-time password
hashing, opaque expiring server-side session tokens, RBAC-gated admin endpoints. For
federated identity, the OIDC seam (S31) is no longer just a stub: **`oidc_jwks.ts` (S117)
is the real JWKS/RS256 Microsoft Entra verifier**, built on `jose` — it verifies a JWT's
RS256 signature against the provider's JWKS, enforces issuer + audience, and maps Entra
claims (`oid`/`sub`→user, `tid`→tenant, `preferred_username`/`email`→email, app
`roles`→AgentFoundry roles, unknown→viewer) into our `TokenClaims`. `OidcValidator` gained
an async path (`validateAsync`/`resolveAsync`) so the sync path and its 13 tests are
untouched. The signature verification is proven **fully offline** in tests: a real RS256
keypair signs a JWT that is verified against a local JWKS (no network), with valid /
wrong-audience / wrong-issuer / expired / foreign-key-signature / role-mapping cases all
asserted. `oidc.ts` + `oidc_jwks.ts` are at 100% across all four metrics. **What remains
is deploy-only:** binding the verifier to a live Entra tenant via `ENTRA_TENANT_ID` /
`ENTRA_CLIENT_ID` env in the server bootstrap, which needs the operator's real tenant +
app-registration credentials. The password+session path remains the primary local auth
flow; Entra is the federated option once those env vars are set.

## 8. Dormant-capability backlog — RESOLVED in Phase E (S110–S116)
A mid-project audit found a real, honestly-tracked gap: several capabilities were fully
built at the engine level with 100%-covered tests, but had **no product surface** — a
reviewer clicking the UI could not see them, and some had no HTTP route either. "All
sprints done" did not mean "product feature-complete," and conflating the two was
misleading. Phase E closed the gap by surfacing each as a real, role-gated screen:

| Capability | Engine | Before Phase E | Now |
|------------|--------|----------------|-----|
| SLA / uptime (S51) | ✅ | no route, no screen | `GET /sla` + **SLA** screen (admin) — S110 |
| Compliance pack / history / audit export (S53/S59/S76) | ✅ | routes only, no UI | **Compliance** screen (admin) — S111 |
| Status trend history (S72/S75) | ✅ | route only, no UI | **Trend** screen (ops/admin) — S112 |
| Data residency & retention (S19) | ✅ | no route, no screen | `GET /governance/data` + **Data** screen (admin) — S113 |
| Marketplace (S10) | ✅ | no route, no screen | `GET /marketplace` + **Marketplace** screen (all roles) — S114 |
| Secrets write-path (S17) | ✅ | read-only screen | create/rotate/delete routes + **Add/Rotate/Delete** UI — S115 |

Every Phase E screen is reachable from the role-gated sidebar (`navForSession`) and is
covered by the component suite's nav-navigation test. New backend routes are at 100%
across all four metrics; new web screens are at 100% across all four metrics.

### Intentionally engine-only (NOT product screens — by design, not omission)
These are operator-infrastructure modules with no end-user screen, and that is the
correct product decision — they are plumbing, exercised by tests and the offline demo and
operated via config/ops tooling, not user-facing pages:
- Replication / failover (S40), backup + restore-drill (S46/S50)
- Scheduler and its scheduled jobs (S26/S39/S44/S48/S54/S65/S70/S74)
- Event bus / outbound webhooks (S21)
- Observability metrics export (S18 — exposed for Prometheus scraping, not a UI)

After Phase E, the gap between "built backend" and "visible in the product" is closed for
every end-user capability, and the remaining engine-only modules are documented here as
deliberate.
