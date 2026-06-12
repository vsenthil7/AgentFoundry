# Route Schema Enforcement, Usage Alerts & Invoice History (S35–S37)

## Route-level schema enforcement (S35)
`schemaValidationMiddleware(schemas)` matches each request by method + structural path
(`:id` matches a segment) and validates the body against the route's JSON schema (S33),
returning **400** with path-specific `details` before the handler runs. Enabled per API
instance via `ApiDeps.validateBodies`; `AGENTFOUNDRY_BODY_SCHEMAS` declares schemas for the
mutating endpoints (agent registration, approval). The API now self-enforces its
documented contract.

## Usage alerts & anomaly detection (S36)
`UsageAlertEngine` produces two alert kinds over the shared `QuotaResource` model:
- **quota_threshold** — warning/critical when usage crosses configurable fractions of the
  limit (defaults 80% / 95%).
- **usage_spike** — critical when the current period exceeds `mean * factor` of a rolling
  baseline, guarded by a minimum sample count to avoid early false positives.
`evaluate()` runs both and returns all fired alerts in deterministic order.

## Invoice persistence & history (S37)
`InvoiceStore` persists invoices (S34) per tenant/period: `save` rejects duplicates,
`upsert` overwrites a recomputed period, `history` lists chronologically, `summary` gives
invoice count + lifetime total + periods, and `periodOverPeriod` reports the delta and
percentage vs the prior period. The `Invoice` type is fully readonly — financial records
are immutable once stored.
