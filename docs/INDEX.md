# Documentation Index

A map of AgentFoundry's documentation. Start with the **Getting started** row, then dive
into whichever area you need. Project-meta files (contributing, changelog, conduct, security
policy, license) live at the repository root.

## Getting started

| Doc | What it covers |
|-----|----------------|
| [`../README.md`](../README.md) | Project overview, the wedge, what runs today, quick start, the Golden Thread |
| [`CODE_WALKTHROUGH.md`](CODE_WALKTHROUGH.md) | Step-by-step tour of the whole system |
| [`USER_GUIDE.md`](USER_GUIDE.md) | Per-role walkthrough of every screen (superadmin / admin / user) |
| [`../deploy/DEPLOY.md`](../deploy/DEPLOY.md) | Run locally and deploy publicly |
| [`SEED_MANIFEST.md`](SEED_MANIFEST.md) | The seed agent (Acme Support Bot) walked end-to-end |

## Architecture & core engine

| Doc | What it covers |
|-----|----------------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System architecture and the engine/LLM boundary |
| [`AGENT_SDLC.md`](AGENT_SDLC.md) | The Design → … → Retire lifecycle spine |
| [`SCORING.md`](SCORING.md) | Deterministic weighted scoring + provenance |
| [`COST_AND_CERTIFICATION.md`](COST_AND_CERTIFICATION.md) | Cost governance + certification badges/tiers |
| [`REGISTRY_AND_MONITORING.md`](REGISTRY_AND_MONITORING.md) | Registry, lifecycle, lineage, drift, regression gate |
| [`MARKETPLACE.md`](MARKETPLACE.md) | Publishable packs, catalog, interoperable consume |
| [`VERSIONING_SCHEDULING_AUDIT.md`](VERSIONING_SCHEDULING_AUDIT.md) | Versioning/diff/rollback, scheduler, audit-backed events |

## Security & compliance

| Doc | What it covers |
|-----|----------------|
| [`SECURITY.md`](SECURITY.md) | Architectural security model |
| [`THREAT_MODEL.md`](THREAT_MODEL.md) | Threat enumeration and controls |
| [`SECURITY_REVIEW_PACK.md`](SECURITY_REVIEW_PACK.md) | Buyer/auditor security review pack |
| [`IDENTITY_AND_RBAC.md`](IDENTITY_AND_RBAC.md) | Tenants, users, roles → permissions, isolation |
| [`SECRETS_AND_CONNECTORS.md`](SECRETS_AND_CONNECTORS.md) | Per-tenant vault, masking, rotation, connectors |
| [`GUARDRAIL_AND_LLM.md`](GUARDRAIL_AND_LLM.md) | Guardrail classifier + LLM adapter contract |
| [`SANDBOX.md`](SANDBOX.md) | Enforced sandbox (egress allowlist, tool mocking, caps) |
| [`PERSISTENCE_AND_AUDIT.md`](PERSISTENCE_AND_AUDIT.md) | Storage seam + tamper-evident audit ledger |
| [`DATA_GOVERNANCE.md`](DATA_GOVERNANCE.md) | Retention policies + residency controls |
| [`SAMPLE_GOVERNANCE_REPORT.md`](SAMPLE_GOVERNANCE_REPORT.md) | A real generated governance report |

## Platform, API & operations

| Doc | What it covers |
|-----|----------------|
| [`API_AND_WEBHOOKS.md`](API_AND_WEBHOOKS.md) | HTTP API + event bus + signed webhooks |
| [`HTTP_SERVER_OPENAPI_OIDC.md`](HTTP_SERVER_OPENAPI_OIDC.md) | Server binding, OpenAPI generator, OIDC |
| [`FEDERATED_AUTH_SCHEMA_BILLING.md`](FEDERATED_AUTH_SCHEMA_BILLING.md) | Federated auth, JSON-schema validation, billing |
| [`POLICY_AND_QUOTAS.md`](POLICY_AND_QUOTAS.md) | Policy-as-code, rate limiting, quotas |
| [`SCHEMA_ENFORCEMENT_ALERTS_INVOICES.md`](SCHEMA_ENFORCEMENT_ALERTS_INVOICES.md) | Route schemas, usage alerts, invoice history |
| [`OBSERVABILITY.md`](OBSERVABILITY.md) | Metrics registry + Prometheus-style export |
| [`NOTIFICATIONS.md`](NOTIFICATIONS.md) | Review queue + notification routing |
| [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) | Deployment guide |
| [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) | Operator/admin guide |

## Reliability, DR & status

