// S37 — Invoice persistence & history.
// Stores generated invoices (S34) per tenant, supports retrieval by period,
// history listing, and period-over-period summaries. Backed by the same
// Repository/KeyValueStore seam used elsewhere so it swaps to a real DB cleanly.

import type { Invoice } from "./billing.js";

export interface InvoiceSummary {
  tenantId: string;
  invoiceCount: number;
  lifetimeTotal: number;
  currency: string;
  periods: string[];
}

export class DuplicateInvoiceError extends Error {
  constructor(tenantId: string, period: string) {
    super(`Invoice already stored for ${tenantId} period ${period}.`);
    this.name = "DuplicateInvoiceError";
  }
}

export class InvoiceStore {
  // tenantId -> period -> invoice
  private readonly byTenant = new Map<string, Map<string, Invoice>>();

  private tenantMap(tenantId: string): Map<string, Invoice> {
    let m = this.byTenant.get(tenantId);
    if (!m) {
      m = new Map();
      this.byTenant.set(tenantId, m);
    }
    return m;
  }

  // Persist an invoice. Rejects a duplicate for the same tenant+period.
  save(invoice: Invoice): Invoice {
    const m = this.tenantMap(invoice.tenantId);
    if (m.has(invoice.period)) {
      throw new DuplicateInvoiceError(invoice.tenantId, invoice.period);
    }
    const frozen = Object.freeze({
      ...invoice,
      lineItems: Object.freeze([...invoice.lineItems]),
    });
    m.set(invoice.period, frozen);
    return frozen;
  }

  // Upsert: overwrite an existing period's invoice (e.g. recomputed mid-period).
  upsert(invoice: Invoice): Invoice {
    const frozen = Object.freeze({
      ...invoice,
      lineItems: Object.freeze([...invoice.lineItems]),
    });
    this.tenantMap(invoice.tenantId).set(invoice.period, frozen);
    return frozen;
  }

  get(tenantId: string, period: string): Invoice | null {
    return this.byTenant.get(tenantId)?.get(period) ?? null;
  }

  // History for a tenant, sorted by period ascending (deterministic).
  history(tenantId: string): Invoice[] {
    const m = this.byTenant.get(tenantId);
    if (!m) return [];
    return [...m.values()].sort((a, b) => a.period.localeCompare(b.period));
  }

  // Lifetime summary across all stored periods.
  summary(tenantId: string): InvoiceSummary {
    const invoices = this.history(tenantId);
    const lifetimeTotal = invoices.reduce((s, inv) => s + inv.total, 0);
    return {
      tenantId,
      invoiceCount: invoices.length,
      lifetimeTotal,
      currency: invoices[0]?.currency ?? "USD",
      periods: invoices.map((i) => i.period),
    };
  }

  // Period-over-period delta (current vs previous stored period).
  periodOverPeriod(tenantId: string): { delta: number; pct: number } | null {
    const invoices = this.history(tenantId);
    if (invoices.length < 2) return null;
    const prev = invoices[invoices.length - 2].total;
    const cur = invoices[invoices.length - 1].total;
    const delta = cur - prev;
    const pct = prev === 0 ? 0 : (delta / prev) * 100;
    return { delta, pct };
  }
}
