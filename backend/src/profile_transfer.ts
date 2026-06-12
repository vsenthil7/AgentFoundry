// S69 — Tenant config export / import.
// Serializes a tenant profile (S56) into a portable, checksummed envelope and
// imports it — validated — into another environment's profile store as a new
// version. This is how a config validated in staging is promoted to production
// without hand-copying settings.

import { createHash } from "node:crypto";
import {
  validateProfileInput,
  TenantProfileError,
  type TenantProfile,
  type TenantProfileInput,
  type TenantProfileStore,
} from "./tenant_profile.js";

export interface ProfileExport {
  version: 1;
  exportedAt: string;
  sourceTenantId: string;
  sourceVersion: number;
  profile: TenantProfileInput;
  checksum: string; // SHA-256 over the canonical profile input
}

export class ProfileImportError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ProfileImportError";
  }
}

function checksum(input: TenantProfileInput): string {
  // Canonical form: regions sorted, keys ordered deterministically.
  const canonical = JSON.stringify({
    policyId: input.policyId,
    slaTarget: input.slaTarget,
    quotaLimits: input.quotaLimits,
    retention: {
      retentionDays: input.retention.retentionDays,
      allowedRegions: [...input.retention.allowedRegions].sort(),
    },
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// Export a profile into a portable, checksummed envelope.
export function exportProfile(
  profile: TenantProfile,
  now: () => string = () => new Date(0).toISOString(),
): ProfileExport {
  const input: TenantProfileInput = {
    policyId: profile.policyId,
    quotaLimits: profile.quotaLimits,
    retention: profile.retention,
    slaTarget: profile.slaTarget,
  };
  return {
    version: 1,
    exportedAt: now(),
    sourceTenantId: profile.tenantId,
    sourceVersion: profile.version,
    profile: input,
    checksum: checksum(input),
  };
}

export function serializeProfileExport(exp: ProfileExport): string {
  return JSON.stringify(exp);
}

export function deserializeProfileExport(serialized: string): ProfileExport {
  const parsed = JSON.parse(serialized) as ProfileExport;
  if (parsed.version !== 1 || !parsed.profile) {
    throw new ProfileImportError("Unrecognized export envelope.");
  }
  return parsed;
}

// Verify an export's integrity.
export function verifyProfileExport(exp: ProfileExport): boolean {
  return exp.checksum === checksum(exp.profile);
}

// Import an export into a target store under a target tenant id, as a new version.
// Validates the config and the checksum before writing.
export function importProfile(
  exp: ProfileExport,
  targetTenantId: string,
  store: TenantProfileStore,
): TenantProfile {
  if (!verifyProfileExport(exp)) {
    throw new ProfileImportError("Export checksum mismatch: corrupted or tampered.");
  }
  // validateProfileInput throws TenantProfileError on invalid config.
  // validateProfileInput throws TenantProfileError on invalid config; surface it
  // as an import error.
  try {
    validateProfileInput(exp.profile);
  } catch (err) {
    throw new ProfileImportError(`Invalid profile: ${(err as TenantProfileError).message}`);
  }
  return store.set(targetTenantId, exp.profile);
}
