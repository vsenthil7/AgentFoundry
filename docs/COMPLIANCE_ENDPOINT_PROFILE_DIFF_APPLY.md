# /compliance/pack Endpoint, Profile Diff & Profile Apply (S59–S61)

## /compliance/pack endpoint (S59)
`GET /compliance/pack` serves the consolidated compliance pack (S57) over HTTP when a
`compliancePackProvider` is configured, scoped to the authenticated caller's tenant (404
otherwise). With `/audit/export` (S53) and `/dr/runbook` (S58), the platform now exposes its
full compliance evidence over the API.

## Tenant profile diff (S60)
`diffProfiles(before, after)` compares two `TenantProfile` versions field by field — promotion
policy, SLA target, quota limits, retention days, and allowed regions (compared
order-insensitively) — producing explainable before/after changes. This gives profile change
review the same way `diffDesigns` (S25) gives agent change review.

## Apply profile to live subsystems (S61)
`applyProfile(profile, deps)` pushes a versioned profile into the running subsystems in a
fixed order: quota limits (S24), retention/residency policy (S19), then SLA target (S51). It
returns the list of applied subsystems; if a step throws, `ProfileApplyError` names the
subsystems already applied (partial-apply visibility). This is the step that makes a config
change effective — the counterpart to onboarding (S43), which provisions a tenant from scratch.