| Doc | What it covers |
|-----|----------------|
| [`DRIFT_HEALTH_TENANT_LIFECYCLE.md`](DRIFT_HEALTH_TENANT_LIFECYCLE.md) | Drift monitoring, health aggregation, tenant onboarding/offboarding |
| [`DRIFT_SCAN_STATUS_BACKUP.md`](DRIFT_SCAN_STATUS_BACKUP.md) | Scheduled drift scan, consolidated status, backup/restore |
| [`STATUS_ENDPOINT_SCHEDULED_BACKUP_WEBHOOKS.md`](STATUS_ENDPOINT_SCHEDULED_BACKUP_WEBHOOKS.md) | /status endpoint, scheduled backup, status webhooks |
| [`RESTORE_DRILL_SLA_AUDIT_EXPORT.md`](RESTORE_DRILL_SLA_AUDIT_EXPORT.md) | Restore drill, SLA tracking, signed audit export |
| [`AUDIT_ENDPOINT_SLA_EVAL_DR_RUNBOOK.md`](AUDIT_ENDPOINT_SLA_EVAL_DR_RUNBOOK.md) | /audit/export, scheduled SLA eval, DR runbook |
| [`ALERT_DISPATCH_BILLING_CLOSE_REPLICATION.md`](ALERT_DISPATCH_BILLING_CLOSE_REPLICATION.md) | Alert dispatch, scheduled billing close, replication/failover |
| [`STATUS_RECORDER_HISTORY_ENDPOINTS.md`](STATUS_RECORDER_HISTORY_ENDPOINTS.md) | Scheduled status recorder + history endpoints |

## Tenant config profiles & compliance pack

| Doc | What it covers |
|-----|----------------|
| [`TENANT_PROFILES_COMPLIANCE_PACK_DR_ENDPOINT.md`](TENANT_PROFILES_COMPLIANCE_PACK_DR_ENDPOINT.md) | Per-tenant config profiles, compliance pack, /dr/runbook |
| [`COMPLIANCE_ENDPOINT_PROFILE_DIFF_APPLY.md`](COMPLIANCE_ENDPOINT_PROFILE_DIFF_APPLY.md) | /compliance/pack, profile diff, apply-to-live |
| [`CONFIG_DRIFT_PROFILE_AUDIT_APPLY_ENDPOINT.md`](CONFIG_DRIFT_PROFILE_AUDIT_APPLY_ENDPOINT.md) | Config drift detection, profile-change audit, apply endpoint |
| [`CONFIG_DRIFT_SCAN_AUDITED_APPLY_HISTORY.md`](CONFIG_DRIFT_SCAN_AUDITED_APPLY_HISTORY.md) | Scheduled drift scan, audited apply, profile history |
| [`CONFIG_DRIFT_STATUS_PROFILE_TRANSFER_SNAPSHOTS.md`](CONFIG_DRIFT_STATUS_PROFILE_TRANSFER_SNAPSHOTS.md) | Drift-in-status, config export/import, compliance snapshots |
| [`PROFILE_TRANSFER_ENDPOINTS_STATUS_HISTORY_COMPLIANCE_DIFF.md`](PROFILE_TRANSFER_ENDPOINTS_STATUS_HISTORY_COMPLIANCE_DIFF.md) | Profile transfer endpoints, status history, compliance diff |

## Quality, testing & project status

| Doc | What it covers |
|-----|----------------|
| [`TESTING.md`](TESTING.md) | Test strategy and the 100% coverage gate |
| [`VISUAL_QA.md`](VISUAL_QA.md) | Cross-screen visual-QA checklist |
| [`KNOWN_GAPS.md`](KNOWN_GAPS.md) | **Honest status of every boundary** — read this |
| [`ROADMAP.md`](ROADMAP.md) | Lifecycle-OS roadmap and future direction |

## Project meta (repository root)

| File | What it covers |
|------|----------------|
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | How to contribute; the engine/LLM and coverage rules |
| [`../CHANGELOG.md`](../CHANGELOG.md) | What changed, grouped by build phase |
| [`../CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) | Contributor Covenant 2.1 |
| [`../SECURITY.md`](../SECURITY.md) | Vulnerability disclosure policy |
| [`../LICENSE`](../LICENSE) | MIT license |
| [`../tracker/SPRINT_TRACKER.md`](../tracker/SPRINT_TRACKER.md) | Per-sprint build log (S0–S118) |
| [`../tracker/TRACEABILITY.md`](../tracker/TRACEABILITY.md) | Requirement → implementation → test traceability |
