// S17 — Secrets & connector credential management.
// Credentials are stored per-tenant, never returned in plaintext through list
// APIs (only masked), and connectors declare which secret they need. A secret is
// resolved only at use time, through an access-checked accessor.

import { requireSameTenant, type User, requirePermission } from "./identity.js";

export type ConnectorKind = "mcp" | "openapi" | "a2a";

export interface ConnectorDef {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: ConnectorKind;
  readonly name: string;
  readonly endpoint: string;
  readonly secretId: string; // references a stored secret
}

export interface MaskedSecret {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly masked: string; // e.g. "sk-…wxyz"
  readonly createdAt: string;
}

export class SecretNotFoundError extends Error {
  constructor(id: string) {
    super(`Secret not found: ${id}`);
    this.name = "SecretNotFoundError";
  }
}

export class ConnectorNotFoundError extends Error {
  constructor(id: string) {
    super(`Connector not found: ${id}`);
    this.name = "ConnectorNotFoundError";
  }
}

export class DuplicateSecretError extends Error {
  constructor(id: string) {
    super(`Secret already exists: ${id}`);
    this.name = "DuplicateSecretError";
  }
}

// Mask a secret value: show first 2 and last 4 chars, redact the middle.
export function maskValue(value: string): string {
  if (value.length <= 6) return "…".repeat(Math.max(value.length, 1));
  return `${value.slice(0, 2)}…${value.slice(-4)}`;
}

interface StoredSecret {
  id: string;
  tenantId: string;
  name: string;
  value: string;
  createdAt: string;
}

export class SecretsVault {
  private readonly secrets = new Map<string, StoredSecret>();
  private readonly connectors = new Map<string, ConnectorDef>();
  private readonly now: () => string;

  constructor(now: () => string = () => new Date(0).toISOString()) {
    this.now = now;
  }

  // Store a secret. Requires admin:manage_users permission + same tenant.
  putSecret(
    user: User,
    input: { id: string; name: string; value: string },
  ): MaskedSecret {
    requirePermission(user, "admin:manage_users");
    if (this.secrets.has(input.id)) throw new DuplicateSecretError(input.id);
    const stored: StoredSecret = {
      id: input.id,
      tenantId: user.tenantId,
      name: input.name,
      value: input.value,
      createdAt: this.now(),
    };
    this.secrets.set(input.id, stored);
    return this.mask(stored);
  }

  private mask(s: StoredSecret): MaskedSecret {
    return Object.freeze({
      id: s.id,
      tenantId: s.tenantId,
      name: s.name,
      masked: maskValue(s.value),
      createdAt: s.createdAt,
    });
  }

  // List masked secrets for a tenant — never plaintext.
  list(user: User): MaskedSecret[] {
    return [...this.secrets.values()]
      .filter((s) => s.tenantId === user.tenantId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s) => this.mask(s));
  }

  getMasked(user: User, id: string): MaskedSecret {
    const s = this.secrets.get(id);
    if (!s) throw new SecretNotFoundError(id);
    requireSameTenant(user, s.tenantId);
    return this.mask(s);
  }

  // Resolve the plaintext value — access-checked, used only at connector use time.
  resolve(user: User, id: string): string {
    const s = this.secrets.get(id);
    if (!s) throw new SecretNotFoundError(id);
    requireSameTenant(user, s.tenantId);
    return s.value;
  }

  rotate(user: User, id: string, newValue: string): MaskedSecret {
    requirePermission(user, "admin:manage_users");
    const s = this.secrets.get(id);
    if (!s) throw new SecretNotFoundError(id);
    requireSameTenant(user, s.tenantId);
    s.value = newValue;
    s.createdAt = this.now();
    return this.mask(s);
  }

  // ---- Connectors ----

  registerConnector(user: User, def: ConnectorDef): ConnectorDef {
    requirePermission(user, "admin:manage_users");
    requireSameTenant(user, def.tenantId);
    if (!this.secrets.has(def.secretId)) {
      throw new SecretNotFoundError(def.secretId);
    }
    const frozen = Object.freeze({ ...def });
    this.connectors.set(def.id, frozen);
    return frozen;
  }

  getConnector(user: User, id: string): ConnectorDef {
    const c = this.connectors.get(id);
    if (!c) throw new ConnectorNotFoundError(id);
    requireSameTenant(user, c.tenantId);
    return c;
  }

  // Resolve a connector's credential at use time (access-checked).
  resolveConnectorSecret(user: User, connectorId: string): string {
    const c = this.getConnector(user, connectorId);
    return this.resolve(user, c.secretId);
  }

  listConnectors(user: User): ConnectorDef[] {
    return [...this.connectors.values()]
      .filter((c) => c.tenantId === user.tenantId)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
