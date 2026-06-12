# Config Drift in Status, Config Transfer & Compliance Snapshots (S68–S70)

## Config drift in platform status (S68)
The consolidated platform status (S45) now accepts an optional config-drift rollup. When
tenants have drifted from their declared config profile (detected by S62/S65), the status adds
an operator flag and escalates a healthy platform to **degraded** — the same treatment as SLA
breaches (S58) and behavioral-drift regressions (S44). Configuration divergence is now visible
in the single operator view, not just in scan alerts.

## Tenant config export / import (S69)
`exportProfile(profile)` serializes a tenant profile (S56) into a portable, SHA-256-checksummed
envelope; `importProfile(export, targetTenant, store)` imports it into another environment's
store as a new version, after verifying integrity (rejects tampered/corrupted envelopes) and
validating the config (rejects invalid profiles). `serializeProfileExport` /
`deserializeProfileExport` move the envelope between systems. This is how a config validated in
staging is promoted to production without hand-copying settings — and the checksum proves what
was promoted is what was tested.

## Scheduled compliance-pack snapshots (S70)
`compliancePackSnapshotJob(id, intervalMs, deps)` builds a scheduler job (S26) that periodically
generates a compliance pack (S57) into a `CompliancePackArchive` with bounded retention (oldest
evicted past `maxSnapshots`). Auditors get a time series of the platform's compliance posture —
"show me your controls, monthly, for the last year" — instead of only a point-in-time pull.
