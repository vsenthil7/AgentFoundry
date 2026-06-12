import { describe, it, expect } from "vitest";
import { BillingEngine, type RateCard } from "../src/billing.js";

const T = Date.parse("2026-06-08T00:00:00.000Z");

const rateCard: RateCard = {
  currency: "USD",
  unitPrices: { agents: 100, eval_runs: 5, deployments: 50, api_calls: 1 },
  platformFee: 10000,
};

describe("metering", () => {
  it("accumulates metered usage", () => {
    const b = new BillingEngine(rateCard, () => T);
    b.meter("t1", "eval_runs", 3);
    b.meter("t1", "eval_runs", 2);
    expect(b.meteredQuantity("t1", "eval_runs")).toBe(5);
  });

  it("returns zero for unmetered resources", () => {
    const b = new BillingEngine(rateCard, () => T);
    expect(b.meteredQuantity("t1", "agents")).toBe(0);
  });

  it("rejects negative quantities", () => {
    const b = new BillingEngine(rateCard, () => T);
    expect(() => b.meter("t1", "agents", -1)).toThrow();
  });

  it("defaults quantity to 1", () => {
    const b = new BillingEngine(rateCard, () => T);
    b.meter("t1", "agents");
    expect(b.meteredQuantity("t1", "agents")).toBe(1);
  });
});

describe("invoicing", () => {
  it("produces priced line items for metered usage", () => {
    const b = new BillingEngine(rateCard, () => T);
    b.meter("t1", "agents", 2);
    b.meter("t1", "eval_runs", 10);
    const inv = b.invoice("t1");
    const agents = inv.lineItems.find((li) => li.resource === "agents")!;
    expect(agents.quantity).toBe(2);
    expect(agents.amount).toBe(200);
    const evals = inv.lineItems.find((li) => li.resource === "eval_runs")!;
    expect(evals.amount).toBe(50);
  });

  it("omits resources with zero usage", () => {
    const b = new BillingEngine(rateCard, () => T);
    b.meter("t1", "agents", 1);
    const inv = b.invoice("t1");
    expect(inv.lineItems.some((li) => li.resource === "deployments")).toBe(false);
  });

  it("includes a platform fee when configured", () => {
    const b = new BillingEngine(rateCard, () => T);
    b.meter("t1", "agents", 1);
    const inv = b.invoice("t1");
    const fee = inv.lineItems.find((li) => li.resource === "platform_fee")!;
    expect(fee.amount).toBe(10000);
  });

  it("omits the platform fee when not configured", () => {
    const b = new BillingEngine({ currency: "USD", unitPrices: { agents: 100 } }, () => T);
    b.meter("t1", "agents", 1);
    expect(b.invoice("t1").lineItems.some((li) => li.resource === "platform_fee")).toBe(false);
  });

  it("computes subtotal and total", () => {
    const b = new BillingEngine(rateCard, () => T);
    b.meter("t1", "agents", 1); // 100
    b.meter("t1", "api_calls", 1000); // 1000
    const inv = b.invoice("t1");
    // 100 + 1000 + 10000 platform fee
    expect(inv.subtotal).toBe(11100);
    expect(inv.total).toBe(11100);
  });

  it("orders line items deterministically", () => {
    const b = new BillingEngine(rateCard, () => T);
    b.meter("t1", "deployments", 1);
    b.meter("t1", "agents", 1);
    const resources = b.invoice("t1").lineItems.filter((li) => li.resource !== "platform_fee").map((li) => li.resource);
    expect(resources).toEqual([...resources].sort());
  });

  it("produces an empty invoice (fee only) for no usage", () => {
    const b = new BillingEngine(rateCard, () => T);
    const inv = b.invoice("t1");
    expect(inv.lineItems).toHaveLength(1); // platform fee only
    expect(inv.total).toBe(10000);
  });

  it("isolates usage by billing period", () => {
    let t = Date.parse("2026-06-08T00:00:00.000Z");
    const b = new BillingEngine(rateCard, () => t);
    b.meter("t1", "agents", 5);
    expect(b.invoice("t1").period).toBe("2026-06");
    t = Date.parse("2026-07-08T00:00:00.000Z");
    expect(b.meteredQuantity("t1", "agents")).toBe(0); // new period
    expect(b.invoice("t1").period).toBe("2026-07");
  });

  it("sets the currency from the rate card", () => {
    const b = new BillingEngine(rateCard, () => T);
    expect(b.invoice("t1").currency).toBe("USD");
  });

  it("uses the default clock when none injected", () => {
    const b = new BillingEngine(rateCard);
    b.meter("t1", "agents", 1);
    expect(b.meteredQuantity("t1", "agents")).toBe(1);
  });
});

describe("formatAmount", () => {
  it("formats minor units as currency", () => {
    expect(BillingEngine.formatAmount(11100, "USD")).toBe("111.00 USD");
  });
});
