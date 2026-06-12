# Persistence & Tamper-evident Audit Ledger (S14)

## Persistence
`KeyValueStore` is the storage interface; `InMemoryStore` is the default. A DB-backed
store (Postgres, Cosmos, etc.) implements the same shape with no other code changes.
`Repository<T>` provides typed save/load/remove/all over any KeyValueStore.

## Tamper-evident audit ledger
The ledger is a SHA-256 hash chain: each entry's hash is computed over its fields plus
the previous entry's hash (genesis = 64 zeros). Any change to any past entry — a
mutated approval score, a removed entry, a forged hash — breaks the chain and is
detected by `verify()` / `verifyChain()`, which report the exact sequence number where
the chain first breaks.

This upgrades approvals from "immutable objects in RAM" to a provably-untampered,
exportable audit trail suitable for compliance review.

```
entry[n].hash = sha256(seq | ts | actor | action | subject | detail | entry[n-1].hash)
```
