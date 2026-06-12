# /status Endpoint, Scheduled Backup & Status Webhooks (S47–S49)

## /status API endpoint (S47)
`GET /status` serves the consolidated operator status (S45) over HTTP when a
`statusProvider` is configured on `ApiDeps`. It returns **503** when the platform state is
down (so load balancers route away) and **404** when no provider is wired. Verified over a
real socket via the bound HTTP server (S29) — operators get the full health/agents/reviews/
drift/billing view from one call.

## Scheduled backup job (S48)
`scheduledBackupJob(id, intervalMs, deps)` builds a scheduler job (S26) that periodically
snapshots a `KeyValueStore` (S46) into a `BackupVault`. The vault enforces bounded retention
(`maxBackups`, oldest evicted), giving automated, retained disaster-recovery snapshots with
no external cron. `runScheduledBackup` is callable directly.

## Status transition webhooks (S49)
`StatusTransitionWatcher.observe(state)` is edge-triggered: it records the platform state and,
**only when it changes**, publishes a platform event via the event bus (S21) —
`platform.degraded`, `platform.down`, or `platform.recovered` — with the from/to states and
direction (improved/degraded). The first observation establishes a baseline without firing.
Webhook subscribers are notified on real state changes, not on every poll.
