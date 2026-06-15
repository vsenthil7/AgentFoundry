# AgentFoundry — User Guide

AgentFoundry is an agent design, evaluation, safety, lifecycle, and governance
platform. The deterministic engine decides pass/fail; LLMs explain but never
gate. This guide walks every screen by role: **superadmin** (cross-tenant
platform operator), **admin** (tenant administrator), and **user**
(composer / reviewer / ops / viewer).

> Demo sign-in: on the login screen press **"Use demo account
> (owner@acme.test)"** — it logs you straight into a seeded tenant admin so you
> can explore without typing credentials.

---

## 1. Signing in (everyone)

1. Open the app. You land on the **Sign in** screen — a centered card with the
   AgentFoundry mark, email + password fields, and a **Sign in** button.
2. To create a brand-new tenant instead, press **"Need an account? Register"**.
   The form adds **Tenant ID** and **Tenant name** fields; the first user of a
   new tenant becomes its **admin**. A live password-strength read-out appears as
   you type the password (too short → weak → okay → strong).
3. Press **Sign in** (or **Register**). On success you land in the authenticated
   shell with a **session bar** showing your email, a role pill, and your tenant.
4. Bad credentials show an inline error and keep the console hidden. Sign out any
   time from the **Sign out** button in the session bar.

---

## 1a. Getting around (the sidebar) — everyone

Once signed in, every screen lives behind one **role-aware sidebar** on the left
(it collapses to a ☰ drawer on narrow/mobile viewports). You only ever see the
destinations your role can use:

- **Console**, **Profile**, and **Marketplace** — everyone.
- **⚔ Battle Arena** — everyone (the creative headline; see §1b).
- **Reviews** — reviewers and admins.
- **Users**, **Secrets**, **Billing**, **SLA**, **Compliance**, **Data**,
  **Cockpit** — admins.
- **Dashboard** and **Trend** — ops and admins.
- **Platform** — superadmins.

---

## 1b. Battle Arena — compose, watch, share (everyone)

The **⚔ Battle Arena** is the creative front door. It turns the red-team engine
into a watchable duel — and every verdict is the deterministic engine's, never
invented (see `docs/CREATIVE_NARRATIVE.md` for the judge-facing story).

1. **Loadout (compose-your-defender).** Toggle the agent's defences —
   **Injection + PII guardrail** and **Knowledge grounding**. A live risk badge
   reads **HARDENED**, **PARTIAL**, or **EXPOSED**, with a one-line explanation.
   These toggles switch *real* nodes on the agent design — they are not cosmetic.
2. **Send into the arena.** Press **⚔ Send into the arena**. The chosen agent
   faces the attack battery.
3. **Watch it fight.** Use **Begin battle** / **Next attack** to reveal rounds one
   by one, or **Play to end**. Each round shows the attacker's intent, the agent's
   response, why it matters, the framework chips (OWASP / ATLAS / NIST), and a
   verdict — **DEFENDED**, **BREACHED**, or **FLAKED**. The shield and the running
   defend-rate update live. **Replay** restarts the same deterministic battle.
4. **ScoreCard.** At the climax a screenshot-able card summarises the battle:
   defend-rate, per-class results, the frameworks exercised, and — only when truly
   earned — the certification tier. Its **↻ Replay this battle** button re-runs it.

> Honesty note: with the safe demo model a guardrail-off agent can still defend,
> because the model never emits a leak marker. The risk badge still warns
> **EXPOSED** — the badge is a prediction; the battle verdict is the engine's
> measured result. The guardrail's breach effect shows against a model that would
> otherwise leak.

The sidebar is keyboard-operable: focus a nav item and use **↑/↓** to move
(wrapping), **Home/End** to jump to the first/last, **Enter/Space** to open it;
on mobile, **Esc** closes the drawer. The active screen is marked for screen
readers (`aria-current`). The default landing view is the Console, which also
shows the admin operator cockpit for admins.

---

## 2. The Golden Thread console (composer / admin)

This is the core agent-SDLC pipeline, rendered as a guided **stepper**:
`Compose → Evaluate → Red team → Score → Approve → Export`. Each stage is a card.

1. **Canvas** — shows the agent graph (model / grounding / guardrail / HITL
   nodes) and whether it compiles (a green **VALID** badge). Press
   **"Auto-generate evals & run"** to begin. **"Foundry IQ: ON/OFF"** toggles
   grounding so you can *see* grounded-accuracy drop when the source is removed.
2. **Evaluation** — lists the deterministically generated cases and the resulting
   **grounded-accuracy** banner (green ≥ 0.5, red below).
