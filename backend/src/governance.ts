import type { AgentRegistry, RegistryRecord } from "./registry.js";
import type { IncidentLog } from "./monitoring.js";
import type { Marketplace } from "./marketplace.js";
import type { LifecycleState, RiskTier } from "./types.js";

// A record counts toward "approved with record" when it is in a post-approval
// lifecycle state AND carries an approval record. Extracted for clean coverage.
export function isApprovedWithRecord(r: RegistryRecord): boolean {
  const postApproval: LifecycleState[] = ["approved", "exported", "deployed"];
  if (!postApproval.includes(r.state)) return false;
  return r.approval !== undefined;
}

// S11 — Enterprise governance reporting.
// A deterministic, audit-ready report aggregated live from the registry,
// incident log, and marketplace. This is the "sample governance report"
// generated from real state, not hand-written.

export interface GovernanceReport {
  generatedAt: string;
  estate: {
    totalAgents: number;
    byState: Record<LifecycleState, number>;
    byRiskTier: Record<RiskTier, number>;
    deployedHighRisk: number; // deployed agents at high/critical tier
  };
  governance: {
    approvedWithRecord: number; // approved/exported/deployed carrying an approval record
    retiredAgents: number;
    unreviewedDrafts: number;
  };
  cost: {
    byCostCenter: Record<string, number>;
  };
  incidents: {
    total: number;
    byKind: Record<string, number>;
    agentsWithIncidents: number;
  };
  marketplace: {
    publishedPacks: number;
    byTier: Record<string, number>;
  };
  findings: string[]; // plain-language governance findings
}

const ALL_STATES: LifecycleState[] = [
  "draft",
  "in_review",
  "approved",
  "exported",
  "deployed",
  "retired",
];
const ALL_TIERS: RiskTier[] = ["low", "medium", "high", "critical"];

function emptyStateCounts(): Record<LifecycleState, number> {
  return ALL_STATES.reduce(
    (acc, s) => ((acc[s] = 0), acc),
    {} as Record<LifecycleState, number>,
  );
}

function emptyTierCounts(): Record<RiskTier, number> {
  return ALL_TIERS.reduce(
    (acc, t) => ((acc[t] = 0), acc),
    {} as Record<RiskTier, number>,
  );
}

export interface ReportInputs {
  registry: AgentRegistry;
  incidents: IncidentLog;
  marketplace: Marketplace;
  now?: () => string;
}

export function generateGovernanceReport(inp: ReportInputs): GovernanceReport {
  const now = inp.now ?? (() => new Date(0).toISOString());
  const records: RegistryRecord[] = inp.registry.list();

  const byState = emptyStateCounts();
  const byRiskTier = emptyTierCounts();
  let deployedHighRisk = 0;
  let approvedWithRecord = 0;
  let retiredAgents = 0;
  let unreviewedDrafts = 0;

  for (const r of records) {
    byState[r.state]++;
    byRiskTier[r.riskTier]++;
    if (
      r.state === "deployed" &&
      (r.riskTier === "high" || r.riskTier === "critical")
    ) {
      deployedHighRisk++;
    }
    if (isApprovedWithRecord(r)) {
      approvedWithRecord++;
    }
    if (r.state === "retired") retiredAgents++;
    if (r.state === "draft") unreviewedDrafts++;
  }

  // Incidents
  const incidentList = inp.incidents.all();
  const incidentByKind: Record<string, number> = {};
  const agentsWithIncidents = new Set<string>();
  for (const i of incidentList) {
    incidentByKind[i.kind] = (incidentByKind[i.kind] ?? 0) + 1;
    agentsWithIncidents.add(i.agentId);
  }

  // Marketplace
  const packs = inp.marketplace.browse();
  const byTier: Record<string, number> = {};
  for (const p of packs) {
    byTier[p.certificationTier] = (byTier[p.certificationTier] ?? 0) + 1;
  }

  // Findings — deterministic, ordered, plain-language.
  const findings: string[] = [];
  if (deployedHighRisk > 0) {
    findings.push(
      `${deployedHighRisk} high/critical-risk agent(s) are deployed; confirm grounding + HITL on each.`,
    );
  }
  const deployedCount = byState.deployed;
  if (deployedCount > 0 && approvedWithRecord < deployedCount) {
    findings.push(
      `${deployedCount - approvedWithRecord} deployed agent(s) lack a linked approval record — audit gap.`,
    );
  }
  if (incidentList.length > 0) {
    findings.push(
      `${incidentList.length} runtime incident(s) captured across ${agentsWithIncidents.size} agent(s); review regression gate.`,
    );
  }
  if (unreviewedDrafts > 0) {
    findings.push(`${unreviewedDrafts} draft agent(s) awaiting review.`);
  }
  if (findings.length === 0) {
    findings.push("No governance exceptions detected in the current estate.");
  }

  return {
    generatedAt: now(),
    estate: {
      totalAgents: records.length,
      byState,
      byRiskTier,
      deployedHighRisk,
    },
    governance: { approvedWithRecord, retiredAgents, unreviewedDrafts },
    cost: { byCostCenter: inp.registry.costRollup() },
    incidents: {
      total: incidentList.length,
      byKind: incidentByKind,
      agentsWithIncidents: agentsWithIncidents.size,
    },
    marketplace: {
      publishedPacks: packs.length,
      byTier,
    },
    findings,
  };
}

// Render the report as a Markdown document for the pilot pack.
export function renderGovernanceReportMarkdown(r: GovernanceReport): string {
  const lines: string[] = [];
  lines.push(`# Agent Estate Governance Report`);
  lines.push(``);
  lines.push(`Generated: ${r.generatedAt}`);
  lines.push(``);
  lines.push(`## Estate`);
  lines.push(`- Total agents: ${r.estate.totalAgents}`);
  lines.push(`- Deployed high/critical-risk: ${r.estate.deployedHighRisk}`);
  lines.push(
    `- By state: ${Object.entries(r.estate.byState)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `${s}=${n}`)
      .join(", ") || "none"}`,
  );
  lines.push(
    `- By risk tier: ${Object.entries(r.estate.byRiskTier)
      .filter(([, n]) => n > 0)
      .map(([t, n]) => `${t}=${n}`)
      .join(", ") || "none"}`,
  );
  lines.push(``);
  lines.push(`## Governance`);
  lines.push(`- Approved with linked record: ${r.governance.approvedWithRecord}`);
  lines.push(`- Retired agents: ${r.governance.retiredAgents}`);
  lines.push(`- Unreviewed drafts: ${r.governance.unreviewedDrafts}`);
  lines.push(``);
  lines.push(`## Cost by center`);
  const cc = Object.entries(r.cost.byCostCenter);
  if (cc.length === 0) lines.push(`- none`);
  for (const [center, count] of cc) lines.push(`- ${center}: ${count} agent(s)`);
  lines.push(``);
  lines.push(`## Incidents`);
  lines.push(`- Total: ${r.incidents.total} across ${r.incidents.agentsWithIncidents} agent(s)`);
  lines.push(``);
  lines.push(`## Marketplace`);
  lines.push(`- Published packs: ${r.marketplace.publishedPacks}`);
  lines.push(``);
  lines.push(`## Findings`);
  for (const f of r.findings) lines.push(`- ${f}`);
  return lines.join("\n");
}
