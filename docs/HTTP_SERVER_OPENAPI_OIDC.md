# HTTP Server, OpenAPI & OIDC (S29–S31)

## HTTP server binding (S29)
`createHttpServer(router)` adapts the framework-free Router (S22) onto Node's http
server. The IO-free core — `parseRequest` (method/path/query/JSON-or-text body, lowercased
headers) and `serializeResponse` — is unit-tested without a socket; `createListener`/
`createHttpServer` wire it to real requests, verified by an ephemeral-port roundtrip.
The router now runs as an actual service.

## OpenAPI 3.1 generator (S30)
`generateOpenApi(info, routes)` turns a declarative `RouteSpec[]` into an OpenAPI 3.1
document: `:id` params become `{id}` path parameters, permissioned routes carry
`security: [{ bearerAuth: [] }]` plus an `x-required-permission` extension, request bodies
and all declared responses are emitted, and output is deterministic regardless of input
order. `AGENTFOUNDRY_ROUTES` documents the live API; the spec drives client generation and
contract testing.

## OIDC / SSO validation (S31)
`OidcValidator` validates bearer tokens as signed claims (JWT-style) instead of a static
map: signature (via an injectable `verify` so no JWT library is bundled — production uses
JWKS/RS256), expiry, issuer, audience, and required claims, returning a typed failure
reason on rejection. `resolve(token)` yields `{ userId, tenantId }` and drops directly into
the API auth middleware, enabling federated identity. `encode/decodeUnsignedClaims` provide
a deterministic verifier for offline/testing.
