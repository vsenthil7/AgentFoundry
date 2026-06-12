# Testing

Four layers, mapped to the user's coverage targets.

| Layer | Tool | Where | Status |
|-------|------|-------|--------|
| Unit | Vitest | backend/tests | 100% lines/branches/functions/statements |
| Functional | Vitest | backend/tests + golden_thread.test.ts | full Golden Thread |
| Negative | Vitest | every validation/refusal path | all error codes asserted |
| Component | Vitest + jsdom + Testing Library | web/tests-component | runs in CI here |
| E2E | Playwright | web/tests | web-desktop + web-mobile; see KNOWN_GAPS |

## Run

```bash
cd backend && npx vitest run --coverage   # engine, 100% gate
cd web && npx vitest run --coverage        # component (jsdom)
cd web && npx playwright test              # E2E (needs browser binaries)
```

## Coverage gate

`backend/vitest.config.ts` enforces 100% on lines, branches, functions, statements.
`src/types.ts` (type-only, no runtime code) and `src/index.ts` (barrel) are excluded.

## Differentiator tests
- `scoring.test.ts` — tamper test (computed-not-theatrical), flake quarantine
- `eval.test.ts` / `golden_thread.test.ts` — remove-the-source (grounding)
- `promotion_export.test.ts` — round-trip fidelity, immutable approval record
- `redteam.test.ts` — anti-weaponization classifier, coverage matrix
