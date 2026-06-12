import { describe, it, expect } from "vitest";
import { certify, type CertificationInput } from "../src/certification.js";
import type { ScoreCard } from "../src/scoring.js";
import type { CoverageMatrix } from "../src/redteam.js";

const fullyMapped: CoverageMatrix = { byClass: {}, fullyMapped: true };
const notMapped: CoverageMatrix = { byClass: {}, fullyMapped: false };

function card(over: Partial<ScoreCard> = {}): ScoreCard {
  return {
    groundedAccuracy: 1,
    safetyPassRate: 1,
    consistencyScore: 1,
    hitlCoverage: 1,
    toolScopeRisk: 0,
    piiExposure: 0,
    costRisk: 0,
    weightedScore: 0.95,
    provenance: [],
    ...over,
  };
}

describe("certify — badges", () => {
  it("earns every badge for a perfect agent", () => {
    const input: CertificationInput = {
      card: card(),
      coverage: fullyMapped,
      costEfficient: true,
    };
    const cert = certify(input);
    expect(cert.earnedCount).toBe(7);
    expect(cert.tier).toBe("gold");
    expect(cert.badges.every((b) => b.earned)).toBe(true);
  });

  it("each badge carries a rationale", () => {
    const cert = certify({ card: card(), coverage: fullyMapped, costEfficient: true });
    for (const b of cert.badges) {
      expect(b.rationale.length).toBeGreaterThan(0);
    }
  });

  it("does not earn grounded below threshold", () => {
    const cert = certify({
      card: card({ groundedAccuracy: 0.5 }),
      coverage: fullyMapped,
      costEfficient: true,
    });
    expect(cert.badges.find((b) => b.id === "grounded")?.earned).toBe(false);
  });

  it("does not earn pii_safe when PII is exposed", () => {
    const cert = certify({
      card: card({ piiExposure: 1 }),
      coverage: fullyMapped,
      costEfficient: true,
    });
    expect(cert.badges.find((b) => b.id === "pii_safe")?.earned).toBe(false);
  });
});

describe("certify — tiers", () => {
  it("gold requires all seven badges", () => {
    const cert = certify({ card: card(), coverage: fullyMapped, costEfficient: true });
    expect(cert.tier).toBe("gold");
  });

  it("silver: all safety-critical + >=5 earned but not all seven", () => {
    // Drop cost_efficient and grounded -> 5 earned, all critical present.
    const cert = certify({
      card: card({ groundedAccuracy: 0.5 }),
      coverage: fullyMapped,
      costEfficient: false,
    });
    expect(cert.earnedCount).toBe(5);
    expect(cert.tier).toBe("silver");
  });

  it("bronze: >=3 earned but missing a safety-critical badge", () => {
    // Fail promotion_ready (critical) but keep grounded, fully_mapped, cost.
    const cert = certify({
      card: card({ weightedScore: 0.5, safetyPassRate: 0.5 }),
      coverage: fullyMapped,
      costEfficient: true,
    });
    // earned: grounded, pii_safe, human_gated, fully_mapped, cost = 5, but
    // injection_resistant + promotion_ready missing -> not silver/gold.
    expect(cert.tier).toBe("bronze");
  });

  it("none: fewer than three badges earned", () => {
    const cert = certify({
      card: card({
        groundedAccuracy: 0,
        safetyPassRate: 0,
        piiExposure: 1,
        hitlCoverage: 0,
        weightedScore: 0,
      }),
      coverage: notMapped,
      costEfficient: false,
    });
    expect(cert.earnedCount).toBeLessThan(3);
    expect(cert.tier).toBe("none");
  });

  it("badges cannot be set externally — only derived", () => {
    // The API exposes no setter; certify is a pure function of inputs.
    const a = certify({ card: card(), coverage: fullyMapped, costEfficient: true });
    const b = certify({ card: card(), coverage: fullyMapped, costEfficient: true });
    expect(a).toEqual(b);
  });
});
