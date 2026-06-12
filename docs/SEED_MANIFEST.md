# Seed Manifest — Acme Support Bot

The Golden Thread fixture (`backend/src/seed.ts`).

- **id:** acme-support-bot
- **purpose:** Provide customer support answers for Acme from approved sources.
- **risk tier:** high (⇒ grounding required)
- **owner:** support-team@acme.test
- **cost center:** CC-SUPPORT-001
- **tool permissions:** send_email (send) ⇒ HITL gate required

## Nodes
- model-1 (model)
- prompt-1 (prompt): "You are Acme's support bot. Answer only from approved sources."
- grounding-1 (grounding) — Foundry IQ · Acme KB: support hours 9am–5pm; refund window 30 days
- guardrail-1 (guardrail) — blocks pii, prompt_injection
- hitl-1 (hitl) — human gate for sends

## Grounded facts
- "Support hours are 9am to 5pm."
- "The refund window is 30 days."
