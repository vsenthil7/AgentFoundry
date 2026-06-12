// S63 — Profile-change audit trail.
// Wraps tenant-profile lifecycle operations (set / apply / rollback) so each one
// emits a platform event (S21) and a tamper-evident audit ledger entry (S14).
// Configuration changes become first-class, attributable, and provable — the
// same governance applied to agent promotions.

import type { EventBus } from "./events.js";
import type { AuditLedger } from "./persistence.js";
import type { TenantProfile } from "./tenant_profile.js";

export interface AuditedProfileDeps {
  events: EventBus;
  ledger: AuditLedger;
}

// Record a profile lifecycle action: appends to the ledger and publishes an event.
export async function auditProfileAction(
  deps: AuditedProfileDeps,
  action: "updated" | "applied" | "rolledback",
  actor: string,
  profile: TenantProfile,
  detail = "",
): Promise<void> {
  deps.ledger.append({
    actor,
    action: `profile.${action}`,
    subject: `${profile.tenantId}:v${profile.version}`,
    detail,
  });
  await deps.events.publish({
    type: `profile.${action}` as "profile.updated" | "profile.applied" | "profile.rolledback",
    tenantId: profile.tenantId,
    subject: `profile:v${profile.version}`,
    payload: { version: profile.version, policyId: profile.policyId, detail },
  });
}
