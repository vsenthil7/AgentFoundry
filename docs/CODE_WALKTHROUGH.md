# AgentFoundry — Code Walkthrough

A step-by-step tour of what the project is, how it is structured, and what
happens when the system runs. Written so a reviewer or buyer can understand the
whole thing without reading all 8,500 lines of engine code.

**At a glance (verified, this environment):**
- Backend: 77 TypeScript engine modules, 77 test files, **942 tests at 100%** coverage (lines/branches/functions/statements)
- Web console: React + Vite, **30 component tests**, builds to a static bundle
- E2E: Playwright **29 passed, 1 skipped** (desktop + mobile)
- Runnable: `make run` serves API + console on one port; deployable to Vultr via `deploy/`

---

## 1. What AgentFoundry *is*

AgentFoundry is an **agent design, evaluation, safety, lifecycle and governance
platform** — the system an enterprise uses to decide whether an AI agent is safe
to ship, then to govern it for its whole life. It is built for the Microsoft
Agents League "Creative Apps / Copilot" track.

The product answers one question rigorously: *"Is this agent good enough and safe
enough to promote to production — and can we prove it later?"*

---

## 2. The one principle that defines the architecture

> **The deterministic engine decides pass/fail. LLMs never do.**

Every score, every gate, every promotion decision is computed by plain
deterministic code from raw evidence — not by asking a model "is this good?".
LLMs are used only to *produce* candidate outputs (and in production, to *explain*
results). The judgment is code.

This matters because enterprise governance needs **provenance**: when a regulator
or a CISO asks "why did this agent pass?", the answer is a formula and its inputs,
not "the model felt confident." You can see this directly in `backend/src/scoring.ts`:

```
export interface ScoreProvenance {
  metric: string; value: number; formula: string; inputs: Record<string, number>;
}
```

Every metric in a ScoreCard carries the exact formula and inputs used. The
weighted score is a fixed linear combination (`WEIGHTS` in the same file), and the
promotion threshold is a constant (`PROMOTION_THRESHOLD = 0.8`). Nothing is
discretionary.

---

## 3. Repository layout

```
AgentFoundry/
├── backend/            TypeScript engine (the product's brain)
│   ├── src/            77 modules — domain logic, all deterministic
│   │   ├── bin-demo.ts   offline Golden Thread walk (no network)
│   │   └── bin-serve.ts  runnable HTTP server (API + web console)
│   └── tests/          77 test files, 100% coverage gate enforced
├── web/                React + Vite console
│   ├── src/
│   │   ├── App.tsx       the Golden Thread console UI
│   │   ├── engine/       client-side mirror of the engine (offline-first)
│   │   └── auth/         AuthGate, authClient — login/register/admin shell
│   ├── tests-component/  jsdom component tests
│   └── tests/            Playwright E2E (desktop + mobile)
├── deploy/             Dockerfile-driven Vultr deployment
├── docs/               KNOWN_GAPS, threat model, roadmap, this file
└── tracker/            SPRINT_TRACKER + TRACEABILITY (requirement→test)
```

---

## 4. The Golden Thread — the scenario that defines "submittable"

The Golden Thread is one named, CI-gated, end-to-end scenario: **the "Acme Support
Bot" goes from a design to a promoted, exported, deployed agent.** It is walked by
`backend/src/bin-demo.ts` in **79 steps with zero network access**. Run it:

```bash
cd backend && npm run demo     # or: make demo-offline
```

The thread, step by step:

