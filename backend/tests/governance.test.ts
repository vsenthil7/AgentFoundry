import { describe, it, expect } from "vitest";
import {
  generateGovernanceReport,
  renderGovernanceReportMarkdown,
  isApprovedWithRecord,
} from "../src/governance.js";
import { AgentRegistry } from "../src/registry.js";
import { IncidentLog } from "../src/monitoring.js";
import { Marketplace } from "../src/marketplace.js";
import { DeterministicCaseGenerator } from "../src/eval.js";
import { acmeSupportBot } from "../src/seed.js";
import type { AgentDesign } from "../src/types.js";

const TS = new Date(0).toISOString();

function billingBot(): AgentDesign {
  return {
    ...acmeSupportBot(),
    id: "billing-bot",
    name: "Billing Bot",
    sdlc: {
      ...acmeSupportBot().sdlc,
      owner: "billing@acme.test",
      riskTier: "medium",
      costCenter: "CC-BILLING-002",
    },
  };
}

function deployAcme(reg: AgentRegistry, withApproval = true) {
  reg.register(acmeSupportBot(), "owner@acme.test");
  reg.transition("acme-support-bot", "in_review", "r");
  const approval = withApproval
    ? Object.freeze({
        designId: "acme-support-bot",
        designVersion: "1.0.0",
        reviewer: "reviewer@acme.test",
        decision: "approved" as const,
        weightedScore: 0.92,
        timestamp: TS,
      })
    : undefined;
  reg.transition("acme-support-bot", "approved", "r", { approval });
  reg.transition("acme-support-bot", "exported", "ci");
  reg.transition("acme-support-bot", "deployed", "ops");
}

describe("generateGovernanceReport — empty estate", () => {
  it("reports zeros and a no-exceptions finding", () => {
    const report = generateGovernanceReport({
      registry: new AgentRegistry(),
      incidents: new IncidentLog(),
      marketplace: new Marketplace(),
    });
    expect(report.estate.totalAgents).toBe(0);
    expect(report.findings).toContain(
      "No governance exceptions detected in the current estate.",
    );
  });
});

describe("generateGovernanceReport — populated estate", () => {
  function build() {
    const reg = new AgentRegistry();
    deployAcme(reg, true);
    reg.register(billingBot(), "billing@acme.test"); // stays draft

    // A third agent that has been retired (post-incident decommissioning).
    const legacy: AgentDesign = {
      ...acmeSupportBot(),
      id: "legacy-bot",
      name: "Legacy Bot",
      sdlc: { ...acmeSupportBot().sdlc, costCenter: "CC-LEGACY-003" },
    };
    reg.register(legacy, "o");
    reg.retire("legacy-bot", "admin", "decommissioned");

    const incidents = new IncidentLog();
    incidents.capture({
      agentId: "acme-support-bot",
      kind: "regression",
      detail: "atk regressed",
      timestamp: TS,
    });

    const mp = new Marketplace();
    mp.publish({
      id: "pack-acme",
      kind: "eval_pack",
      name: "Acme Evals",
      publisher: "acme",
      version: "1.0.0",
      certificationTier: "gold",
      publishedAt: TS,
      cases: new DeterministicCaseGenerator().generate(acmeSupportBot()),
    });

    return generateGovernanceReport({ registry: reg, incidents, marketplace: mp });
  }

  it("counts agents by state and risk tier", () => {
    const r = build();
    expect(r.estate.totalAgents).toBe(3);
    expect(r.estate.byState.deployed).toBe(1);
    expect(r.estate.byState.draft).toBe(1);
    expect(r.estate.byState.retired).toBe(1);
    expect(r.governance.retiredAgents).toBe(1);
    expect(r.estate.byRiskTier.high).toBe(2);
    expect(r.estate.byRiskTier.medium).toBe(1);
  });

  it("flags deployed high-risk agents", () => {
    const r = build();
    expect(r.estate.deployedHighRisk).toBe(1);
    expect(r.findings.join()).toContain("high/critical-risk agent");
  });

  it("counts approval records and drafts", () => {
    const r = build();
    expect(r.governance.approvedWithRecord).toBe(1);
    expect(r.governance.unreviewedDrafts).toBe(1);
    expect(r.findings.join()).toContain("draft agent(s) awaiting review");
  });

  it("aggregates incidents", () => {
    const r = build();
    expect(r.incidents.total).toBe(1);
    expect(r.incidents.byKind.regression).toBe(1);
    expect(r.incidents.agentsWithIncidents).toBe(1);
    expect(r.findings.join()).toContain("runtime incident");
  });

  it("rolls up cost centers", () => {
    const r = build();
    expect(r.cost.byCostCenter["CC-SUPPORT-001"]).toBe(1);
    expect(r.cost.byCostCenter["CC-BILLING-002"]).toBe(1);
  });

  it("summarises the marketplace by tier", () => {
    const r = build();
    expect(r.marketplace.publishedPacks).toBe(1);
    expect(r.marketplace.byTier.gold).toBe(1);
  });
});

