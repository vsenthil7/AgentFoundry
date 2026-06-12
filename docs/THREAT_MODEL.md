# Threat Model

Scope: the AgentFoundry platform itself, and the agents it designs/evaluates.

## Assets
- Tenant agent designs, eval suites, red-team suites, approval records.
- Grounding sources / knowledge bases referenced by designs.
- Synthetic test data used during sandboxed evaluation.

## Trust boundaries
1. **User ↔ platform** — authenticated tenant users compose and review.
2. **Platform ↔ model adapter** — outputs are untrusted; never used to decide pass/fail.
3. **Platform ↔ sandbox** — evaluated agents run with no real side effects by default.
4. **Platform ↔ export target (Foundry/GitHub)** — manifests are signed artifacts.

## Primary threats and mitigations

| # | Threat | Mitigation | Status |
|---|--------|-----------|--------|
| T1 | Red-team weaponized against third-party systems | `classifyTarget` + refusal on non-own-design targets; tested | **enforced** |
| T2 | Score gaming / theatrical scoring | Deterministic engine; tamper test asserts computed math | **enforced** |
| T3 | Agent self-promotion | Human gate required in addition to threshold; no auto-promote | **enforced** |
| T4 | Unsafe write/send capability shipped | Compiler blocks write/send without a HITL gate | **enforced** |
| T5 | Prompt injection / system-prompt leak | Battle Mode battery (LLM01); guardrail node neutralizes markers | **enforced (engine)** |
| T6 | PII exfiltration | PII-exfil attack (LLM06); PII-exposure score | **enforced (engine)** |
| T7 | Hallucination in customer-facing output | Grounding required for high/critical tiers; remove-the-source test | **enforced** |
| T8 | Lossy/altered export | Round-trip fidelity test | **enforced** |
| T9 | Flaky eval masking a regression | Flake quarantine threshold; surfaced not hidden | **enforced** |
| T10 | Tool-scope over-permissioning | Tool-scope risk score; unsafe-permission compiler check | **enforced** |
| T11 | Runtime drift after deploy | Regression gate re-runs prior suite; drift detection | **enforced (S8)** |
| T12 | Connector/network egress from sandbox | Enforced sandbox: allowlist, mocked tools, budgets, quarantine | **enforced (S20)** |

## Anti-weaponization (the ethical spine)

The red-team may target **only the user's own design**. `classifyTarget` returns
`third_party` when either an `externalSystem` is named or the target design id does
not match the design under test; `runBattle` throws `AntiWeaponizationError`. This is
tested with adversarial cases (external system + foreign design id).

## Residual risks
- Engine-level guardrail is a deterministic stub; production needs a real classifier.
- Sandbox network isolation is specified but enforced at runtime (S8), not in-engine.
- Framework mappings cover the shipped battery; coverage gaps are reported honestly by
  `buildCoverageMatrix`, never hidden.
