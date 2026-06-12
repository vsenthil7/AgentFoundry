import { describe, it, expect, beforeEach } from "vitest";
import { InvoiceStore, DuplicateInvoiceError } from "../src/invoice_store.js";
import type { Invoice } from "../src/billing.js";

function inv(period: string, total: number, tenantId = "t1"): Invoice {
  return {
    tenantId,
    period,
    currency: "USD",
    lineItems: [{ resource: "agents", quantity: 1, unitPrice: total, amount: total }],
    subtotal: total,
    total,
  };
}

let store: InvoiceStore;
beforeEach(() => (store = new InvoiceStore()));

describe("save", () => {
  it("persists an invoice", () => {
    store.save(inv("2026-06", 100));
    expect(store.get("t1", "2026-06")?.total).toBe(100);
  });
  it("rejects a duplicate period", () => {
    store.save(inv("2026-06", 100));
    expect(() => store.save(inv("2026-06", 200))).toThrow(DuplicateInvoiceError);
  });
  it("freezes the stored invoice", () => {
    expect(Object.isFrozen(store.save(inv("2026-06", 100)))).toBe(true);
  });
  it("returns null for an unknown period", () => {
    expect(store.get("t1", "2099-01")).toBeNull();
  });
});

describe("upsert", () => {
  it("overwrites an existing period", () => {
    store.save(inv("2026-06", 100));
    store.upsert(inv("2026-06", 250));
    expect(store.get("t1", "2026-06")?.total).toBe(250);
  });
  it("creates when absent", () => {
    store.upsert(inv("2026-07", 50));
    expect(store.get("t1", "2026-07")?.total).toBe(50);
  });
});

describe("history", () => {
  it("returns invoices sorted by period", () => {
    store.save(inv("2026-07", 200));
    store.save(inv("2026-05", 100));
    store.save(inv("2026-06", 150));
    expect(store.history("t1").map((i) => i.period)).toEqual(["2026-05", "2026-06", "2026-07"]);
  });
  it("returns empty for an unknown tenant", () => {
    expect(store.history("ghost")).toEqual([]);
  });
});

describe("summary", () => {
  it("computes lifetime total and periods", () => {
    store.save(inv("2026-05", 100));
    store.save(inv("2026-06", 150));
    const s = store.summary("t1");
    expect(s.invoiceCount).toBe(2);
    expect(s.lifetimeTotal).toBe(250);
    expect(s.periods).toEqual(["2026-05", "2026-06"]);
    expect(s.currency).toBe("USD");
  });
  it("defaults currency when no invoices", () => {
    const s = store.summary("ghost");
    expect(s.invoiceCount).toBe(0);
    expect(s.currency).toBe("USD");
  });
});

describe("periodOverPeriod", () => {
  it("returns null with fewer than two periods", () => {
    store.save(inv("2026-06", 100));
    expect(store.periodOverPeriod("t1")).toBeNull();
  });
  it("computes delta and percentage", () => {
    store.save(inv("2026-05", 100));
    store.save(inv("2026-06", 150));
    const pop = store.periodOverPeriod("t1")!;
    expect(pop.delta).toBe(50);
    expect(pop.pct).toBe(50);
  });
  it("handles a zero previous total", () => {
    store.save(inv("2026-05", 0));
    store.save(inv("2026-06", 100));
    expect(store.periodOverPeriod("t1")!.pct).toBe(0);
  });
});
