import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  createLocalJWKSet,
  type JWK,
} from "jose";
import {
  buildEntraVerifier,
  entraIssuer,
  entraJwksUri,
  mapEntraRoles,
  entraClaimsToTokenClaims,
} from "../src/oidc_jwks.js";
import { OidcValidator } from "../src/oidc.js";

const TENANT = "11111111-2222-3333-4444-555555555555";
const CLIENT = "app-client-id-abc";
const ISSUER = entraIssuer(TENANT);
const NOW = 1_750_000_000;

// Build a real RS256 keypair, expose its public half as a local JWKS, and
// return a signer + the verifier wired to that JWKS. This performs genuine
// signature verification with no network.
async function harness() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const pubJwk = (await exportJWK(publicKey)) as JWK;
  pubJwk.kid = "test-key-1";
  pubJwk.alg = "RS256";
  const jwks = createLocalJWKSet({ keys: [pubJwk] });
  const verify = buildEntraVerifier({ tenantId: TENANT, clientId: CLIENT, jwks });

  async function sign(payload: Record<string, unknown>, over: { iss?: string; aud?: string; exp?: number } = {}) {
    // jose verifies exp/iat against the real system clock, so sign relative to
    // real now (not the fixed NOW used for the validator's own checks).
    return await new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer(over.iss ?? ISSUER)
      .setAudience(over.aud ?? CLIENT)
      .setIssuedAt()
      .setExpirationTime(over.exp ?? "1h")
      .sign(privateKey);
  }

  // A second, unrelated key — tokens it signs must fail verification.
  async function signWithForeignKey(payload: Record<string, unknown>) {
    const { privateKey: evil } = await generateKeyPair("RS256");
    return await new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(evil);
  }

  return { verify, sign, signWithForeignKey };
}

function entraPayload(over: Record<string, unknown> = {}) {
  return {
    oid: "user-oid-123",
    tid: TENANT,
    preferred_username: "alice@acme.test",
    roles: ["admin"],
    ...over,
  };
}

// A validator wired to the async verifier, with a fixed clock.
function validatorWith(verify: (t: string) => Promise<unknown>) {
  return new OidcValidator({
    issuer: ISSUER,
    audience: CLIENT,
    verify: () => null, // sync path unused here
    asyncVerify: verify as never,
    now: () => NOW,
  });
}

describe("buildEntraVerifier — real RS256 verification (S117)", () => {
  it("verifies a correctly-signed Entra token end-to-end", async () => {
    const { verify, sign } = await harness();
    const token = await sign(entraPayload());
    const v = validatorWith(verify);
    const result = await v.validateAsync(token);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.claims.sub).toBe("user-oid-123");
      expect(result.claims.tenant).toBe(TENANT);
      expect(result.claims.email).toBe("alice@acme.test");
      expect(result.claims.roles).toEqual(["admin"]);
    }
  });

  it("resolveAsync returns userId/tenantId for a valid token", async () => {
    const { verify, sign } = await harness();
    const token = await sign(entraPayload());
    const v = validatorWith(verify);
    expect(await v.resolveAsync(token)).toEqual({ userId: "user-oid-123", tenantId: TENANT });
  });

  it("rejects a token signed by a different (foreign) key", async () => {
    const { verify, signWithForeignKey } = await harness();
    const token = await signWithForeignKey(entraPayload());
    const v = validatorWith(verify);
    expect((await v.validateAsync(token)).valid).toBe(false);
    expect(await v.resolveAsync(token)).toBeNull();
  });

  it("rejects a token with the wrong audience", async () => {
    const { verify, sign } = await harness();
    const token = await sign(entraPayload(), { aud: "some-other-app" });
    const v = validatorWith(verify);
    expect((await v.validateAsync(token)).valid).toBe(false);
  });

  it("rejects a token with the wrong issuer", async () => {
    const { verify, sign } = await harness();
    const token = await sign(entraPayload(), { iss: "https://evil.example.com/v2.0" });
    const v = validatorWith(verify);
    expect((await v.validateAsync(token)).valid).toBe(false);
  });

  it("rejects an expired token", async () => {
    const { verify, sign } = await harness();
    const token = await sign(entraPayload(), { exp: NOW - 10 });
    const v = validatorWith(verify);
    // jose itself rejects on exp (clockTolerance 0), so it surfaces as invalid.
    expect((await v.validateAsync(token)).valid).toBe(false);
  });

  it("falls the user to viewer when no known role is present, and reports missing_claims when identity is absent", async () => {
    const { verify, sign } = await harness();
    const noRole = await sign(entraPayload({ roles: ["SomeUnknownAppRole"] }));
    const v = validatorWith(verify);
    const r1 = await v.validateAsync(noRole);
    expect(r1.valid).toBe(true);
    if (r1.valid) expect(r1.claims.roles).toEqual(["viewer"]);

    const noOid = await sign(entraPayload({ oid: undefined, sub: undefined }));
    // The verifier maps unmappable identity to null, so the validator reports
    // invalid_signature (it can't see *why* the verifier rejected). The
    // missing_claims path itself is covered via the sync validator in
    // oidc.test.ts and entraClaimsToTokenClaims returning null below.
    expect((await v.validateAsync(noOid)).valid).toBe(false);
  });

  it("validateAsync is invalid_signature when no asyncVerify is configured", async () => {
    const v = new OidcValidator({ issuer: ISSUER, audience: CLIENT, verify: () => null, now: () => NOW });
    expect(await v.validateAsync("tok")).toEqual({ valid: false, reason: "invalid_signature" });
    expect(await v.resolveAsync("tok")).toBeNull();
  });
});

