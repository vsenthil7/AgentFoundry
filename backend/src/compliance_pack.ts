// S57 — Consolidated compliance pack.
// Assembles a single buyer/auditor-ready bundle from the platform's compliance
// artifacts: a governance summary, the signed audit export (S52), the DR runbook
// (S55), and the tenant's config profile (S56). One artifact answers "show me
// your controls" for procurement and security reviews.

import type { AuditExportBundle } from "./audit_export.js";
import type { DrRunbook } from "./dr_runbook.js";
import type { TenantProfile } from "./tenant_profile.js";

export interface GovernanceSummary {
  totalAgents: number;
  deployedAgents: number;
  certifiedAgents: number;
  openIncidents: number;
}

export interface CompliancePackInput {
  tenantId: string;
  governance: GovernanceSummary;
  auditExport: AuditExportBundle;
  drRunbook: DrRunbook;
  profile: TenantProfile | null;
}

export interface CompliancePack {
  tenantId: string;
  generatedAt: string;
  sections: string[]; // section titles included, in order
  governance: GovernanceSummary;
  auditExport: AuditExportBundle;
  drRunbook: DrRunbook;
  profile: TenantProfile | null;
  markdown: string;
}

export class CompliancePackGenerator {
  private readonly now: () => string;

  constructor(now: () => string = () => new Date(0).toISOString()) {
    this.now = now;
  }

  generate(input: CompliancePackInput): CompliancePack {
    const generatedAt = this.now();
    const sections: string[] = [];
    const lines: string[] = [];

    lines.push(`# Compliance Pack — ${input.tenantId}`);
    lines.push(`Generated: ${generatedAt}`);
    lines.push("");

    sections.push("Governance");
    lines.push(`## Governance`);
    lines.push(`- Agents: ${input.governance.deployedAgents} deployed / ${input.governance.totalAgents} total`);
    lines.push(`- Certified agents: ${input.governance.certifiedAgents}`);
    lines.push(`- Open incidents: ${input.governance.openIncidents}`);
    lines.push("");

    sections.push("Audit trail");
    lines.push(`## Audit trail (signed)`);
    lines.push(`- Ledger entries: ${input.auditExport.ledgerEntries.length}`);
    lines.push(`- Events: ${input.auditExport.events.length}`);
    lines.push(`- Signature: ${input.auditExport.signature}`);
    lines.push("");

    sections.push("Configuration profile");
    lines.push(`## Configuration profile`);
    if (input.profile) {
      lines.push(`- Profile version: v${input.profile.version}`);
      lines.push(`- Promotion policy: ${input.profile.policyId}`);
      lines.push(`- SLA target: ${(input.profile.slaTarget * 100).toFixed(2)}%`);
      lines.push(`- Data residency: ${input.profile.retention.allowedRegions.join(", ")}`);
    } else {
      lines.push(`- No configuration profile on record.`);
    }
    lines.push("");

    sections.push("Disaster recovery");
    lines.push(`## Disaster recovery`);
    lines.push(`- DR readiness: ${input.drRunbook.readiness.toUpperCase().replace("_", " ")}`);
    lines.push(`- DR warnings: ${input.drRunbook.warnings.length}`);
    lines.push("");
    lines.push(`<details><summary>Full DR runbook</summary>`);
    lines.push("");
    lines.push(input.drRunbook.markdown);
    lines.push(`</details>`);

    return {
      tenantId: input.tenantId,
      generatedAt,
      sections,
      governance: input.governance,
      auditExport: input.auditExport,
      drRunbook: input.drRunbook,
      profile: input.profile,
      markdown: lines.join("\n"),
    };
  }
}