1. **Compose & compile** (`compiler.ts`). The agent is a graph of nodes
   (grounding → guardrail → prompt → model → human-in-the-loop). The compiler
   validates wiring, **rejects cycles** (Kahn's algorithm), and rejects unsafe
   SDLC combinations. It produces a deterministic execution order.
2. **Purpose → evals** (`eval.ts`). From the declared purpose, the engine
   *generates* deterministic evaluation cases and runs them.
3. **Grounded run** (`eval.ts` + grounding). With grounding ON, grounded-accuracy
   is 1.000.
4. **Remove-the-source** — toggle grounding OFF and accuracy **measurably drops to
   0.000**. This is a differentiator test: it proves grounding is doing real work,
   not decoration.
5. **Battle Mode red-team** (`redteam.ts`). Known attacks (prompt injection, PII
   exfiltration, jailbreak, tool abuse) are fired; each is mapped to OWASP LLM /
   MITRE ATLAS / NIST framework IDs. All are DEFENDED.
6. **Coverage matrix** — every attack class is mapped (CI-gated: an unmapped attack
   fails the build).
7. **Deterministic scoring** (`scoring.ts`). The weighted score is computed from
   raw results with full provenance; it clears the 0.8 threshold.
8. **Human promotion gate** (`promotion.ts`). A human approves; an immutable
   approval record is written.
9. **Export + round-trip** (`export.ts`). A Foundry manifest is produced and
   verified byte-identical on re-serialize (lossless).
10. **Registry & lifecycle** (`registry.ts`). The agent moves through its lifecycle
    state machine to "deployed" with full lineage.

Steps 11–79 extend this through monitoring, cost governance, marketplace,
multi-tenancy, RBAC, persistence, billing, SLA, DR, compliance packs, and the
auth + audit work added in S77–S80.

---

## 5. The anti-weaponization guard (a safety differentiator)

The red-team engine (`redteam.ts`) will **only attack the user's own design.**
Pointing it at a third-party system is refused:

```
// Anti-weaponization: the red-team may ONLY target the user's own design.
// Pointing it at an external/third-party system must be refused.
export class AntiWeaponizationError extends Error { ... }
```

This means the safety tooling cannot itself be turned into an attack tool against
someone else's system — a governance property a buyer will look for.

---

## 6. What happens when a real HTTP request comes in (S78–S79)

The runnable server is `backend/src/bin-serve.ts`. A request flows like this:

```
HTTP request
   │
   ▼
[ static? ]  ──yes──►  serve web console from web/dist (SPA fallback to index.html)
   │ no (API path)
   ▼
Router (api.ts)
   │
   ▼
auth middleware  ── public /auth/* exempt; else resolve Bearer token:
   │                 1) OIDC claims (if configured)   2) AuthService session
   │                 3) static token map  → 401 if none resolve
   ▼
[ body-schema validation ]  (optional, 400 on contract violation)
   ▼
route handler  ── resolves the user, checks RBAC permission, calls the
   │              governed engine module, returns JSON
   ▼
audit middleware (bin-serve)  ── records who/method/path/status/latency
   │                              (metadata only — never bodies)
   ▼
HTTP response
```

### Authentication (`auth.ts`)
- Passwords are **never stored**. We store `scrypt(password, per-user random salt)`.
  scrypt is memory-hard; the salt defeats rainbow tables; verification is
  constant-time (`timingSafeEqual`) so timing can't leak.
- Sessions are opaque 256-bit random tokens with expiry, held server-side and
  revocable on logout. The token encodes no identity — it indexes a session.
- The **first user of a tenant becomes admin**; subsequent users default to viewer.
- Durable: backed by the `KeyValueStore` seam, so credentials and sessions survive
  restart when a `FileStore` is supplied.

### RBAC (`identity.ts`)
Five roles (`composer`, `reviewer`, `ops`, `admin`, `viewer`) map to fixed
permission sets. Every privileged action calls `requirePermission`. Tenants
isolate all data; cross-tenant access throws `TenantIsolationError`. The
`/admin/users` endpoint requires `admin:manage_users` and returns **403** otherwise.

### API-call audit trail (`api_audit.ts`)
Every handled call is recorded with a monotonic sequence number, timestamp, actor,
tenant, method, path, status and latency — **metadata only, never request or
response bodies**, so secrets and PII never land in the audit log. Queryable and
durable; readable by admins at `GET /audit/api`. This is the "what was called /
what came back" trail for later audit.

---

## 7. Persistence: the swap-in seam (S77)

All state sits behind one tiny interface (`persistence.ts`):

```
export interface KeyValueStore {
  get(key): string | null;  set(key, value): void;
  delete(key): boolean;     keys(prefix?): string[];
}
```

- `InMemoryStore` — default, for dev/offline/tests.
- `FileStore` (S77) — durable JSON-on-disk with **atomic writes**
  (write-temp-then-rename, so a crash mid-write never corrupts the store).
  Survives restart.
- `PostgresStore` — **documented future sprint** (KNOWN_GAPS §6). Because every
  module depends only on the interface, Postgres drops in with **zero engine
  changes**. We chose file-backed durability first: it removes restart-data-loss
  immediately, keeps the demo offline, and doesn't block submission. Postgres is a
  scale concern, not a correctness gap.

---

## 8. The web console (`web/`)

The console is React + Vite. It is **offline-first**: `web/src/engine/` mirrors the
engine so the Golden Thread runs entirely in the browser for the demo. On top of
that, S78 added an auth shell:

- `auth/AuthGate.tsx` — renders the **login** and **registration** screens when
  logged out; once authenticated, a session bar, the console, and (for admins) a
  **multi-role admin user panel**.
- `auth/authClient.ts` — thin, injectable HTTP client for `/auth/*` and
  `/admin/users`. Tokens are held in memory, never localStorage.

The whole thing is gated: visit `/`, you see login first. Register → you're the
admin → you see the admin panel and the full console.

---

## 9. How quality is enforced

- **100% coverage gate** (`backend/vitest.config.ts`): lines, branches, functions
  and statements must all be 100% or CI fails. Entry-point/presentation files
  (`bin-demo.ts`, `bin-serve.ts`, barrel, types) are excluded and smoke-tested
  instead. Dead defensive branches are removed, not fake-covered.
- **Type-check gate**: `tsc --noEmit` catches what tests miss (wrong field names
  producing silent `undefined`, float-precision bugs, unreachable states).
- **Traceability**: `tracker/TRACEABILITY.md` maps every requirement (R01–R47) to
  the exact module and test file that proves it, with assertion counts.
- **Honest gaps**: `docs/KNOWN_GAPS.md` records what is *not* done, deliberately.

---

## 10. Running and deploying

```bash
# Run everything locally on one port (http://localhost:8080)
make run                       # build web + serve API+console

# With durable storage
AF_DATA=./data make serve

# Full CI sweep
make ci                        # backend tests + web tests + build + offline demo

# Deploy to Vultr (public)
./deploy/deploy-vultr.ps1      # from the laptop, or deploy-vultr.sh on the server
```

See `deploy/DEPLOY.md` for the full runbook.

---

## 11. Where to start reading the code

If you have ten minutes, read these four files in order — they are the spine:

1. `backend/src/compiler.ts` — how an agent design is validated into an executable graph.
2. `backend/src/scoring.ts` — the deterministic, provenance-carrying judgment.
3. `backend/src/redteam.ts` — Battle Mode + the anti-weaponization guard.
4. `backend/src/bin-serve.ts` — how it all becomes a running, authenticated, audited service.

Then run `npm run demo` in `backend/` and watch the 79-step Golden Thread print.
