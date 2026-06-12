# Scheduled Config-Drift Scan, Audited Apply & Profile History (S65–S67)

## Scheduled config-drift scan + auto-remediation (S65)
`configDriftScanJob(id, intervalMs, deps)` builds a scheduler job (S26) that checks each
tenant for config drift (S62), alerts on divergence (S16), and — when a `remediate` function
is provided — auto-remediates by re-applying the active profile (S61), counting how many
tenants were brought back in line. `runConfigDriftScan` is callable directly. This closes the
loop: declared config that silently drifts is detected and (optionally) self-heals.

## Audited profile apply, end-to-end (S66)
`applyProfileAudited(profile, actor, deps)` combines applying a profile to live subsystems
(S61) with the profile-change audit trail (S63): a single call that makes the change effective
AND records the `profile.applied` event plus a tamper-evident ledger entry naming the applied
subsystems. Crucially, apply happens first — if it throws (partial apply), nothing is recorded
and the error rethrows, so the audit trail only ever reflects changes that actually took
effect.

## /profiles/:tenant/history endpoint (S67)
`GET /profiles/:tenant/history` serves a tenant's profile version history annotated with the
diff from each previous version (`historyWithDiffs` — the first version has a null diff). It's
restricted to the caller's own tenant (403 otherwise, 404 if unconfigured), giving a
change-review trail of how a tenant's configuration evolved.
