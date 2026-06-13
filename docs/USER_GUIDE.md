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

## Roles at a glance

| Role | Sees |
|------|------|
| **superadmin** | Platform console (all tenants) + everything below |
| **admin** | Users, cockpit, dashboard, reviewer inbox, console, profile |
| **reviewer** | Reviewer inbox, console, profile |
| **composer** | Golden Thread console, profile |
| **ops** | Dashboard, cockpit (read), profile |
| **viewer** | Read-only console + profile |

Every authenticated user, regardless of role, can manage their own profile and
password (section 3).
