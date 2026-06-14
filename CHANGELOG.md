# Changelog

All notable changes to AgentFoundry are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows a
continuous mini-sprint cadence (each sprint ships an engine module and/or screen, tests at
100% coverage, docs, and a clean commit) rather than fixed numbered releases. Sprint
numbers (S0–S118) are recorded in `tracker/SPRINT_TRACKER.md`; this file groups them into
the phases a reader cares about.

## [Unreleased]

### Phase F — live-infrastructure seams (S117–S118)
- **Real JWKS/RS256 Microsoft Entra OIDC verifier** (`backend/src/oidc_jwks.ts`). Verifies
  a JWT's RS256 signature against the provider's JWKS, enforces issuer + audience, and maps
  Entra claims (`oid`/`tid`/`email`/app roles) to AgentFoundry roles. `OidcValidator` gained
  an async path (`validateAsync`/`resolveAsync`) leaving the existing sync path untouched.
  Signature verification is proven fully offline in tests (real keypair → signed JWT →
  local JWKS). Only the live Entra tenant/client env binding remains at deploy.
- **App.tsx failure-state coverage.** The Golden Thread console now accepts injectable
  `design`/`model` props (default = seed agent), so it can drive any agent. A broken/weak
  agent test exercises the real INVALID-graph, leaked-attack, failing-score, and
  blocked-promotion paths. Branch coverage 77% → 85%; the residual is documented as
  unreachable-by-construction in `docs/KNOWN_GAPS.md`.

### Phase E — surface dormant backend capabilities in the product (S110–S116)
- New role-gated screens for every previously engine-only capability: **SLA / uptime**,
  **compliance & signed audit export**, **status trend history**, **data residency &
  retention**, and the **marketplace** (with the matching read routes where they were
  missing).
- **Secrets write-path**: the read-only secrets screen became full create / rotate / delete
  management (a connector reference blocks deletion).
- Phase E closed the honest gap between "engine built + tested" and "reachable by a reviewer
  clicking the UI."

### Phase D — unified navigation + dormant-surface wiring (S105–S109)
- **`AuthedApp` single role-aware sidebar** (`navForSession`) replacing the old stacked
  render tree; every screen reachable from one navigation with a client-side route guard.
- Secrets and billing read screens; **keyboard-operable navigation** (WAI-ARIA roving focus,
  Escape closes the mobile drawer).

### Phase B/C — design system + full SaaS redesign (S94–S104)
- A real **design system** (`ui/tokens.css`, `ui/components.tsx`, `ui/AppShell.tsx`):
  professional palette, accessible primitives (Button/Card/Badge/Table/Tabs/Field/Banner/
  Modal), sidebar shell with a responsive off-canvas drawer.
- Every screen rebuilt as a credible product: branded auth, profile & security
  self-service, tenant-admin user management, superadmin platform console, reviewer inbox,
  Golden Thread console, operator cockpit, health dashboard.
- Responsive + mobile polish (≥44px tap targets, single-column stacking), per-screen user
  guide, visual-QA checklist, verified container deploy story.

### Phase A — identity, profile & human-in-the-loop backend (S89–S93)
- Fixed the login-persistence defect (auth is now fully self-durable across restart).
- Profile self-service + password lifecycle; tenant-admin user CRUD; **superadmin**
  cross-tenant role; reviewer queue surfaced over HTTP.

### Enterprise hardening (S13–S88)
- Identity / RBAC / multi-tenancy, tamper-evident audit ledger, real guardrail + LLM
  adapter contracts, notifications, secrets vault, observability metrics, data
  governance, enforced sandbox, event bus + signed webhooks, framework-free HTTP API,
  policy-as-code, rate limiting + quotas, versioning/diff/rollback, scheduler, billing +
  invoicing, replication/failover, drift monitoring, health aggregation, backup/restore +
  DR runbook, SLA tracking, signed audit export, compliance pack, per-tenant config
  profiles, durable file + Postgres persistence, authentication + admin UI, container
  deploy, circuit breakers, run-replay, and live rate-limit/quota enforcement.

### Core platform — the Golden Thread (S0–S12)
- The agent-SDLC spine: graph compiler, deterministic eval generation + run harness, Battle
  Mode red-team (OWASP/ATLAS/NIST mapping + coverage matrix + anti-weaponization),
  deterministic weighted scoring with provenance, human promotion gate, Foundry manifest
  export with round-trip fidelity, agent registry + lifecycle + lineage, runtime monitoring
  + regression gate, cost governance + certification, marketplace, and the enterprise pilot
  pack + lifecycle-OS roadmap.

---

### Architectural invariant (every phase)
The **deterministic engine decides pass/fail; the LLM only explains.** No model output ever
gates a promotion, a score, or a safety verdict. This is enforced by the tamper test and is
the reason scores are reproducible and auditable.
