// S117 — real JWKS/RS256 OIDC verifier (Microsoft Entra-ready).
// Builds the async `verify` that OidcConfig.asyncVerify expects, on top of the
// `jose` library: it fetches the identity provider's JWKS, verifies the JWT's
// RS256 signature, and maps Entra ID token claims into our TokenClaims shape.
//
// This is real production code. The only thing it needs at deploy time is the
// operator's Entra tenant + client (app) IDs; the signature-verification path
// is exercised fully offline in tests by injecting a local JWKS (see the
// `jwks` seam) so no network call is required to prove it works.

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import type { Role } from "./identity.js";
import type { TokenClaims } from "./oidc.js";

// Microsoft Entra v2 issuer + JWKS URL for a given tenant.
export function entraIssuer(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/v2.0`;
}
export function entraJwksUri(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
}

// Map Entra app-role strings to AgentFoundry roles. Entra app roles are
// arbitrary strings configured on the app registration; we accept the
// AgentFoundry role names directly and ignore anything unrecognised. An empty
// or unmapped set falls back to the least-privilege role.
const KNOWN_ROLES: ReadonlyArray<Role> = [
  "composer",
  "reviewer",
  "ops",
  "admin",
  "viewer",
  "superadmin",
];

export function mapEntraRoles(roles: unknown): Role[] {
  if (!Array.isArray(roles)) return ["viewer"];
  const mapped = roles.filter((r): r is Role =>
    typeof r === "string" && (KNOWN_ROLES as readonly string[]).includes(r),
  );
  return mapped.length > 0 ? mapped : ["viewer"];
}

// Translate a verified Entra JWT payload into our TokenClaims. Entra uses `oid`
// (stable object id) for the user and `tid` for the tenant; email arrives as
// `preferred_username` or `email`. Returns null if the mandatory identity
// fields are absent (the validator then reports missing_claims).
export function entraClaimsToTokenClaims(
  payload: JWTPayload,
  audience: string,
): TokenClaims | null {
  const sub = (payload.oid as string | undefined) ?? payload.sub;
  const tenant = payload.tid as string | undefined;
  const email =
    (payload.preferred_username as string | undefined) ??
    (payload.email as string | undefined);
  if (!sub || !tenant || !email) return null;
  return {
    sub,
    tenant,
    email,
    roles: mapEntraRoles(payload.roles),
    iss: typeof payload.iss === "string" ? payload.iss : "",
    aud: audience,
    exp: typeof payload.exp === "number" ? payload.exp : 0,
    iat: typeof payload.iat === "number" ? payload.iat : 0,
  };
}

export interface EntraVerifierOptions {
  tenantId: string;
  clientId: string; // the app registration's client id == token audience
  // Optional override of the JWKS source. In production this is left unset and
  // a remote JWKS is fetched from Entra; tests inject a local key set so the
  // RS256 verification is real but offline.
  jwks?: JWTVerifyGetKey;
  jwksUri?: string;
}

// Build the async verifier to plug into OidcConfig.asyncVerify. It performs a
// real RS256 signature check (issuer + audience enforced by jose), then maps
// the claims. Any verification failure (bad signature, wrong aud/iss, expired)
// resolves to null, which the OidcValidator reports as invalid_signature/etc.
export function buildEntraVerifier(
  opts: EntraVerifierOptions,
): (token: string) => Promise<TokenClaims | null> {
  const issuer = entraIssuer(opts.tenantId);
  const keySet: JWTVerifyGetKey =
    opts.jwks ?? createRemoteJWKSet(new URL(opts.jwksUri ?? entraJwksUri(opts.tenantId)));

  return async (token: string): Promise<TokenClaims | null> => {
    try {
      const { payload } = await jwtVerify(token, keySet, {
        issuer,
        audience: opts.clientId,
        algorithms: ["RS256"],
      });
      return entraClaimsToTokenClaims(payload, opts.clientId);
    } catch {
      // Signature mismatch, wrong issuer/audience, or expiry — all surface as
      // a rejected token. The validator maps null -> invalid_signature.
      return null;
    }
  };
}
