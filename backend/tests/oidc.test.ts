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

describe("OidcValidator async path (S117)", () => {
  // Wire asyncVerify to a deterministic verifier so the shared check() logic is
  // exercised through validateAsync/resolveAsync without real crypto.
  function asyncValidator(av: (t: string) => Promise<TokenClaims | null>) {
    return new OidcValidator({
      issuer: "https://sso.acme.test",
      audience: "agentfoundry",
      verify: () => null,
      asyncVerify: av,
      now: () => NOW,
    });
  }

  it("validates a well-formed token via asyncVerify", async () => {
    const v = asyncValidator(async () => claims());
    const r = await v.validateAsync("tok");
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.claims.sub).toBe("user-1");
  });

  it("resolveAsync returns ids for a valid token, null otherwise", async () => {
    expect(await asyncValidator(async () => claims()).resolveAsync("t")).toEqual({ userId: "user-1", tenantId: "t1" });
    expect(await asyncValidator(async () => null).resolveAsync("t")).toBeNull();
  });

  it("rejects invalid signature / missing claims / wrong issuer / wrong audience / expired", async () => {
    expect(await asyncValidator(async () => null).validateAsync("t")).toEqual({ valid: false, reason: "invalid_signature" });
    expect(await asyncValidator(async () => claims({ sub: "" })).validateAsync("t")).toEqual({ valid: false, reason: "missing_claims" });
    expect(await asyncValidator(async () => claims({ roles: undefined as never })).validateAsync("t")).toEqual({ valid: false, reason: "missing_claims" });
    expect(await asyncValidator(async () => claims({ iss: "https://evil.test" })).validateAsync("t")).toEqual({ valid: false, reason: "wrong_issuer" });
    expect(await asyncValidator(async () => claims({ aud: "other" })).validateAsync("t")).toEqual({ valid: false, reason: "wrong_audience" });
    expect(await asyncValidator(async () => claims({ exp: NOW - 1 })).validateAsync("t")).toEqual({ valid: false, reason: "expired" });
  });

  it("validateAsync is invalid_signature when asyncVerify is not configured", async () => {
    const v = new OidcValidator({ issuer: "i", audience: "a", verify: () => null, now: () => NOW });
    expect(await v.validateAsync("t")).toEqual({ valid: false, reason: "invalid_signature" });
  });
});
