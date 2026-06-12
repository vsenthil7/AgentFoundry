# Behavioral Drift, Health & Tenant Lifecycle (S41–S43)

## Behavioral drift monitoring (S41)
`BehavioralMonitor` captures an agent's approved scorecard as a baseline at promotion, then
`analyze(agentId, observed)` compares a live scorecard against it, emitting a
`BehavioralDriftReport` with per-metric findings (baseline, observed, delta), a worst
severity, and a `regressed` flag set when any major/critical drop occurs. This is agent
quality/behavior drift — distinct from the usage anomalies of S36 — and feeds the continuous
red-teaming scheduler (S26).

## Platform health aggregation (S42)
`HealthAggregator` composes `HealthProbe`s into a single `HealthReport`. Ships
`replicationProbe` (S40 status) and `queueDepthProbe` (review backlog). A **down critical**
component fails the whole platform; a down non-critical one **degrades** it. Exposed at
`GET /healthz`, which returns 503 when the platform state is down — suitable for load
balancers and uptime monitors.

## Tenant onboarding/offboarding (S43)
`TenantLifecycle.onboard(req)` provisions a new tenant end to end in one ordered transaction:
tenant record, admin user, quota limits, and retention/residency policy — returning the list
of provisioned subsystems (and failing with the partial list via `OnboardingError` if a step
throws). `offboard(tenantId)` removes the tenant and cascade-deletes its users. Turns the
multi-module setup a new customer needs into a single call.
