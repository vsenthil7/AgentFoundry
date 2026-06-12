# Profile Transfer Endpoints, Status History & Compliance Diff (S71–S73)

## Profile export/import endpoints (S71)
`GET /profiles/:tenant/export` returns the portable, checksummed config envelope (S69) for the
caller's tenant; `POST /profiles/:tenant/import` validates an envelope and imports it as a new
version. Both are restricted to the caller's own tenant (403 otherwise), 400 on a missing import
body, and 404 when unconfigured. Config promotion between environments is now a network
operation, not a manual copy.

## Platform status history (S72)
`PlatformStatusHistory` retains a bounded series of consolidated status reports (S45) and
`summary()` derives a trend — **improving / stable / worsening** — by comparing the current
state to the first in the window, plus the fraction of samples in each state. This turns the
point-in-time operator view into a short-horizon time series for dashboards and post-incident
review.

## Compliance snapshot diff (S73)
`diffCompliancePacks(before, after)` compares two archived compliance packs (S70) and reports
what changed in posture: DR readiness, deployed/certified agent counts, open incidents,
audit-record volume, and config profile version. An auditor can see exactly what moved between
two points in the snapshot time series.
