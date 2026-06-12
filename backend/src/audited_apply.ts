// S66 — Audited profile apply orchestrator.
// Combines applying a profile to live subsystems (S61) with the profile-change
// audit trail (S63): a single call that makes the config effective AND records
// the event + tamper-evident ledger entry. On apply failure, records nothing and
// rethrows — the audit trail only reflects successful, effective changes.

import { applyProfile, type ProfileApplyDeps, type ProfileApplyResult } from "./profile_apply.js";
import { auditProfileAction, type AuditedProfileDeps } from "./audited_profile.js";
import type { TenantProfile } from "./tenant_profile.js";

export interface AuditedApplyDeps {
  subsystems: ProfileApplyDeps;
  audit: AuditedProfileDeps;
}

// Apply a profile and, only if it succeeds, record the audit trail.
export async function applyProfileAudited(
  profile: TenantProfile,
  actor: string,
  deps: AuditedApplyDeps,
): Promise<ProfileApplyResult> {
  // Apply first; if this throws (partial apply), no audit entry is written.
  const result = applyProfile(profile, deps.subsystems);
  // Record the successful, effective change.
  await auditProfileAction(deps.audit, "applied", actor, profile, `subsystems: ${result.applied.join(", ")}`);
  return result;
}
