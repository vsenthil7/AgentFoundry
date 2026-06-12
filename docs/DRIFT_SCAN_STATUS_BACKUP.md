# Scheduled Drift Scan, Platform Status & Backup/Restore (S44–S46)

## Scheduled drift scan (S44)
`driftScanJob(id, intervalMs, deps)` builds a scheduler job (S26) that periodically
re-scores each deployed agent against its approved baseline (S41) and, on a regression,
notifies the recipient via a notification channel (S16). `runDriftScan` is also callable
directly. Agents without a baseline (never promoted) are skipped. This is the continuous
*quality* red-teaming counterpart to the *usage* anomaly path (S36 -> S38).

## Consolidated platform status (S45)
`PlatformStatus.assemble(inputs)` composes one operator-facing report from across the
platform: health state (S42), agent counts (S7), review backlog (S16), drift regressions
(S41/S44), and billing totals (S37). It produces severity-ordered attention flags (platform
down > degraded > regressions > pending reviews) and a one-line summary. A healthy platform
escalates to **degraded** when any agent has regressed, so quality drift surfaces in the
top-level status even when infrastructure is fine.

## Backup & restore (S46)
`createBackup(store)` snapshots any `KeyValueStore` (including the replicated store from
S40) into a checksummed, serializable `Backup`. `verifyBackup` validates integrity;
`restoreBackup` refuses a corrupted backup (`BackupIntegrityError`) and a non-empty target
(unless `allowOverwrite`). `serializeBackup`/`deserializeBackup` move backups off-box. This
gives the platform a disaster-recovery primitive over the same storage seam everything else
uses.
