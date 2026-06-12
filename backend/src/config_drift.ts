// S62 — Config drift detection.
// Detects when live subsystem settings have diverged from the tenant's active
// profile (S56) — e.g. a quota limit was changed out-of-band, or a residency
// region was added directly. Reads the live state through injected probes and
// compares to the profile, producing explainable drift findings. This is config
// drift, distinct from behavioral drift (S41).

import type { TenantProfile } from "./tenant_profile.js";
import type { QuotaLimits } from "./ratelimit.js";
import type { Region, DataClass } from "./data_governance.js";

export interface LiveConfigProbe {
  // Live quota limits for the tenant (or null if none set).
  quotaLimits: () => QuotaLimits | null;
  // Live retention days per data class.
  retentionDays: () => Partial<Record<DataClass, number>> | null;
  // Live allowed residency regions.
  allowedRegions: () => readonly Region[] | null;
  // Live SLA target (or null).
  slaTarget: () => number | null;
}

export interface ConfigDriftFinding {
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface ConfigDriftReport {
  tenantId: string;
  profileVersion: number;
  findings: ConfigDriftFinding[];
  inSync: boolean;
}

export function detectConfigDrift(
  profile: TenantProfile,
  probe: LiveConfigProbe,
): ConfigDriftReport {
  const findings: ConfigDriftFinding[] = [];

  const liveQuota = probe.quotaLimits();
  if (JSON.stringify(liveQuota?.limits ?? null) !== JSON.stringify(profile.quotaLimits.limits)) {
    findings.push({ field: "quotaLimits", expected: profile.quotaLimits.limits, actual: liveQuota?.limits ?? null });
  }

  const liveRetention = probe.retentionDays();
  if (JSON.stringify(liveRetention ?? null) !== JSON.stringify(profile.retention.retentionDays)) {
    findings.push({ field: "retention.retentionDays", expected: profile.retention.retentionDays, actual: liveRetention ?? null });
  }

  const liveRegions = probe.allowedRegions();
  const expectedRegions = [...profile.retention.allowedRegions].sort();
  const actualRegions = liveRegions ? [...liveRegions].sort() : null;
  if (JSON.stringify(actualRegions) !== JSON.stringify(expectedRegions)) {
    findings.push({ field: "retention.allowedRegions", expected: expectedRegions, actual: actualRegions });
  }

  const liveSla = probe.slaTarget();
  if (liveSla !== profile.slaTarget) {
    findings.push({ field: "slaTarget", expected: profile.slaTarget, actual: liveSla });
  }

  return {
    tenantId: profile.tenantId,
    profileVersion: profile.version,
    findings,
    inSync: findings.length === 0,
  };
}
