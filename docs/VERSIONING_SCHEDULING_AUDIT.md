# Versioning, Scheduling, Audited Events & API Policy (S25–S28)

## Agent versioning, diff & rollback (S25)
`diffDesigns(before, after)` produces an explainable structural diff: purpose, name,
SDLC fields, tool/data profiles, nodes (added/removed/modified), and edges.
`VersionHistory` records each version (approved or not), diffs against the previous
version, finds the latest approved version, and rolls back — **only to APPROVED
versions** (`RollbackError` otherwise). This gives change review + safe rollback of a
deployed agent to a known-good prior version.

## Scheduled jobs (S26)
`Scheduler` runs recurring tasks on fixed intervals, driven by an explicit clock and
`tick()` (no real timers → deterministic, offline-safe). Due jobs run in id order, with
success/failure captured into run history. This powers continuous runtime red-teaming,
drift scans, and quota resets.

## Audit-backed event store (S27)
`AuditedEventStore` writes every platform event into the S14 hash-chained ledger, so the
event history is tamper-evident: `verify()` proves it is unaltered. Combines the event
bus (S21) with the tamper-evidence of the audit ledger (S14).

## Policy enforced in the HTTP API (S28)
The `/agents/:id/approve` endpoint now evaluates the configurable policy (S23) when a
policy registry and scorecard context are supplied, returning **422** with the exact hard
failures if the gate fails. The configurable promotion gate is enforced at the API
boundary, not just available as a library.
