// S61 — Apply tenant profile to live subsystems.
// Pushes a versioned tenant profile (S56) into the actual running subsystems —
// quota limits (S24), retention/residency policy (S19), and SLA target (S51) —
// in one ordered operation, reporting which subsystems were applied. This is how
// a config change becomes effective, complementing onboarding (S43).

import type { TenantProfile } from "./tenant_profile.js";
import type { QuotaManager } from "./ratelimit.js";
import type { DataGovernance } from "./data_governance.js";
import type { SlaTracker } from "./sla.js";

export interface ProfileApplyDeps {
  quotas: QuotaManager;
  governance: DataGovernance;
  sla: SlaTracker;
}

export interface ProfileApplyResult {
  tenantId: string;
  version: number;
  applied: string[]; // subsystems applied, in order
}

export class ProfileApplyError extends Error {
  constructor(applied: string[], cause: string) {
    super(`Profile apply failed after [${applied.join(", ")}]: ${cause}`);
    this.name = "ProfileApplyError";
  }
}

// Apply the profile to each subsystem in a fixed order. If a step throws, the
// error names the subsystems already applied (partial-apply visibility).
export function applyProfile(profile: TenantProfile, deps: ProfileApplyDeps): ProfileApplyResult {
  const applied: string[] = [];
  try {
    deps.quotas.setLimits(profile.tenantId, profile.quotaLimits);
    applied.push("quotas");

    deps.governance.setPolicy({
      tenantId: profile.tenantId,
      retentionDays: profile.retention.retentionDays,
      allowedRegions: profile.retention.allowedRegions,
    });
    applied.push("retention");

    deps.sla.setTarget(profile.tenantId, { target: profile.slaTarget });
    applied.push("sla");
  } catch (err) {
    throw new ProfileApplyError(applied, err instanceof Error ? err.message : String(err));
  }

  return { tenantId: profile.tenantId, version: profile.version, applied };
}