describe("Entra claim/role mapping helpers (S117)", () => {
  it("maps known roles and drops unknown ones", () => {
    expect(mapEntraRoles(["admin", "reviewer"])).toEqual(["admin", "reviewer"]);
    expect(mapEntraRoles(["admin", "Nonsense"])).toEqual(["admin"]);
  });

  it("falls back to viewer for empty, all-unknown, or non-array roles", () => {
    expect(mapEntraRoles([])).toEqual(["viewer"]);
    expect(mapEntraRoles(["Nope"])).toEqual(["viewer"]);
    expect(mapEntraRoles(undefined)).toEqual(["viewer"]);
    expect(mapEntraRoles("admin")).toEqual(["viewer"]);
  });

  it("uses sub when oid is absent, and email when preferred_username is absent", () => {
    const c = entraClaimsToTokenClaims(
      { sub: "s1", tid: TENANT, email: "bob@acme.test", roles: ["ops"], iss: ISSUER, exp: NOW + 1, iat: NOW },
      CLIENT,
    );
    expect(c?.sub).toBe("s1");
    expect(c?.email).toBe("bob@acme.test");
    expect(c?.roles).toEqual(["ops"]);
  });

  it("returns null when identity fields are missing", () => {
    expect(entraClaimsToTokenClaims({ tid: TENANT, preferred_username: "x@y.z" }, CLIENT)).toBeNull();
    expect(entraClaimsToTokenClaims({ oid: "u", preferred_username: "x@y.z" }, CLIENT)).toBeNull();
    expect(entraClaimsToTokenClaims({ oid: "u", tid: TENANT }, CLIENT)).toBeNull();
  });

  it("defaults iss/exp/iat to safe values when absent or wrong-typed", () => {
    const c = entraClaimsToTokenClaims(
      { oid: "u", tid: TENANT, email: "x@y.z", roles: ["viewer"] },
      CLIENT,
    );
    expect(c?.iss).toBe("");
    expect(c?.exp).toBe(0);
    expect(c?.iat).toBe(0);
  });

  it("exposes the Entra issuer + JWKS URLs for a tenant", () => {
    expect(entraIssuer(TENANT)).toBe(`https://login.microsoftonline.com/${TENANT}/v2.0`);
    expect(entraJwksUri(TENANT)).toContain("/discovery/v2.0/keys");
  });

  it("builds a remote-JWKS verifier (no injected key set) without a network call", () => {
    // With no `jwks` injected, the builder constructs a remote JWKS fetcher.
    // createRemoteJWKSet is lazy — it does NOT hit the network until a token is
    // actually verified — so constructing the verifier is offline-safe and
    // covers the production fallback branch (default URL + explicit jwksUri).
    const def = buildEntraVerifier({ tenantId: TENANT, clientId: CLIENT });
    expect(typeof def).toBe("function");
    const custom = buildEntraVerifier({
      tenantId: TENANT,
      clientId: CLIENT,
      jwksUri: `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
    });
    expect(typeof custom).toBe("function");
  });
});
