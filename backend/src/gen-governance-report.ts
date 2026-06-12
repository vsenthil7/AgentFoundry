// Generates a realistic sample governance report from a populated estate.
// Run: npx tsx src/gen-governance-report.ts > ../docs/SAMPLE_GOVERNANCE_REPORT.md
import {
  acmeSupportBot,
  AgentRegistry,
  IncidentLog,
  Marketplace,
  DeterministicCaseGenerator,
  generateGovernanceReport,
  renderGovernanceReportMarkdown,
  type AgentDesign,
} from "./index.js";

const TS = "2026-06-08T10:30:00.000Z";

const reg = new AgentRegistry(() => TS);

// Deployed, approved, high-risk support bot.
reg.register(acmeSupportBot(), "support-team@acme.test");
reg.transition("acme-support-bot", "in_review", "reviewer@acme.test");
reg.transition("acme-support-bot", "approved", "reviewer@acme.test", {
  approval: Object.freeze({
    designId: "acme-support-bot",
    designVersion: "1.0.0",
    reviewer: "reviewer@acme.test",
    decision: "approved",
    weightedScore: 0.92,
    timestamp: TS,
  }),
});
reg.transition("acme-support-bot", "exported", "ci-bot");
reg.transition("acme-support-bot", "deployed", "ops@acme.test");

// A medium-risk billing bot still in draft.
const billing: AgentDesign = {
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
reg.register(billing, "billing@acme.test");

// A retired legacy bot.
const legacy: AgentDesign = {
  ...acmeSupportBot(),
  id: "legacy-faq-bot",
  name: "Legacy FAQ Bot",
  sdlc: { ...acmeSupportBot().sdlc, costCenter: "CC-LEGACY-003" },
};
reg.register(legacy, "support-team@acme.test");
reg.retire("legacy-faq-bot", "admin@acme.test", "decommissioned post-incident");

const incidents = new IncidentLog();
incidents.capture({
  agentId: "acme-support-bot",
  kind: "drift",
  detail: "grounded-accuracy dropped 0.06 vs baseline",
  timestamp: TS,
});

const mp = new Marketplace();
mp.publish({
  id: "pack-acme-support",
  kind: "agent_template",
  name: "Acme Support Template",
  publisher: "acme",
  version: "1.0.0",
  certificationTier: "gold",
  publishedAt: TS,
  manifest: {
    schemaVersion: "1.0",
    agent: acmeSupportBot(),
    evalSuite: new DeterministicCaseGenerator().generate(acmeSupportBot()),
    redTeamSuite: [],
  },
});

const report = generateGovernanceReport({
  registry: reg,
  incidents,
  marketplace: mp,
  now: () => TS,
});

process.stdout.write(renderGovernanceReportMarkdown(report) + "\n");
