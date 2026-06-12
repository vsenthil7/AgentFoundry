# Admin Guide

## Registering agents
Every agent is registered with SDLC controls: owner, risk tier, cost center, tool and
data profiles, version. The registry enforces a guarded lifecycle state machine.

## Roles & gates
- **Composers** build and validate designs.
- **Reviewers** approve promotion (creates an immutable approval record).
- **Ops** transition approved → exported → deployed.
- **Admins** retire agents (terminal state) and run governance reports.

## Risk tiers
- high / critical require a grounding source (compile-time enforced).
- Any write/send tool permission requires a HITL gate.
- Send-scope tools are disallowed at low risk tier.

## Governance reporting
Run the governance report to get a live estate view: agents by state and risk tier,
deployed high-risk agents, approval-record coverage (audit gaps), cost rollup by
center, incidents, and marketplace posture. See SAMPLE_GOVERNANCE_REPORT.md.

## Retirement (post-incident decommissioning)
Retire an agent via the registry; the transition is recorded in immutable lineage and
the agent moves to the terminal retired state. Retired agents appear in governance
reports for audit continuity.
