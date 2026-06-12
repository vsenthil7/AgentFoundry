// Core domain model for AgentFoundry.
// An agent design is a directed graph of typed nodes plus SDLC metadata.

export type NodeType =
  | "model"
  | "prompt"
  | "tool"
  | "grounding"
  | "guardrail"
  | "hitl"; // human-in-the-loop gate

export type RiskTier = "low" | "medium" | "high" | "critical";

export type LifecycleState =
  | "draft"
  | "in_review"
  | "approved"
  | "exported"
  | "deployed"
  | "retired";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  config: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface ToolPermission {
  // A designed agent's tool capabilities. Write/send are sensitive and must be gated.
  toolId: string;
  scope: "read" | "write" | "send";
}

export interface SdlcControls {
  version: string;
  owner: string;
  riskTier: RiskTier;
  costCenter: string;
  toolPermissions: ToolPermission[];
  dataAccessProfile: string[];
  lifecycleState: LifecycleState;
}

export interface AgentDesign {
  id: string;
  name: string;
  purpose: string; // declared purpose; drives eval generation
  nodes: GraphNode[];
  edges: GraphEdge[];
  sdlc: SdlcControls;
}

// ---- Graph validation result types ----

export type GraphErrorCode =
  | "EMPTY_GRAPH"
  | "MISSING_PURPOSE"
  | "CYCLE_DETECTED"
  | "INVALID_EDGE"
  | "MISSING_MODEL"
  | "MISSING_GROUNDING"
  | "MISSING_HITL_FOR_WRITE"
  | "UNSAFE_TOOL_PERMISSION"
  | "DUPLICATE_NODE_ID"
  | "ORPHAN_NODE";

export interface GraphIssue {
  code: GraphErrorCode;
  message: string;
  nodeId?: string;
}

export interface CompileResult {
  valid: boolean;
  issues: GraphIssue[];
  // Topologically sorted node ids when valid; empty when invalid.
  order: string[];
}
