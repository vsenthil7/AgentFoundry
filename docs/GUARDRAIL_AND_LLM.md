# Real Guardrail & LLM Adapters (S15)

## Guardrail classifier
A real, rule-based classifier (not a stub) inspecting model output for:
- **prompt_injection** — system-prompt disclosure, injection acknowledgement
- **pii** — email, credit-card-like, SSN-like
- **jailbreak** — persona adoption ("as DAN", "developer mode")
- **secret_exposure** — API keys (sk-/AKIA/ghp_), disclosed passwords

Every verdict is explainable: it lists which rules fired and the matched span.
Categories can be selectively enabled; custom rules can be supplied; `redact()`
sanitizes matched spans. Production can swap in an ML classifier behind the same
`inspect()` contract.

## LLM adapter
The scoring engine is synchronous + deterministic (for reproducible scores). Real
LLMs are async + networked, so they live behind `AsyncModel`:
- retry policy (max attempts, backoff) + timeout with abort signal
- `ResponseCache.warm()` pre-fetches real outputs and materializes them into the
  deterministic sync `ModelAdapter` the engine scores against

This keeps scoring reproducible and CI-gateable while allowing real model calls in
the generation / live-eval phases. A real transport implements `AsyncModelTransport.send`.
