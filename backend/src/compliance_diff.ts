// S73 — Compliance snapshot diff.
// Compares two archived compliance packs (S57/S70) and reports what changed in
// the platform's compliance posture between them: DR readiness, governance
// counts, audit volume, and config profile version. Lets an auditor see "what
// moved" between two points in the snapshot time series.

import type { CompliancePack } from "./compliance_pack.js";

export interface PostureChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface CompliancePostureDiff {
  tenantId: string;
  fromGeneratedAt: string;
  toGeneratedAt: string;
  changes: PostureChange[];
  hasChanges: boolean;
}

export function diffCompliancePacks(
  before: CompliancePack,
  after: CompliancePack,
): CompliancePostureDiff {
  const changes: PostureChange[] = [];

  if (before.drRunbook.readiness !== after.drRunbook.readiness) {
    changes.push({ field: "drReadiness", before: before.drRunbook.readiness, after: after.drRunbook.readiness });
  }
  if (before.governance.deployedAgents !== after.governance.deployedAgents) {
    changes.push({ field: "deployedAgents", before: before.governance.deployedAgents, after: after.governance.deployedAgents });
  }
  if (before.governance.certifiedAgents !== after.governance.certifiedAgents) {
    changes.push({ field: "certifiedAgents", before: before.governance.certifiedAgents, after: after.governance.certifiedAgents });
  }
  if (before.governance.openIncidents !== after.governance.openIncidents) {
    changes.push({ field: "openIncidents", before: before.governance.openIncidents, after: after.governance.openIncidents });
  }
  const beforeAudit = before.auditExport.ledgerEntries.length + before.auditExport.events.length;
  const afterAudit = after.auditExport.ledgerEntries.length + after.auditExport.events.length;
  if (beforeAudit !== afterAudit) {
    changes.push({ field: "auditRecordCount", before: beforeAudit, after: afterAudit });
  }
  const beforeProfile = before.profile?.version ?? null;
  const afterProfile = after.profile?.version ?? null;
  if (beforeProfile !== afterProfile) {
    changes.push({ field: "profileVersion", before: beforeProfile, after: afterProfile });
  }

  return {
    tenantId: after.tenantId,
    fromGeneratedAt: before.generatedAt,
    toGeneratedAt: after.generatedAt,
    changes,
    hasChanges: changes.length > 0,
  };
}
