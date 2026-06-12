# Secrets & Connector Credentials (S17)

## Secrets vault
Per-tenant credential storage. Secrets are **never** returned in plaintext through
list/inspect APIs — only masked (`sk…wxyz`, head + tail, middle redacted; short
secrets fully redacted). Writes (put/rotate) require `admin:manage_users`; all access
is tenant-isolated. Plaintext is resolved only at use time via `resolve()`, which is
access-checked.

## Connectors
Connectors (`mcp` / `openapi` / `a2a`) declare an endpoint and the `secretId` they
need. Registration validates the referenced secret exists and is in the same tenant.
`resolveConnectorSecret()` fetches the plaintext credential at call time — credentials
never sit in the connector definition. Production swaps the in-memory store for a KMS /
secret manager behind the same interface.
