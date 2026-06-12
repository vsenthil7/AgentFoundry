# Scheduled Status Recorder & History Endpoints (S74–S76)

## Scheduled status recorder (S74)
`statusRecorderJob(id, intervalMs, deps)` builds a scheduler job (S26) that periodically
assembles the consolidated platform status (S45) from injected inputs and records it into the
status history (S72) — so the trend builds automatically without manual sampling. When the
recorded state is degraded or down, it alerts (S16) with the active flags. The alert body uses
the status flags directly, since any non-healthy state always carries at least one.

## /status/history endpoint (S75)
`GET /status/history` serves the status-history trend summary (samples, trend, state
fractions; S72) over HTTP when a provider is configured (404 otherwise). Operators get the
short-horizon time series, not just the current snapshot.

## /compliance/history endpoint (S76)
`GET /compliance/history` serves a tenant's archived compliance snapshots (S70) and the latest
posture diff (S73) over HTTP when configured (404 otherwise). Completes the compliance API
surface: point-in-time pack (/compliance/pack) plus the historical series and what changed.
