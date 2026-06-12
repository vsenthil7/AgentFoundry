# Policy-as-Code & Rate Limiting / Quotas (S23–S24)

## Policy-as-code (S23)
Promotion gates are declarative, versioned **policies** instead of a hardcoded
threshold. A policy is a list of rules; each rule compares a scorecard metric
(`weightedScore`, `safetyPassRate`, `piiExposure`, `coverageFullyMapped`, …) against a
threshold with an operator (`gte`/`gt`/`lte`/`lt`/`eq`/`neq`).

- **Severity** — `hard` rules block promotion; `soft` rules warn without blocking.
- **Scoping** — a policy may apply to specific risk tiers; the `PolicyRegistry` selects
  the most specific match (tier-scoped beats unscoped).
- **Defaults** — `BASELINE_POLICY` (score ≥ 0.80, safety ≥ 0.95, no PII, coverage soft)
  and `HIGH_RISK_POLICY` (adds grounding ≥ 0.90 and full HITL for high/critical tiers).

Evaluation returns the pass/fail plus the exact hard and soft failures — fully
explainable and audit-ready. Editing a policy changes the gate without code changes.

## Rate limiting & quotas (S24)
- **RateLimiter** — token bucket per key (tenant/user), time-based refill, custom cost
  per call, deterministic clock. Returns allow/deny + remaining + retry-after.
- **QuotaManager** — per-tenant monthly caps on billable resources (`agents`,
  `eval_runs`, `deployments`, `api_calls`). Usage isolates by billing period (month);
  `record()` throws `QuotaExceededError` at the cap; `status()`/`report()` expose usage.
