# HTTP API & Webhooks (S21–S22)

## Events & webhooks (S21)
A typed event bus that platform modules publish to (`agent.registered`,
`promotion.approved`, `agent.deployed`, `regression.detected`, …). Webhook
subscriptions are tenant- and event-type-filtered; delivery is HMAC-SHA256 signed
(`sha256=…`, the standard scheme) and retried with backoff. The transport is pluggable,
so delivery is deterministic offline and in CI. `verifySignature()` lets receivers
validate authenticity.

## HTTP API (S22)
A dependency-free router with path params (`/agents/:id`), a middleware chain, and
error mapping (`HttpError` → status; unexpected throws → 500). Standard middleware:
- **authMiddleware** — bearer token → user/tenant; 401 on failure.
- **loggingMiddleware** — records method/path/status.

### Endpoints (all RBAC-gated via the governed registry)
| Method | Path | Permission |
|--------|------|-----------|
| POST | /agents | agent:create |
| GET | /agents/:id | agent:read |
| GET | /agents | agent:read |
| POST | /agents/:id/promote | agent:promote_request |
| POST | /agents/:id/approve | agent:approve |
| POST | /agents/:id/deploy | agent:deploy |
| DELETE | /agents/:id | agent:retire |
| GET | /reviews | agent:read |

Each mutating endpoint publishes a platform event, so webhooks fire on real lifecycle
transitions. Tenant isolation and permission checks are enforced by the governed
registry beneath the API, so the HTTP layer inherits them automatically.
