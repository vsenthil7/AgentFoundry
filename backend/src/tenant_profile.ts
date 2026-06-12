// S56 — Per-tenant configuration profiles.
// Bundles a tenant's operational configuration — promotion policy id, quota
// limits, retention/residency, and SLA target — into one versioned, validated
// profile. Versioning lets a tenant's config be changed deliberately and rolled
// back, the same discipline applied to agents (S25).

import type { QuotaLimits } from "./ratelimit.js";
import type { RetentionPolicy } from "./data_governance.js";

export interface TenantProfile {
  readonly tenantId: string;
  readonly version: number;
  readonly policyId: string; // references a PolicyRegistry entry
  readonly quotaLimits: QuotaLimits;
  readonly retention: Omit<RetentionPolicy, "tenantId">;
  readonly slaTarget: number; // availability fraction, e.g. 0.999
  readonly updatedAt: string;
}

export interface TenantProfileInput {
  policyId: string;
  quotaLimits: QuotaLimits;
  retention: Omit<RetentionPolicy, "tenantId">;
  slaTarget: number;
}

export class TenantProfileError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TenantProfileError";
  }
}

export function validateProfileInput(input: TenantProfileInput): void {
  if (!input.policyId) {
    throw new TenantProfileError("policyId is required.");
  }
  if (input.slaTarget <= 0 || input.slaTarget > 1) {
    throw new TenantProfileError("slaTarget must be in (0, 1].");
  }
  if (input.retention.allowedRegions.length === 0) {
    throw new TenantProfileError("At least one allowed region is required.");
  }
}

export class TenantProfileStore {
  // tenantId -> version history (index 0 = v1).
  private readonly history = new Map<string, TenantProfile[]>();
  private readonly now: () => string;

  constructor(now: () => string = () => new Date(0).toISOString()) {
    this.now = now;
  }

  // Set (create or update) a tenant's profile, producing a new version.
  set(tenantId: string, input: TenantProfileInput): TenantProfile {
    validateProfileInput(input);
    const versions = this.history.get(tenantId) ?? [];
    const profile: TenantProfile = Object.freeze({
      tenantId,
      version: versions.length + 1,
      policyId: input.policyId,
      quotaLimits: { limits: { ...input.quotaLimits.limits } },
      retention: {
        retentionDays: { ...input.retention.retentionDays },
        allowedRegions: [...input.retention.allowedRegions],
      },
      slaTarget: input.slaTarget,
      updatedAt: this.now(),
    });
    versions.push(profile);
    this.history.set(tenantId, versions);
    return profile;
  }

  // Current (latest) profile for a tenant, or null.
  current(tenantId: string): TenantProfile | null {
    const versions = this.history.get(tenantId);
    return versions && versions.length > 0 ? versions[versions.length - 1] : null;
  }

  getVersion(tenantId: string, version: number): TenantProfile | null {
    const versions = this.history.get(tenantId);
    if (!versions) return null;
    return versions.find((p) => p.version === version) ?? null;
  }

  versions(tenantId: string): TenantProfile[] {
    return [...(this.history.get(tenantId) ?? [])];
  }

  // Roll back to a prior version by re-applying its config as a new version.
  rollback(tenantId: string, toVersion: number): TenantProfile {
    const target = this.getVersion(tenantId, toVersion);
    if (!target) {
      throw new TenantProfileError(`Version ${toVersion} not found for ${tenantId}.`);
    }
    return this.set(tenantId, {
      policyId: target.policyId,
      quotaLimits: target.quotaLimits,
      retention: target.retention,
      slaTarget: target.slaTarget,
    });
  }
}

export interface ProfileFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ProfileDiff {
  tenantId: string;
  fromVersion: number;
  toVersion: number;
  changes: ProfileFieldChange[];
  hasChanges: boolean;
}

// Compare two profiles field-by-field, producing an explainable diff.
export function diffProfiles(before: TenantProfile, after: TenantProfile): ProfileDiff {
  const changes: ProfileFieldChange[] = [];

  if (before.policyId !== after.policyId) {
    changes.push({ field: "policyId", before: before.policyId, after: after.policyId });
  }
  if (before.slaTarget !== after.slaTarget) {
    changes.push({ field: "slaTarget", before: before.slaTarget, after: after.slaTarget });
  }
  if (JSON.stringify(before.quotaLimits) !== JSON.stringify(after.quotaLimits)) {
    changes.push({ field: "quotaLimits", before: before.quotaLimits, after: after.quotaLimits });
  }
  // Retention days.
  if (JSON.stringify(before.retention.retentionDays) !== JSON.stringify(after.retention.retentionDays)) {
    changes.push({ field: "retention.retentionDays", before: before.retention.retentionDays, after: after.retention.retentionDays });
  }
  // Allowed regions (order-insensitive).
  const beforeRegions = [...before.retention.allowedRegions].sort();
  const afterRegions = [...after.retention.allowedRegions].sort();
  if (JSON.stringify(beforeRegions) !== JSON.stringify(afterRegions)) {
    changes.push({ field: "retention.allowedRegions", before: beforeRegions, after: afterRegions });
  }

  return {
    tenantId: after.tenantId,
    fromVersion: before.version,
    toVersion: after.version,
    changes,
    hasChanges: changes.length > 0,
  };
}

export interface ProfileHistoryEntry {
  profile: TenantProfile;
  diffFromPrevious: ProfileDiff | null; // null for the first version
}

// Build a tenant's version history annotated with the diff from each previous
// version, for change-review UIs and the history API.
export function historyWithDiffs(versions: TenantProfile[]): ProfileHistoryEntry[] {
  return versions.map((profile, i) => ({
    profile,
    diffFromPrevious: i === 0 ? null : diffProfiles(versions[i - 1], profile),
  }));
}
