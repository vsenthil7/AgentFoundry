import { describe, it, expect, beforeEach } from "vitest";
import {
  SecretsVault,
  maskValue,
  SecretNotFoundError,
  ConnectorNotFoundError,
  DuplicateSecretError,
  type ConnectorDef,
} from "../src/secrets.js";
import {
  PermissionDeniedError,
  TenantIsolationError,
  type User,
} from "../src/identity.js";

const admin: User = { id: "a", tenantId: "t1", email: "a@acme.test", roles: ["admin"] };
const composer: User = { id: "c", tenantId: "t1", email: "c@acme.test", roles: ["composer"] };
const otherAdmin: User = { id: "x", tenantId: "t2", email: "x@evil.test", roles: ["admin"] };

let vault: SecretsVault;
beforeEach(() => (vault = new SecretsVault()));

describe("maskValue", () => {
  it("masks a long secret showing head and tail", () => {
    expect(maskValue("sk-abcdef1234wxyz")).toBe("sk…wxyz");
  });
  it("fully masks a short secret", () => {
    expect(maskValue("abc")).toBe("…………".slice(0, 3));
  });
  it("masks a single char", () => {
    expect(maskValue("a")).toBe("…");
  });
});

describe("putSecret", () => {
  it("stores a secret and returns it masked", () => {
    const m = vault.putSecret(admin, { id: "s1", name: "OpenAI", value: "sk-abcdef1234wxyz" });
    expect(m.masked).toBe("sk…wxyz");
    expect(m.masked).not.toContain("abcdef");
  });

  it("denies a non-admin", () => {
    expect(() =>
      vault.putSecret(composer, { id: "s1", name: "x", value: "v123456" }),
    ).toThrow(PermissionDeniedError);
  });

  it("rejects a duplicate id", () => {
    vault.putSecret(admin, { id: "s1", name: "x", value: "v123456" });
    expect(() =>
      vault.putSecret(admin, { id: "s1", name: "y", value: "w123456" }),
    ).toThrow(DuplicateSecretError);
  });
});

describe("list / getMasked — never plaintext", () => {
  beforeEach(() => {
    vault.putSecret(admin, { id: "s1", name: "OpenAI", value: "sk-abcdef1234wxyz" });
  });

  it("list returns only masked values for the tenant", () => {
    const list = vault.list(admin);
    expect(list).toHaveLength(1);
    expect(list[0].masked).toBe("sk…wxyz");
    expect(JSON.stringify(list)).not.toContain("abcdef1234");
  });

  it("getMasked enforces tenant isolation", () => {
    expect(() => vault.getMasked(otherAdmin, "s1")).toThrow(TenantIsolationError);
  });

  it("getMasked throws for unknown id", () => {
    expect(() => vault.getMasked(admin, "ghost")).toThrow(SecretNotFoundError);
  });

  it("list is tenant-scoped", () => {
    expect(vault.list(otherAdmin)).toHaveLength(0);
  });
});

describe("resolve — plaintext at use time", () => {
  beforeEach(() => {
    vault.putSecret(admin, { id: "s1", name: "OpenAI", value: "sk-secret-value-1" });
  });

  it("returns plaintext for same-tenant access", () => {
    expect(vault.resolve(admin, "s1")).toBe("sk-secret-value-1");
  });

  it("denies cross-tenant resolution", () => {
    expect(() => vault.resolve(otherAdmin, "s1")).toThrow(TenantIsolationError);
  });

  it("throws for unknown secret", () => {
    expect(() => vault.resolve(admin, "ghost")).toThrow(SecretNotFoundError);
  });
});

describe("rotate", () => {
  beforeEach(() => {
    vault.putSecret(admin, { id: "s1", name: "OpenAI", value: "old-value-123" });
  });

  it("rotates the value", () => {
    vault.rotate(admin, "s1", "new-value-456");
    expect(vault.resolve(admin, "s1")).toBe("new-value-456");
  });

  it("denies a non-admin", () => {
    expect(() => vault.rotate(composer, "s1", "x")).toThrow(PermissionDeniedError);
  });

  it("throws for unknown secret", () => {
    expect(() => vault.rotate(admin, "ghost", "x")).toThrow(SecretNotFoundError);
  });

  it("enforces tenant on rotate", () => {
    expect(() => vault.rotate(otherAdmin, "s1", "x")).toThrow(TenantIsolationError);
  });
});

describe("connectors", () => {
  const def: ConnectorDef = {
    id: "conn-1",
    tenantId: "t1",
    kind: "mcp",
    name: "Asana MCP",
    endpoint: "https://mcp.asana.com/sse",
    secretId: "s1",
  };

  beforeEach(() => {
    vault.putSecret(admin, { id: "s1", name: "Asana", value: "tok-abcdef123456" });
  });

  it("registers a connector referencing a secret", () => {
    const c = vault.registerConnector(admin, def);
    expect(c.kind).toBe("mcp");
  });

  it("rejects a connector referencing an unknown secret", () => {
    expect(() =>
      vault.registerConnector(admin, { ...def, secretId: "ghost" }),
    ).toThrow(SecretNotFoundError);
  });

  it("denies a non-admin registering a connector", () => {
    expect(() => vault.registerConnector(composer, def)).toThrow(PermissionDeniedError);
  });

  it("resolves a connector's secret at use time", () => {
    vault.registerConnector(admin, def);
    expect(vault.resolveConnectorSecret(admin, "conn-1")).toBe("tok-abcdef123456");
  });

  it("getConnector throws for unknown id", () => {
    expect(() => vault.getConnector(admin, "ghost")).toThrow(ConnectorNotFoundError);
  });

  it("getConnector enforces tenant isolation", () => {
    vault.registerConnector(admin, def);
    expect(() => vault.getConnector(otherAdmin, "conn-1")).toThrow(TenantIsolationError);
  });

  it("registerConnector enforces same tenant on the def", () => {
    expect(() =>
      vault.registerConnector(admin, { ...def, tenantId: "t2" }),
    ).toThrow(TenantIsolationError);
  });

  it("lists connectors for the tenant", () => {
    vault.registerConnector(admin, def);
    expect(vault.listConnectors(admin)).toHaveLength(1);
    expect(vault.listConnectors(otherAdmin)).toHaveLength(0);
  });
});
