// S31 — SSO / OIDC token validation.
// Validates bearer tokens as signed claims (JWT-style) instead of a static map:
// checks signature (via an injectable verifier so we don't bundle a crypto JWT
// lib), expiry, issuer, and audience, then maps claims to a user/tenant. Roles
// can be carried in the token for federated identity.

import type { Role } from "./identity.js";

export interface TokenClaims {
  sub: string; // user id
  tenant: string; // tenant id
  email: string;
  roles: Role[];
  iss: string; // issuer
  aud: string; // audience
  exp: number; // expiry (epoch seconds)
  iat: number; // issued-at (epoch seconds)
}

export interface OidcConfig {
  issuer: string;
  audience: string;
  // Verifies the token's signature; returns the claims or null if invalid.
  // A real deployment uses JWKS + RS256; tests inject a deterministic verifier.
  verify: (token: string) => TokenClaims | null;
  // Async signature verifier (S117) for real JWKS/RS256 (jose). When present,
  // validateAsync()/resolveAsync() use this; the sync verify above is untouched.
  asyncVerify?: (token: string) => Promise<TokenClaims | null>;
  // Clock in epoch seconds (injectable for tests).
  now?: () => number;
}

export type ValidationFailure =
  | "invalid_signature"
  | "expired"
  | "wrong_issuer"
  | "wrong_audience"
  | "missing_claims";

export type ValidationResult =
  | { valid: true; claims: TokenClaims }
  | { valid: false; reason: ValidationFailure };

export class OidcValidator {
  private readonly config: OidcConfig;
  private readonly now: () => number;

  constructor(config: OidcConfig) {
    this.config = config;
    this.now = config.now ?? (() => Math.floor(Date.now() / 1000));
  }

  validate(token: string): ValidationResult {
    const claims = this.config.verify(token);
    if (!claims) return { valid: false, reason: "invalid_signature" };

    if (
      !claims.sub ||
      !claims.tenant ||
      !claims.email ||
      !Array.isArray(claims.roles)
    ) {
      return { valid: false, reason: "missing_claims" };
    }
    if (claims.iss !== this.config.issuer) {
      return { valid: false, reason: "wrong_issuer" };
    }
    if (claims.aud !== this.config.audience) {
      return { valid: false, reason: "wrong_audience" };
    }
    if (claims.exp <= this.now()) {
      return { valid: false, reason: "expired" };
    }
    return { valid: true, claims };
  }

  // Convenience: resolve a token directly to { userId, tenantId } for the API
  // auth middleware, or null if invalid.
  resolve(token: string): { userId: string; tenantId: string } | null {
    const result = this.validate(token);
    if (!result.valid) return null;
    return { userId: result.claims.sub, tenantId: result.claims.tenant };
  }

  // ---- S117: async verification path for real JWKS/RS256 (jose) ----
  // Shares the exact same claim/issuer/audience/expiry checks as validate();
  // only the signature step differs (async). Requires config.asyncVerify.
  async validateAsync(token: string): Promise<ValidationResult> {
    if (!this.config.asyncVerify) {
      return { valid: false, reason: "invalid_signature" };
    }
    const claims = await this.config.asyncVerify(token);
    return this.check(claims);
  }

  async resolveAsync(token: string): Promise<{ userId: string; tenantId: string } | null> {
    const result = await this.validateAsync(token);
    if (!result.valid) return null;
    return { userId: result.claims.sub, tenantId: result.claims.tenant };
  }

  // Shared post-signature validation (claims presence, issuer, audience, expiry).
  private check(claims: TokenClaims | null): ValidationResult {
    if (!claims) return { valid: false, reason: "invalid_signature" };
    if (
      !claims.sub ||
      !claims.tenant ||
      !claims.email ||
      !Array.isArray(claims.roles)
    ) {
      return { valid: false, reason: "missing_claims" };
    }
    if (claims.iss !== this.config.issuer) {
      return { valid: false, reason: "wrong_issuer" };
    }
    if (claims.aud !== this.config.audience) {
      return { valid: false, reason: "wrong_audience" };
    }
    if (claims.exp <= this.now()) {
      return { valid: false, reason: "expired" };
    }
    return { valid: true, claims };
  }
}

// A deterministic "verifier" for tests/offline: decodes a base64 JSON payload.
// (Stands in for JWKS/RS256 signature verification without bundling a JWT lib.)
export function decodeUnsignedClaims(token: string): TokenClaims | null {
  try {
    const json = Buffer.from(token, "base64").toString("utf8");
    const claims = JSON.parse(json) as TokenClaims;
    return claims;
  } catch {
    return null;
  }
}

export function encodeUnsignedClaims(claims: TokenClaims): string {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64");
}
