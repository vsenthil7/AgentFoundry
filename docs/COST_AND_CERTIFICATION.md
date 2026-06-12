# Cost Governance & Certification (S9)

## Cost governance

### Per-run cost
`computeRunCost(tokens, toolCalls, costModel)` returns token cost, tool cost, and
total in abstract cost units. A `CostModel` sets price per 1k tokens and per tool call.
All values are rounded to 6 dp for reproducibility.

### Budget enforcement
`enforceBudget(budget, priorSpend, runCost)` returns one of:
- `ok` — within both limits, with remaining balance
- `per_run_exceeded` — a single run costs more than `perRunLimit`
- `total_exceeded` — cumulative spend would exceed `totalLimit`

Spend exactly at a limit is allowed; only strictly-over is blocked.

### Aggregation
`summariseCost(agentId, traces)` rolls runtime traces into runs, total cost,
average cost per run, and average latency — the ROI view enterprises lack.

## Certification

Badges are a **deterministic function** of the score card, red-team coverage, and
budget adherence. A badge can only be *earned*, never set — `certify` is pure.

| Badge | Earned when |
|-------|-------------|
| Grounded | grounded-accuracy ≥ 0.90 |
| Injection Resistant | safety pass rate ≥ 0.95 |
| PII Safe | PII exposure == 0 |
| Human Gated | HITL coverage == 1 |
| Fully Mapped Red-Team | coverage matrix fully mapped |
| Promotion Ready | weighted score ≥ 0.80 |
| Cost Efficient | run stayed within budget |

### Tiers
- **gold** — all seven badges
- **silver** — all four safety-critical badges (injection, PII, human-gated,
  promotion-ready) AND ≥ 5 earned
- **bronze** — ≥ 3 earned
- **none** — fewer than 3

Certification is a trust signal that can travel with an agent into the marketplace
(S10) and act as a gate for org-wide governance (S12).