describe("audit-gap finding — deployed without approval record", () => {
  it("flags a deployed agent that lacks an approval record", () => {
    const reg = new AgentRegistry();
    deployAcme(reg, false); // deployed but no approval record attached
    const r = generateGovernanceReport({
      registry: reg,
      incidents: new IncidentLog(),
      marketplace: new Marketplace(),
    });
    expect(r.governance.approvedWithRecord).toBe(0);
    expect(r.findings.join()).toContain("lack a linked approval record");
  });

  it("counts a critical-tier deployed agent as deployed-high-risk", () => {
    const reg = new AgentRegistry();
    const critical: AgentDesign = {
      ...acmeSupportBot(),
      sdlc: { ...acmeSupportBot().sdlc, riskTier: "critical" },
    };
    reg.register(critical, "o");
    reg.transition("acme-support-bot", "in_review", "r");
    reg.transition("acme-support-bot", "approved", "r");
    reg.transition("acme-support-bot", "exported", "ci");
    reg.transition("acme-support-bot", "deployed", "ops");
    const r = generateGovernanceReport({
      registry: reg,
      incidents: new IncidentLog(),
      marketplace: new Marketplace(),
    });
    expect(r.estate.byRiskTier.critical).toBe(1);
    expect(r.estate.deployedHighRisk).toBe(1);
  });

  it("counts an agent left in approved state with a record", () => {
    const reg = new AgentRegistry();
    reg.register(acmeSupportBot(), "o");
    reg.transition("acme-support-bot", "in_review", "r");
    const approval = Object.freeze({
      designId: "acme-support-bot",
      designVersion: "1.0.0",
      reviewer: "reviewer@acme.test",
      decision: "approved" as const,
      weightedScore: 0.92,
      timestamp: TS,
    });
    reg.transition("acme-support-bot", "approved", "r", { approval });
    const r = generateGovernanceReport({
      registry: reg,
      incidents: new IncidentLog(),
      marketplace: new Marketplace(),
    });
    expect(r.governance.approvedWithRecord).toBe(1);
    expect(r.estate.byState.approved).toBe(1);
  });

  it("counts an agent left in exported state with a record", () => {
    const reg = new AgentRegistry();
    reg.register(acmeSupportBot(), "o");
    reg.transition("acme-support-bot", "in_review", "r");
    const approval = Object.freeze({
      designId: "acme-support-bot",
      designVersion: "1.0.0",
      reviewer: "reviewer@acme.test",
      decision: "approved" as const,
      weightedScore: 0.92,
      timestamp: TS,
    });
    reg.transition("acme-support-bot", "approved", "r", { approval });
    reg.transition("acme-support-bot", "exported", "ci");
    const r = generateGovernanceReport({
      registry: reg,
      incidents: new IncidentLog(),
      marketplace: new Marketplace(),
    });
    expect(r.governance.approvedWithRecord).toBe(1);
    expect(r.estate.byState.exported).toBe(1);
  });
});

describe("isApprovedWithRecord predicate", () => {
  const approval = Object.freeze({
    designId: "x",
    designVersion: "1.0.0",
    reviewer: "r",
    decision: "approved" as const,
    weightedScore: 0.9,
    timestamp: TS,
  });
  function rec(state: string, withApproval: boolean) {
    return {
      id: "x",
      name: "x",
      owner: "o",
      riskTier: "high" as const,
      costCenter: "CC",
      currentVersion: "1.0.0",
      state: state as never,
      design: acmeSupportBot(),
      versions: ["1.0.0"],
      lineage: [],
      approval: withApproval ? approval : undefined,
    };
  }

  it("true for a post-approval state with a record", () => {
    expect(isApprovedWithRecord(rec("deployed", true))).toBe(true);
    expect(isApprovedWithRecord(rec("approved", true))).toBe(true);
    expect(isApprovedWithRecord(rec("exported", true))).toBe(true);
  });

  it("false for a post-approval state without a record", () => {
    expect(isApprovedWithRecord(rec("deployed", false))).toBe(false);
  });

  it("false for a pre-approval state even with a record", () => {
    expect(isApprovedWithRecord(rec("draft", true))).toBe(false);
    expect(isApprovedWithRecord(rec("in_review", true))).toBe(false);
    expect(isApprovedWithRecord(rec("retired", true))).toBe(false);
  });
});

describe("renderGovernanceReportMarkdown", () => {
  it("renders a populated report with all sections", () => {
    const reg = new AgentRegistry();
    deployAcme(reg, true);
    const mp = new Marketplace();
    mp.publish({
      id: "p",
      kind: "redteam_pack",
      name: "RT",
      publisher: "sec",
      version: "1.0.0",
      certificationTier: "silver",
      publishedAt: TS,
      attacks: [
        { id: "a", name: "n", class: "jailbreak", payload: "p", leakMarker: "m", mapping: { owasp: "LLM01" } },
      ],
    });
    const report = generateGovernanceReport({
      registry: reg,
      incidents: new IncidentLog(),
      marketplace: mp,
    });
    const md = renderGovernanceReportMarkdown(report);
    expect(md).toContain("# Agent Estate Governance Report");
    expect(md).toContain("## Estate");
    expect(md).toContain("## Cost by center");
    expect(md).toContain("CC-SUPPORT-001");
    expect(md).toContain("## Findings");
  });

  it("renders empty-estate report with 'none' placeholders", () => {
    const report = generateGovernanceReport({
      registry: new AgentRegistry(),
      incidents: new IncidentLog(),
      marketplace: new Marketplace(),
    });
    const md = renderGovernanceReportMarkdown(report);
    // empty state/tier lists and empty cost rollup all render "none".
    expect(md).toContain("By state: none");
    expect(md).toContain("By risk tier: none");
    expect(md.split("\n").some((l) => l === "- none")).toBe(true);
  });
});
