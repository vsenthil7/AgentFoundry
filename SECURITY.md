# Security Policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in AgentFoundry, please report it
privately. **Do not open a public GitHub issue for security problems**, as that discloses
the issue before a fix is available.

To report:

1. Open a private security advisory via GitHub's **Security → Report a vulnerability**
   workflow on this repository, or
2. Contact the maintainers directly through the channel listed on the repository's profile.

Please include, where possible:

- A description of the vulnerability and its impact.
- Steps to reproduce (a minimal proof of concept is ideal).
- The affected component (engine module, HTTP route, web screen) and version/commit.
- Any suggested remediation.

## What to expect

- We aim to acknowledge a report within a few business days.
- We will work with you to understand and validate the issue, and keep you informed of
  progress toward a fix.
- We will credit reporters who wish to be acknowledged once a fix is released, unless you
  prefer to remain anonymous.

Please give us a reasonable opportunity to remediate before any public disclosure.

## Supported versions

AgentFoundry is developed on a continuous mini-sprint cadence; the `main` branch is the
supported line. Security fixes are applied to `main`. There is no separate long-term-support
branch at this time.

| Version | Supported |
|---------|-----------|
| `main` (latest) | ✅ |
| older commits | ❌ (rebase onto `main`) |

## Scope and design notes

AgentFoundry is built offline-first with deliberate seams for live infrastructure. Some
boundaries are intentional and documented rather than being vulnerabilities:

- **Authentication** uses scrypt salted + constant-time password hashing and opaque,
  expiring, server-side session tokens. Federated identity is provided by a real JWKS/RS256
  Microsoft Entra OIDC verifier; binding it to a live tenant requires operator credentials
  at deploy (`ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID`).
- **Secrets** are never returned in plaintext through any list/read API — they are masked
  (head…tail) and resolved only at use time through an access-checked accessor.
- **The audit ledger** is a SHA-256 hash chain with tamper detection.
- **The red-team engine** refuses to target anything other than the user's own agent design
  (anti-weaponization).
- **The sandbox** enforces a network-egress allowlist (empty = no network) and mocks tools
  by default.

For the architectural security model, threat enumeration, and control mapping, see
`docs/SECURITY.md`, `docs/THREAT_MODEL.md`, and `docs/SECURITY_REVIEW_PACK.md`. Known,
deliberately-documented boundaries are tracked in `docs/KNOWN_GAPS.md`.
