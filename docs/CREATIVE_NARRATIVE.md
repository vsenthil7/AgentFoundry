# Creative Narrative — the 90-second story for a Creative-Apps judge

> **Track 3 · Creative Apps.** This document is the front door. It explains what a
> judge *feels* in the first 90 seconds, why it is creative, and why none of it is
> theatre — every verdict on screen is produced by the same deterministic engine
> that powers the enterprise governance depth underneath.

## The reframe

"Enterprise-grade" and "creative" are not opposites. Figma, Photoshop, and Linear
are all three at once: rigorous *and* a pleasure to use. AgentFoundry's creative
hook was always in the engine — a named red-team battery where each attack maps to
a real governance framework (OWASP LLM Top-10 · MITRE ATLAS · NIST AI RMF) and the
verdict is simply *did the agent defend?* The gap was never capability. It was
presentation: that engine rendered as a results **table**, not an **experience**.

The creative arc (S124–S128) turns that table into a watchable, playable,
shareable arena — without changing a single pass/fail decision.

## The spine: Loadout → Arena → ScoreCard

**1. Agent Loadout (compose-your-defender).** The judge picks the agent's
defences — injection/PII guardrail, knowledge grounding — and sees an honest risk
read (`hardened` / `partial` / `exposed`). These toggles are not decoration: they
switch real nodes on the agent design, so the battle that follows genuinely
reflects the choices.

**2. Battle Mode Arena (watch it fight).** The chosen agent faces the red-team
gauntlet round by round. Each attack lands, the agent's shield visibly **holds**
(green) or is **breached** (red), the framework IDs light up as chips, a running
defend-rate climbs, and a plain-language narration explains — for a non-expert —
what the attacker tried, how the agent responded, and why it matters. The climax
is the deterministic outcome banner.

**3. ScoreCard (share the verdict).** A screenshot-able results card: defend-rate,
per-class results, the frameworks exercised, and — only when genuinely earned — the
certification tier. A "replay this battle" affordance re-runs the same
deterministic battle. Nothing is invented: with no real certification passed in,
the card shows the framework coverage the battle proved, not a made-up grade.

## Why it stays honest (the anti-theatre contract)

- **The engine decides; the arena only narrates.** Every round's verdict is
  `runBattle`'s `AttackResult.passed`. "Playing" the arena only controls how many
  already-decided rounds are revealed — it never changes an outcome.
- **The tier is earned, never set.** The ScoreCard shows a certification tier only
  when a real `Certification` (from the S9 `certify()` engine) is supplied.
- **The toggles are real.** Loadout switches actual guardrail/grounding nodes on
  the agent design; the battle runs over that exact design.
- **Deterministic + offline.** The whole arc runs client-side on the web engine
  mirror and inside `make demo-offline` with zero network. Same inputs, same
  pixels, every time — which is what makes it demoable and trustworthy.

## Where to see it

- **Web console:** the headline nav item **⚔ Battle Arena** (visible to every
  role). Pick a loadout → send it into the arena → read the scorecard.
- **`make demo-offline`:** the terminal demo now *opens* with the Battle Mode
  Arena headline (Loadout → round-by-round → ScoreCard) before walking the full
  enterprise Golden Thread beneath it. The closing line still reads
  `=== Golden Thread complete · no network used ===`.

## How the creative arc maps to the judging axes

- **Creativity / UX:** the arena is the experience — a governance audit reframed as
  a watchable, playable duel on a clean enterprise design system.
- **Accuracy / Reasoning / Reliability:** the verdicts come from the deterministic
  engine with 100% test coverage; the arena cannot show an unexplained round
  (narration is compile-time-exhaustive over every attack class).
- **Community vote:** the ScoreCard is built to be screenshotted and shared.

## The depth behind the front door

Behind the arena sits the full enterprise platform the same demo walks: SDLC and
promotion gates, RBAC and multi-tenancy, tamper-evident audit, policy-as-code,
billing, DR/backup, SLA tracking, config profiles, and the compliance pack — all
deterministic, all tested. The arena is the creative way in; the governance is the
reason a buyer stays.

## Honest status

The one outstanding item is the mandatory hackathon eligibility gate: a **real
Microsoft IQ integration** (Foundry IQ). Today the "Foundry IQ" grounding is a
local fallback honestly labelled as such; wiring the live Azure AI Foundry
retrieval needs operator-supplied Azure credentials (steps in
`docs/FOUNDRY_IQ_ACCESS.md`). The creative arc is independent of that gate and is
complete and green.
