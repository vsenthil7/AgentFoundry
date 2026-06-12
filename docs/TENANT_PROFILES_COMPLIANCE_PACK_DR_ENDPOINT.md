# Tenant Profiles, Compliance Pack & DR Endpoint (S56–S58)

## Per-tenant config profiles (S56)
`TenantProfileStore` bundles a tenant's operational config — promotion `policyId`, quota
limits, retention/residency policy, and SLA target — into a versioned, validated
`TenantProfile`. Each `set` produces a new immutable version (config is deep-copied so
caller mutations don't leak in); `rollback(tenant, v)` re-applies a prior version's config
as a new version. Same change-control discipline applied to agents (S25), now for tenant
configuration.

## Consolidated compliance pack (S57)
`CompliancePackGenerator.generate(input)` assembles one buyer/auditor-ready markdown bundle
from four sources: a governance summary (agent/incident counts), the signed audit export
(S52), the tenant config profile (S56), and the DR runbook (S55, embedded in full). It
answers a procurement/security review's "show me your controls" with a single artifact.

## /dr/runbook endpoint + SLA-in-status (S58)
`GET /dr/runbook` serves the DR recovery procedure (S55) over HTTP when a provider is
configured (404 otherwise). Separately, the consolidated platform status (S45) now accepts an
optional SLA rollup: SLA breaches add an operator flag and escalate a healthy platform to
**degraded**, so availability misses surface in the top-level status alongside drift
regressions.
