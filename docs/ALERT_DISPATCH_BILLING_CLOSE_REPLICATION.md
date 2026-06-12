# Alert Dispatch, Scheduled Billing & Replication (S38–S40)

## Alert dispatch (S38)
`AlertDispatcher` routes usage alerts (S36) to notification channels (S16): severity maps
to recipients (warning -> ops, critical -> on-call), repeats are deduplicated within a
window (keyed by tenant:resource:kind:severity), and dispatch is ordered critical-first.
`resetWindow()` clears dedup state at the start of a new evaluation cycle. This closes the
loop from anomaly detection to actually paging an operator.

## Scheduled billing close (S39)
`billingCloseJob(id, intervalMs, deps)` builds a scheduler job (S26) that, at period close,
invoices every tenant (S34) and persists the invoice (S37). It is idempotent within a
period (`upsert`) and skips tenants with empty invoices. `runBillingClose` is also callable
directly. Billing now runs automatically on a schedule rather than on demand.

## Data replication & failover (S40)
`ReplicatedStore` wraps a primary `MemoryNode` and replica nodes: writes go to the primary
then to healthy replicas (queuing replication lag when a replica is down), reads serve from
the primary and fail over to a healthy replica when it is down, and `sync()` re-syncs
recovered replicas and clears lag. `status()` exposes node health + lag. All nodes
implement the shared `KeyValueStore` interface, so any persisted store can be replicated.
