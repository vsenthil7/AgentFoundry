import { describe, it, expect } from "vitest";
import { runBillingClose, billingCloseJob } from "../src/billing_close.js";
import { BillingEngine } from "../src/billing.js";
import { InvoiceStore } from "../src/invoice_store.js";
import { Scheduler } from "../src/scheduler.js";

const T = Date.parse("2026-06-08T00:00:00.000Z");

function setup() {
  const billing = new BillingEngine(
    { currency: "USD", unitPrices: { agents: 100, eval_runs: 5 }, platformFee: 1000 },
    () => T,
  );
  const store = new InvoiceStore();
  return { billing, store };
}

describe("runBillingClose", () => {
  it("invoices each tenant with usage and persists it", () => {
    const { billing, store } = setup();
    billing.meter("t1", "agents", 2);
    billing.meter("t2", "eval_runs", 10);
    const result = runBillingClose({ billing, store, tenants: () => ["t1", "t2"] });
    expect(result.invoiced).toBe(2);
    expect(store.get("t1", "2026-06")).not.toBeNull();
    expect(store.get("t2", "2026-06")).not.toBeNull();
  });

  it("includes the platform fee in the billed total", () => {
    const { billing, store } = setup();
    billing.meter("t1", "agents", 1); // 100 + 1000 fee
    const result = runBillingClose({ billing, store, tenants: () => ["t1"] });
    expect(result.totalBilled).toBe(1100);
  });

  it("is idempotent within a period (upsert, no duplicate error)", () => {
    const { billing, store } = setup();
    billing.meter("t1", "agents", 1);
    runBillingClose({ billing, store, tenants: () => ["t1"] });
    expect(() => runBillingClose({ billing, store, tenants: () => ["t1"] })).not.toThrow();
    expect(store.history("t1")).toHaveLength(1);
  });

  it("skips tenants with empty invoices", () => {
    const { billing, store } = setup();
    // No usage, but platform fee makes it non-empty — use a fee-less engine.
    const feeless = new BillingEngine({ currency: "USD", unitPrices: { agents: 100 } }, () => T);
    const result = runBillingClose({ billing: feeless, store, tenants: () => ["t1"] });
    expect(result.skipped).toBe(1);
    expect(result.invoiced).toBe(0);
  });

  it("processes tenants in deterministic order", () => {
    const { billing, store } = setup();
    billing.meter("b", "agents", 1);
    billing.meter("a", "agents", 1);
    const result = runBillingClose({ billing, store, tenants: () => ["b", "a"] });
    expect(result.invoiced).toBe(2);
  });
});

describe("billingCloseJob", () => {
  it("builds a scheduler job that runs the close", async () => {
    const { billing, store } = setup();
    billing.meter("t1", "agents", 3);
    const job = billingCloseJob("billing-close", 1000, { billing, store, tenants: () => ["t1"] });
    let t = 0;
    const scheduler = new Scheduler(() => t);
    scheduler.schedule(job);
    t = 1000;
    const runs = await scheduler.tick();
    expect(runs[0].status).toBe("succeeded");
    expect(runs[0].detail).toContain("billed 1 tenant");
    expect(store.get("t1", "2026-06")).not.toBeNull();
  });
});
