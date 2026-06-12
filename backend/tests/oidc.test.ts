import { describe, it, expect } from "vitest";
import {
  OidcValidator,
  decodeUnsignedClaims,
  encodeUnsignedClaims,
  type TokenClaims,
} from "../src/oidc.js";

const NOW = 1_750_000_000; // fixed epoch seconds

function claims(over: Partial<TokenClaims> = {}): TokenClaims {
  return {
    sub: "user-1",
    tenant: "t1",
    email: "user@acme.test",
    roles: ["composer"],
    iss: "https://sso.acme.test",
    aud: "agentfoundry",
    exp: NOW + 3600,
    iat: NOW - 60,
    ...over,
  };
}

function validator(verify: (t: string) => TokenClaims | null) {
  return new OidcValidator({
    issuer: "https://sso.acme.test",
    audience: "agentfoundry",
    verify,
    now: () => NOW,
  });
}

describe("OidcValidator", () => {
  it("validates a well-formed token", () => {
    const v = validator(() => claims());
    const result = v.validate("tok");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.claims.sub).toBe("user-1");
  });

  it("rejects an invalid signature", () => {
    const v = validator(() => null);
    const result = v.validate("tok");
    expect(result).toEqual({ valid: false, reason: "invalid_signature" });
  });

  it("rejects missing claims", () => {
    const v = validator(() => claims({ sub: "" }));
    expect(v.validate("tok")).toEqual({ valid: false, reason: "missing_claims" });
  });

  it("rejects a non-array roles claim", () => {
    const v = validator(() => claims({ roles: undefined as never }));
    expect(v.validate("tok")).toEqual({ valid: false, reason: "missing_claims" });
  });

  it("rejects a wrong issuer", () => {
    const v = validator(() => claims({ iss: "https://evil.test" }));
    expect(v.validate("tok")).toEqual({ valid: false, reason: "wrong_issuer" });
  });

  it("rejects a wrong audience", () => {
    const v = validator(() => claims({ aud: "other-app" }));
    expect(v.validate("tok")).toEqual({ valid: false, reason: "wrong_audience" });
  });

  it("rejects an expired token", () => {
    const v = validator(() => claims({ exp: NOW - 1 }));
    expect(v.validate("tok")).toEqual({ valid: false, reason: "expired" });
  });

  it("resolve returns userId/tenantId for a valid token", () => {
    const v = validator(() => claims());
    expect(v.resolve("tok")).toEqual({ userId: "user-1", tenantId: "t1" });
  });

  it("resolve returns null for an invalid token", () => {
    const v = validator(() => null);
    expect(v.resolve("tok")).toBeNull();
  });

  it("uses the default clock when none injected", () => {
    const v = new OidcValidator({
      issuer: "i",
      audience: "a",
      verify: () => claims({ iss: "i", aud: "a", exp: Math.floor(Date.now() / 1000) + 3600 }),
    });
    expect(v.validate("tok").valid).toBe(true);
  });
});

describe("decode/encode unsigned claims (test verifier)", () => {
  it("round-trips claims through base64", () => {
    const c = claims();
    const token = encodeUnsignedClaims(c);
    expect(decodeUnsignedClaims(token)).toEqual(c);
  });

  it("returns null for a malformed token", () => {
    expect(decodeUnsignedClaims("@@@not-base64-json@@@")).toBeNull();
  });

  it("integrates with the validator end-to-end", () => {
    const token = encodeUnsignedClaims(claims());
    const v = validator(decodeUnsignedClaims);
    const result = v.validate(token);
    expect(result.valid).toBe(true);
  });
});
