import type { AgentDesign } from "./types.js";

// SEED_MANIFEST: the Golden Thread seed agent walked end-to-end in the demo.
export function acmeSupportBot(
  overrides: { withGrounding?: boolean; withGuardrail?: boolean } = {
    withGrounding: true,
    withGuardrail: true,
  },
): AgentDesign {
  const nodes: AgentDesign["nodes"] = [
    {
      id: "model-1",
      type: "model",
      label: "GPT-class model",
      config: { model: "foundry-default" },
    },
    {
      id: "prompt-1",
      type: "prompt",
      label: "System prompt",
      config: {
        text: "You are Acme's support bot. Answer only from approved sources.",
      },
    },
    {
      id: "hitl-1",
      type: "hitl",
      label: "Human gate for sends",
      config: {},
    },
  ];

  if (overrides.withGrounding) {
    nodes.push({
      id: "grounding-1",
      type: "grounding",
      label: "Foundry IQ — Acme KB",
      config: {
        facts: [
          "Support hours are 9am to 5pm.",
          "The refund window is 30 days.",
        ],
      },
    });
  }

  if (overrides.withGuardrail) {
    nodes.push({
      id: "guardrail-1",
      type: "guardrail",
      label: "PII + injection guardrail",
      config: { blocks: ["pii", "prompt_injection"] },
    });
  }

  const edges: AgentDesign["edges"] = [
    { from: "prompt-1", to: "model-1" },
    { from: "model-1", to: "hitl-1" },
  ];
  if (overrides.withGrounding) edges.push({ from: "grounding-1", to: "model-1" });
  if (overrides.withGuardrail) edges.push({ from: "guardrail-1", to: "model-1" });

  return {
    id: "acme-support-bot",
    name: "Acme Support Bot",
    purpose: "Provide customer support answers for Acme from approved sources.",
    nodes,
    edges,
    sdlc: {
      version: "1.0.0",
      owner: "support-team@acme.test",
      riskTier: "high",
      costCenter: "CC-SUPPORT-001",
      toolPermissions: [{ toolId: "send_email", scope: "send" }],
      dataAccessProfile: ["acme-kb"],
      lifecycleState: "draft",
    },
  };
}

// The grounded knowledge the stub model uses when grounding is wired.
export function acmeGroundedModelTable(): Record<string, string> {
  return {
    "ctx:Support hours are 9am to 5pm.:What are your support hours?":
      "Our support hours are 9am to 5pm.",
    "ctx:The refund window is 30 days.:What is the refund window?":
      "The refund window is 30 days.",
  };
}