3. **Battle Mode / Red team** — shows the OWASP/ATLAS/NIST coverage matrix; press
   **"Fire attack battery"**. Each attack shows **DEFENDED** or **LEAKED**.
4. **Safety Radar / Score** — press **"Compute deterministic score"** to get the
   weighted score plus its five provenance metrics (grounded-accuracy, safety
   pass rate, consistency, HITL coverage, tool-scope risk).
5. **Human Promotion Gate** — **Approve** promotes the agent; **Reject** blocks
   it. The decision is recorded immutably.
6. **Export** — **"Export + verify round-trip"** serializes the Foundry manifest
   and confirms lossless fidelity. A green export then walks the **Registry**
   (lifecycle → deployed with lineage), runs the **regression gate**, computes a
   **certification** tier + badges, and publishes a **marketplace** pack that is
   re-consumed to prove interoperability.
7. **Audit Log** — every action you took, in order, at the bottom.

---

## 3. Your profile & security (everyone)

The **Profile** screen has three cards:

1. **Your identity** — your email, tenant, role badges, and session expiry.
2. **Profile** — edit your display name and email, then **Save profile**. Email
   uniqueness is re-checked; your session survives the change.
3. **Change password** — enter your current password, then a new one twice. A
   live strength hint guides the new password and the **Change password** button
   stays disabled until the current password is present, the new one is at least
   8 characters, and both copies match. On success, other sessions are signed out
   and the count is reported.

---

## 4. Tenant administration (admin)

The **Users** screen manages the people in *your* tenant:

1. The table lists each user's email, name, role badges, and active status.
2. **Add user** opens a modal: enter an email, an optional display name, and tick
   one or more roles. On create, a **temporary password is shown once** in a
   dismissible banner — copy it and share it securely.
3. **Roles** (per row) opens a modal to change a user's role set; **Save roles**
   is disabled if you remove every role.
4. **Reset password** issues a fresh temp password (shown once).
5. **Deactivate** blocks a user from signing in (their sessions are revoked);
   **Reactivate** restores access. The last active admin of a tenant cannot be
   removed or demoted.

---

## 5. The operator cockpit (admin)

The admin **cockpit** is a tabbed card:

1. **Users** — the tenant's users with their roles.
2. **API audit** — total calls, error count, error-rate badge, and the most
   recent calls (method, path, status, latency, actor).
3. **Circuit breakers** — runtime containment. Healthy agents show an all-clear
   banner; a tripped agent shows a **Reset** button and the transition history
   explains why it tripped.
4. **Run replay** — recorded agent invocations with their safe/unsafe verdict.
   **Replay** re-runs the guardrail over the stored output and shows whether the
   decision **reproduced** or **diverged** (the signal that rule logic changed).

---

## 6. Platform health dashboard (admin / ops)

The **dashboard** composes the consolidated platform status with the API audit
summary into one operator view:

1. A **state pill** — HEALTHY (green), DEGRADED (amber), or DOWN (red).
2. **Progress bars** for agents deployed and healthy components.
3. **Metric cards** — pending reviews, drift regressions (red when present), and
   billing for the period.
4. **API traffic** — error rate and average latency.
5. **Operator attention** — each active flag as a banner (the most severe first),
   or an all-clear banner when the platform is nominal.

---

## 7. Reviewer inbox (reviewer / admin)

The **Reviews** inbox is the human-in-the-loop queue:

1. The table lists pending reviews — the agent, who requested promotion, and a
   weighted-score badge (green/amber/red by threshold).
2. **Review** opens a detail modal with the agent, score, and tenant.
3. **Approve** promotes; **Reject…** reveals a required-reason field — the
   **Confirm rejection** button stays disabled until you give a reason. The
   reason is recorded with the decision and emitted as an event.
4. When the queue is empty you see "No pending reviews — you're all caught up."

---

## 8. Platform operations (superadmin only)

The superadmin **Platform** console operates across *all* tenants:

1. The table lists every tenant with its ID, user count, and status.
2. **Users** (per row) drills into any tenant's users (cross-tenant read).
3. **Provision tenant** creates a brand-new tenant plus its first admin; the
   admin's **temporary password is shown once**.
4. **Suspend** opens a confirm modal and warns that suspending revokes the
   tenant's users' sessions and blocks their sign-in; **Reactivate** restores it.
   Superadmins themselves are never blocked by a suspension.

---

## 9. Secrets & connectors (admin)

The **Secrets** screen manages the per-tenant credential vault:

