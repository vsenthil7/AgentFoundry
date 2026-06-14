# AgentFoundry

**Agent Design, Evaluation, Safety & Lifecycle Operating System.**
Building an agent and proving it safe are the *same* workflow.

Track: Creative Apps (GitHub Copilot) · IQ: Foundry IQ (grounding) + Fabric IQ.

## The wedge

Most tools help you *build* an agent. AgentFoundry treats build and safety as one
shift-left workflow on a real lifecycle/CI spine:

```
Design → Evaluate → Red Team → Approve → Export → Deploy → Monitor → Regress → Retire
```

## What runs today

- **Engine** (`backend/`, 84 modules at 100% test coverage): graph compiler, eval
  generation + run harness, Battle Mode red-team with OWASP/ATLAS/NIST mapping,
  deterministic weighted scoring with provenance, human promotion gate, Foundry manifest
  export, agent registry with lifecycle state machine + lineage, runtime monitoring with
  drift detection + regression gate, cost governance + certification, marketplace,
  identity/RBAC/multi-tenancy, tamper-evident audit ledger, secrets vault, data
  residency/retention, SLA tracking, compliance pack + signed audit export, billing +
  invoicing, rate-limit + quota enforcement, circuit breakers, run-replay, scheduled jobs,
  backup/restore + DR runbook, and a framework-free HTTP API with real authentication
  (scrypt passwords, server-side sessions) and a real JWKS/RS256 Microsoft Entra OIDC
  verifier.
- **Web console** (`web/`, React + Vite, 35 source modules): a role-aware operator
  product — one sidebar, sign-in/registration, the Golden Thread composer, profile &
  security self-service, tenant user admin, superadmin platform console, reviewer inbox,
  health dashboard, and read/manage screens for secrets, billing, SLA, compliance, status
  trend, data governance, and the marketplace. Responsive to mobile; keyboard-navigable.
- **Offline demo**: `make demo-offline` walks the seed agent end-to-end, zero network.

**Verification (this build):** 1156 backend tests at 100% (lines/branches/functions/
statements) · 314 web component tests · 42 Playwright E2E tests (web + mobile) · both
TypeScript projects clean · production web build green. See `docs/KNOWN_GAPS.md` for the
honest status of every boundary.

## Quick start

```bash
make install      # install backend + web deps
make test         # backend unit/functional/negative (100% coverage gate)
make test-web     # web component tests (jsdom)
make demo-offline # walk the Golden Thread with no network
make dev          # run the web console at http://localhost:5173
make e2e          # Playwright web + mobile (needs browser binaries; see docs/KNOWN_GAPS.md)
make run          # build web + serve API & console on ONE port (http://localhost:8080)
```

## Run the whole product

```bash
make run                       # http://localhost:8080 — login, register a tenant admin, use it
AF_DATA=./data make serve      # same, with durable storage (survives restart)
```

Login / registration / multi-role admin are real (scrypt passwords, server-side
sessions, RBAC). Every API call is recorded to a metadata-only audit trail
(`GET /audit/api`, admin). To deploy publicly to Vultr, see `deploy/DEPLOY.md`.

## The Golden Thread (definition of "submittable")

Seed agent **Acme Support Bot**, walked: compose → declare purpose → auto-generate evals
→ Battle Mode (injection + PII-exfil, each framework-tagged) → measured failures →
wire Foundry IQ + PII guardrail → re-measure (scores move) → toggle Foundry IQ off
(grounded-accuracy measurably falls) → reviewer approves → export → CI runs the suite
green → registry shows it with lineage.

## Differentiator tests

| Test | What it proves |
|------|----------------|
| Tamper test | Score is *computed* from known outputs, not theatrical |
| Remove-the-source | Grounding measurably lowers hallucination (1.000→0.000) |
| Round-trip fidelity | Export is the real artifact, not a lossy cosmetic dump |
| Anti-weaponization | Red-team refuses external / third-party targets |

## Docs

**Start here:** `docs/INDEX.md` (a map of all documentation), `docs/CODE_WALKTHROUGH.md`
(step-by-step tour of the whole system) and `deploy/DEPLOY.md` (run & deploy).

`docs/ARCHITECTURE.md` · `docs/THREAT_MODEL.md` · `docs/SCORING.md` · `docs/MARKETPLACE.md` ·
`docs/AGENT_SDLC.md` · `docs/REGISTRY_AND_MONITORING.md` · `docs/COST_AND_CERTIFICATION.md` ·
`docs/DEPLOYMENT_GUIDE.md` · `docs/ADMIN_GUIDE.md` · `docs/USER_GUIDE.md` · `docs/SECURITY.md` ·
`docs/SECURITY_REVIEW_PACK.md` · `docs/SAMPLE_GOVERNANCE_REPORT.md` · `docs/TESTING.md` ·
`docs/ROADMAP.md` · `docs/KNOWN_GAPS.md` · `docs/SEED_MANIFEST.md`

Project conventions: `CONTRIBUTING.md` · `CHANGELOG.md` · `CODE_OF_CONDUCT.md` · `SECURITY.md`

## License

MIT — see `LICENSE`.
