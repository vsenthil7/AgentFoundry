import { describe, it, expect } from "vitest";
import { PlatformStatus, type PlatformStatusInputs } from "../src/platform_status.js";

function inputs(over: Partial<PlatformStatusInputs> = {}): PlatformStatusInputs {
  return {
    health: { state: "healthy", healthyCount: 3, totalComponents: 3 },
    agents: { total: 5, deployed: 3, retired: 1 },
    reviews: { pending: 0 },
    drift: { agentsScanned: 3, regressions: 0 },
    billing: { tenantsBilled: 2, periodTotalMinor: 25000, currency: "USD" },
    ...over,
  };
}

const status = new PlatformStatus();

describe("assemble", () => {
  it("reports healthy with no flags when all is well", () => {
    const r = status.assemble(inputs());
    expect(r.state).toBe("healthy");
    expect(r.flags).toHaveLength(0);
  });

  it("flags a down platform", () => {
    const r = status.assemble(inputs({ health: { state: "down", healthyCount: 1, totalComponents: 3 } }));
    expect(r.state).toBe("down");
    expect(r.flags[0]).toContain("PLATFORM DOWN");
  });

  it("flags a degraded platform", () => {
    const r = status.assemble(inputs({ health: { state: "degraded", healthyCount: 2, totalComponents: 3 } }));
    expect(r.state).toBe("degraded");
    expect(r.flags.some((f) => f.includes("degraded"))).toBe(true);
  });

  it("escalates healthy to degraded when agents regressed", () => {
    const r = status.assemble(inputs({ drift: { agentsScanned: 3, regressions: 2 } }));
    expect(r.state).toBe("degraded");
    expect(r.flags.some((f) => f.includes("regressed"))).toBe(true);
  });

  it("flags pending reviews", () => {
    const r = status.assemble(inputs({ reviews: { pending: 4 } }));
    expect(r.flags.some((f) => f.includes("awaiting review"))).toBe(true);
  });

  it("orders flags by severity (down first)", () => {
    const r = status.assemble(inputs({
      health: { state: "down", healthyCount: 0, totalComponents: 3 },
      drift: { agentsScanned: 3, regressions: 1 },
      reviews: { pending: 2 },
    }));
    expect(r.flags[0]).toContain("PLATFORM DOWN");
  });

  it("does not downgrade a down platform on regressions", () => {
    const r = status.assemble(inputs({
      health: { state: "down", healthyCount: 0, totalComponents: 3 },
      drift: { agentsScanned: 3, regressions: 1 },
    }));
    expect(r.state).toBe("down");
  });

  it("includes a human-readable summary", () => {
    const r = status.assemble(inputs());
    expect(r.summary).toContain("HEALTHY");
    expect(r.summary).toContain("3/5 agents deployed");
    expect(r.summary).toContain("250.00 USD billed");
  });

  it("passes through component sections", () => {
    const r = status.assemble(inputs());
    expect(r.agents.deployed).toBe(3);
    expect(r.billing.currency).toBe("USD");
  });

  it("escalates healthy to degraded on SLA breaches", () => {
    const r = status.assemble(inputs({ sla: { evaluated: 3, breaches: 2 } }));
    expect(r.state).toBe("degraded");
    expect(r.flags.some((f) => f.includes("breached SLA"))).toBe(true);
  });

  it("does not flag SLA when there are no breaches", () => {
    const r = status.assemble(inputs({ sla: { evaluated: 3, breaches: 0 } }));
    expect(r.flags.some((f) => f.includes("breached SLA"))).toBe(false);
  });

  it("escalates healthy to degraded on config drift", () => {
    const r = status.assemble(inputs({ configDrift: { scanned: 5, drifted: 2 } }));
    expect(r.state).toBe("degraded");
    expect(r.flags.some((f) => f.includes("drifted from config profile"))).toBe(true);
  });

  it("does not flag config drift when none drifted", () => {
    const r = status.assemble(inputs({ configDrift: { scanned: 5, drifted: 0 } }));
    expect(r.flags.some((f) => f.includes("drifted from config profile"))).toBe(false);
  });

  it("uses an injected clock", () => {
    const s = new PlatformStatus(() => "2026-06-08T15:30:00.000Z");
    expect(s.assemble(inputs()).generatedAt).toBe("2026-06-08T15:30:00.000Z");
  });
});