1. **Secrets** — each stored secret's name, ID, **masked** value (only the first
   couple and last few characters are shown; plaintext is never returned over the
   API), and when it was created.
2. **Add secret** opens an inline form (ID, name, value). The value field is a
   password input and is shown **only here, at entry** — it is never returned by
   the API afterward, only the masked handle. **Create** stays disabled until all
   three fields are filled; a duplicate ID is reported as an error.
3. **Rotate** (per row) reveals a new-value field and replaces the stored value;
   the response is masked. **Delete** (per row) removes a secret — but the API
   blocks deletion with an error if a connector still references it, so you can't
   orphan a connector.
4. **Connectors** — registered MCP / OpenAPI / A2A connectors with their kind,
   endpoint, and which secret they reference. Credentials resolve only at connector
   use time, server-side.

---

## 10. Billing & invoices (admin)

The **Billing** screen reads the metering and invoice history:

1. **Current period** — the live invoice computed from this period's metered usage,
   with priced line items (resource, quantity, unit price, amount) and the period
   total. All money is held in integer minor units and formatted for display.
2. **Lifetime** — total billed across all stored periods and the invoice count.
3. **Period over period** — the change versus the previous stored period (green when
   spend went down, amber when it went up).
4. **Invoice history** — each stored period with its subtotal and total.

---

## 11. SLA & uptime (admin)

The **SLA** screen reports realized availability per deployed agent:

1. Each agent row shows its **uptime %** (green badge when meeting target, red when
   breached), the **target** it is measured against, the **error budget** remaining
   for the window (red when negative — the budget is spent), and a **BREACHED /
   MEETING SLA** status badge.
2. The deterministic engine computes uptime from recorded up/down transitions — no
   estimation.

---

## 12. Compliance & audit export (admin)

The **Compliance** screen consolidates the governance artifacts auditors ask for:

1. **Signed audit export** — the tamper-evident audit bundle with an HMAC
   signature; a **SIGNATURE VERIFIED / UNSIGNED** badge tells you at a glance that
   the export is self-attesting, alongside the ledger-entry and event counts.
2. **Governance summary** — agents deployed / total, certified count, and open
   incidents (highlighted when any are open).
3. **Compliance pack** — the full consolidated pack (governance + audit + DR +
   config profile) rendered as readable text.
4. **Snapshot history** — archived posture snapshots over time with the latest
   diff versus the prior snapshot (what changed: readiness, deployed agents,
   incidents).

---

## 13. Status trend (ops / admin)

The live platform state is on the Dashboard (section 6); the **Trend** screen adds
the view *over time*:

1. A **trend badge** — IMPROVING / STABLE / WORSENING — comparing the current
   state to the start of the recorded window.
2. The **current state** badge and the number of samples recorded.
3. **State-fraction bars** — the share of samples spent healthy / degraded / down,
   so you can see how much time the platform spent in each state.

---

## 14. Data residency & retention (admin)

The **Data** screen surfaces the per-tenant data-governance policy:

1. **Data residency** — each region with the count of records that reside there and
   an **ALLOWED / NOT ALLOWED** badge. Placement outside an allowed region is
   rejected at write time by the engine, so this is the audit view of where data
   actually lives versus where it may.
2. **Retention policy** — each data class with its retention window (`N days`) or an
   **INDEFINITE** badge. Classes with a positive window are purged deterministically
   once records age out.

---

## 15. Marketplace (everyone)

The **Marketplace** screen browses the platform-wide pack catalog:

1. Each pack shows its name, **kind** (agent template / eval pack / red-team pack),
   publisher, version, a **certification-tier** badge (none / bronze / silver /
   gold) as a trust signal, and its **install count** (a network-effect signal).
2. A **kind filter** (All / Agent templates / Eval packs / Red-team packs) narrows
   the catalog. Browsing is available to every authenticated user — the catalog is
   platform-wide, not tenant-scoped.

---

## Roles at a glance

| Role | Sees |
|------|------|
| **superadmin** | Platform console (all tenants) + everything below |
| **admin** | Users, secrets (+ write), billing, SLA, compliance, data, cockpit, dashboard, trend, reviewer inbox, marketplace, console, profile |
| **reviewer** | Reviewer inbox, marketplace, console, profile |
| **composer** | Golden Thread console, marketplace, profile |
| **ops** | Dashboard, trend, marketplace, console, profile |
| **viewer** | Read-only console, marketplace, profile |

Every authenticated user, regardless of role, can manage their own profile and
password (section 3) and browse the marketplace (section 15).
