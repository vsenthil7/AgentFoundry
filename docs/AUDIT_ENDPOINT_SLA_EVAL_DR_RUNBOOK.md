# /audit/export Endpoint, Scheduled SLA Eval & DR Runbook (S53–S55)

## /audit/export endpoint (S53)
`GET /audit/export` serves the signed audit-export bundle (S52) over HTTP when an
`auditExportProvider` is configured on `ApiDeps`. The export is scoped to the authenticated
caller's tenant (the provider receives the resolved `tenantId`), and the endpoint returns
404 when no provider is wired. A compliance reviewer can pull a tamper-verifiable bundle
directly over the API.

## Scheduled SLA evaluation (S54)
`slaEvaluationJob(id, intervalMs, deps)` builds a scheduler job (S26) that periodically
evaluates each tracked agent's SLA over a rolling window (S51) and dispatches a breach alert
(S16) when realized uptime falls below target. `runSlaEvaluation` is callable directly. This
adds availability alerting alongside the drift (S44) and usage-anomaly (S38) alert paths —
all three feed the same notification channels.

## DR runbook generator (S55)
`DrRunbookGenerator.generate(posture)` composes the platform's DR posture — backup
retention/freshness (S48), the latest restore-drill outcome (S50), and replication status
(S40) — into a readiness-graded markdown runbook. Readiness is **not_ready** if recovery is
impossible (no backups, failed drill, or down primary), **at_risk** if degraded (lag, missing
replicas, unverified backups), else **ready**. The runbook lists warnings and a step-by-step
recovery procedure an operator can follow during an incident.
