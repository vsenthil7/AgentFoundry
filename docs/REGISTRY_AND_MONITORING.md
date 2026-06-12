# Registry & Monitoring (S7–S8)

## S7 — Agent Registry & Lifecycle

An enterprise inventory of every agent. Each `RegistryRecord` carries ownership,
risk tier, cost center, current version, version history, immutable lineage, and the
approval record. Records are frozen; mutations produce new frozen records.

### Lifecycle state machine
```
draft ──▶ in_review ──▶ approved ──▶ exported ──▶ deployed ──▶ retired (terminal)
   ▲           │            │            │            │
   └───────────┴────────────┴────────────┴────────────┘  (any state may return to draft
                                                            or go to retired)
```
Only legal transitions are permitted; illegal ones throw `IllegalTransitionError`.
Every transition appends an immutable `LineageEntry` (from, to, actor, timestamp, note).

### Capabilities
- `register` / `get` / `has` / `list` (filter by state, owner, risk tier)
- `transition` (with optional approval record attachment)
- `publishVersion` (new version → resets to draft, records history)
- `retire` (terminal state, supports post-incident decommissioning per Gartner)
- `costRollup` (agents per cost center — governance reporting)

## S8 — Runtime Monitoring & Regression Gate

### Trace ingestion
`TraceStore` ingests `RuntimeTrace` records (grounded-accuracy, safety pass rate,
token cost, latency) and returns them per-agent in timestamp order.

### Drift detection
`detectDrift(baseline, current)` flags drift when grounded-accuracy drops > 0.05,
safety pass rate drops > 0.02, or token cost rises > 50%. Zero-cost baselines are
handled without division by zero.

### Regression gate (the safety regression process)
`regressionGate(baseline, current)` compares prior red-team results to a new run.
If any attack previously DEFENDED now LEAKS, `regressed = true` and promotion is
blocked. New attacks not in the baseline are ignored (not counted as regressions).
This is the missing "safety regression process" the problem statement calls out.

### Incidents
`IncidentLog` captures drift/regression incidents per agent for audit.
