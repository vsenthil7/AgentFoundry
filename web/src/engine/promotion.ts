import type { AgentDesign } from "./types.js";
import type { ScoreCard } from "./scoring.js";
import { meetsPromotionThreshold } from "./scoring.js";

// No agent promotes itself. Promotion requires BOTH a passing weighted score
// AND an explicit human approval. The approval record is immutable (frozen).

export interface ApprovalRecord {
  readonly designId: string;
  readonly designVersion: string;
  readonly reviewer: string;
  readonly decision: "approved" | "rejected";
  readonly weightedScore: number;
  readonly timestamp: string;
}

export type PromotionOutcome =
  | { state: "threshold_failed"; reason: string }
  | { state: "human_rejected"; record: ApprovalRecord }
  | { state: "approved"; record: ApprovalRecord };

export function requestPromotion(
  design: AgentDesign,
  card: ScoreCard,
  reviewer: { id: string; decision: "approved" | "rejected" },
  now: () => string = () => new Date(0).toISOString(),
): PromotionOutcome {
  if (!meetsPromotionThreshold(card)) {
    return {
      state: "threshold_failed",
      reason: `Weighted score ${card.weightedScore} below threshold.`,
    };
  }
  const record: ApprovalRecord = Object.freeze({
    designId: design.id,
    designVersion: design.sdlc.version,
    reviewer: reviewer.id,
    decision: reviewer.decision,
    weightedScore: card.weightedScore,
    timestamp: now(),
  });
  if (reviewer.decision === "rejected") {
    return { state: "human_rejected", record };
  }
  return { state: "approved", record };
}
