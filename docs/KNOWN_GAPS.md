# Known Gaps (honest)

This project does not pretend. What is marked done is verified; what is not, is listed here.

## 1. Playwright E2E not executed in the build environment
The Playwright suite (`web/tests/golden-thread.spec.ts`) is complete and covers the
full Golden Thread plus negative paths on web-desktop and web-mobile. It was **not run
here** because the build environment blocks the Playwright browser-binary CDN
(network policy: `host_not_allowed`) and no system Chromium is present.

**To run it:** on any machine with normal network access:
```bash
cd web && npx playwright install chromium && npx playwright test
```
The web app builds and serves; the same flows are verified here at the component level
in jsdom (`web/tests-component/App.test.tsx`, 8 tests), so the logic is covered even
though real-browser rendering is not asserted in this environment.

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
