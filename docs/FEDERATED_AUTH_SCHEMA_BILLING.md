# Federated Auth, Schema Validation & Billing (S32–S34)

## OIDC wired into API auth (S32)
When `ApiDeps.oidc` is supplied, the auth middleware validates bearer tokens as signed
claims (S31) and **just-in-time provisions** the federated user into the local
`IdentityStore` (`upsertUser`), so SSO users work without manual onboarding. If the
token's tenant isn't provisioned the request is rejected (401). A static-token-map
fallback remains for mixed or migration setups. The HTTP layer now supports real
federated identity end to end.

## JSON-schema validation (S33)
`validateSchema(schema, value)` is a dependency-free validator covering the subset the
API needs: types, `required`, `enum`, numeric `minimum`/`maximum`, string
`minLength`/`maxLength`, nested objects, arrays (`items`, with index paths like `$[1]`),
and `additionalProperties: false`. Errors are explainable with the failing path
(`$.sdlc.version`), so request/response bodies can be contract-validated against the
OpenAPI-described shapes.

## Billing & usage metering (S34)
`BillingEngine` meters billable usage per tenant per billing period and rolls it into a
priced `Invoice`: a per-resource rate card (cents/unit) over the shared `QuotaResource`
model, one line item per used resource, an optional flat platform fee, and subtotal/total.
Usage isolates by month; `formatAmount` renders minor units as a currency string. This
turns the quota usage already tracked by the platform into invoiceable line items.
