# Config Drift, Profile Audit Trail & Apply Endpoint (S62–S64)

## Config drift detection (S62)
`detectConfigDrift(profile, probe)` reads live subsystem settings through an injected
`LiveConfigProbe` (quota limits, retention days, allowed regions, SLA target) and compares
them to the tenant's active profile (S56), producing explainable drift findings with
expected/actual values. Regions are compared order-insensitively; missing live state counts
as drift. This catches out-of-band changes — a quota bumped or a region added directly —
that diverge from the declared profile. Distinct from behavioral drift (S41), which is about
agent quality.

## Profile-change audit trail (S63)
`auditProfileAction(deps, action, actor, profile, detail)` records a profile lifecycle action
(`updated` / `applied` / `rolledback`) by appending a tamper-evident audit ledger entry (S14)
and publishing a platform event (S21). Configuration changes become first-class, attributable
to an actor, and provable in the same audit trail as agent promotions.

## /profiles/:tenant/apply endpoint (S64)
`POST /profiles/:tenant/apply` applies the caller's config profile to live subsystems (via an
injected `profileApplyHandler`, typically wrapping S61). Callers may only apply their own
tenant's profile (403 otherwise); 404 when no handler is configured. Config changes can now be
made effective over the API.
