# Restore Drill, SLA Tracking & Signed Audit Export (S50–S52)

## Restore drill (S50)
`runRestoreDrill(deps)` / `restoreDrillJob(...)` take the latest retained backup (S48),
restore it into a scratch store, and verify every entry round-trips — sending a failure
alert (S16) if the checksum is bad, the restore throws, or the restored content doesn't
match. The scratch store is injectable (`scratchStore`) so production can drill against the
real store implementation, not just an in-memory stand-in. Untested backups are a liability;
this turns DR confidence into a scheduled, alerting check.

## SLA / uptime tracking (S51)
`SlaTracker` records per-agent availability transitions (up/down) and `report(agent, start,
end)` computes realized uptime over the window, the error budget remaining against a target
(default 0.99, configurable e.g. 0.999), and a breach flag. State before the window is
inferred from prior transitions; transitions must be recorded in time order. Downtime
accumulation is exact (a float-precision rounding bug in the allowed-downtime calc was fixed).

## Signed audit export (S52)
`buildAuditExport(secret, input)` bundles the tamper-evident audit ledger (S14) and platform
events (S21) into a single HMAC-SHA256-signed `AuditExportBundle`. `verifyAuditExport`
confirms the bundle wasn't altered after export (detecting tampered entries, events, or
tenant id, or a wrong secret); `summarizeAuditExport` gives a reviewer counts plus an action
breakdown. One signed artifact for a compliance reviewer.
