# Agent SDLC — Operating Procedure

The lifecycle every agent follows:

```
Design → Evaluate → Red Team → Approve → Export → Deploy → Monitor → Regress → Retire
```

## SDLC controls (on every design)
- **version** — semantic version of the design
- **owner** — accountable individual/team
- **risk tier** — low / medium / high / critical (drives grounding + permission rules)
- **cost center** — for cost governance and ROI views
- **tool-permission profile** — read / write / send per tool
- **data-access profile** — which data sources the agent may touch
- **lifecycle state** — draft → in_review → approved → exported → deployed → retired

## Gates
1. **Threshold gate** — weighted score ≥ 0.80.
2. **Human gate** — a named reviewer must approve; no agent promotes itself.
   The approval record is immutable (frozen) and carries reviewer, version, score, time.
3. **Regression gate** (runtime, S8) — a regressed prior attack blocks promotion.

## Policy rules enforced at compile time
- High/critical risk tier ⇒ a grounding source is required.
- Any write/send tool permission ⇒ a HITL gate is required.
- Send-scope tools are disallowed at low risk tier.
