# Identity, RBAC & Multi-tenancy (S13)

## Tenancy
Every tenant isolates all data. Users belong to exactly one tenant. Cross-tenant
access throws `TenantIsolationError` — enforced on every governed-registry action.

## Roles → permissions
| Role | Permissions |
|------|-------------|
| composer | agent:create, agent:read, agent:promote_request, marketplace:consume |
| reviewer | agent:read, agent:approve, governance:report |
| ops | agent:read, agent:deploy, agent:retire, marketplace:publish |
| admin | all of the above + admin:manage_users |
| viewer | agent:read |

A user's effective permissions are the union across their roles.

## Enforcement
`GovernedRegistry` wraps the registry; every method calls `requirePermission` and
`requireSameTenant` before delegating. No privileged action bypasses these checks.
`requestPromotion` (composer) → `approve` (reviewer) → `deploy` (ops) is the canonical
separation-of-duties flow; a single admin can also perform the whole chain.
