# Data Retention & Residency (S19)

Per-tenant policies govern how long each data class is kept and where it may live.

## Retention
`retentionDays` sets a window per data class (`agent_design`, `eval_result`,
`audit_log`, `runtime_trace`, `incident`). `0` or unset = retain indefinitely.
`isExpired(record)` compares age (against an injectable clock) to the window;
`purgeExpired()` removes all expired records and returns their ids (sorted).

## Residency
`allowedRegions` pins a tenant's data to approved regions (`us`/`eu`/`uk`/`apac`).
`place(record)` throws `ResidencyViolationError` if the record's region is not
allowed — data physically cannot land in a disallowed region. `residencyReport(tenant)`
returns the record count per region for compliance evidence.

Production swaps the in-memory record map for region-pinned storage backends behind
the same interface; the policy logic is unchanged.
