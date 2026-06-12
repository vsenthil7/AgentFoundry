// S39 — Scheduled billing close.
// Bridges the billing engine (S34), invoice store (S37), and scheduler (S26):
// a job that, at period close, generates each tenant's invoice and persists it
// (idempotently). Returns a summary detail string for the scheduler's run log.

import type { BillingEngine } from "./billing.js";
import type { InvoiceStore } from "./invoice_store.js";
import type { JobDefinition } from "./scheduler.js";

export interface BillingCloseDeps {
  billing: BillingEngine;
  store: InvoiceStore;
  // Tenants to bill at close. A real system enumerates active tenants.
  tenants: () => string[];
}

export interface BillingCloseResult {
  invoiced: number;
  skipped: number;
  totalBilled: number;
}

// Run a billing close once: invoice every tenant, upserting into the store so a
// re-run within the same period is idempotent.
export function runBillingClose(deps: BillingCloseDeps): BillingCloseResult {
  let invoiced = 0;
  let skipped = 0;
  let totalBilled = 0;
  for (const tenantId of [...deps.tenants()].sort()) {
    const invoice = deps.billing.invoice(tenantId);
    // Skip empty invoices (no line items at all).
    if (invoice.lineItems.length === 0) {
      skipped++;
      continue;
    }
    deps.store.upsert(invoice);
    invoiced++;
    totalBilled += invoice.total;
  }
  return { invoiced, skipped, totalBilled };
}

// Build a scheduler JobDefinition that runs the billing close on an interval.
export function billingCloseJob(
  id: string,
  intervalMs: number,
  deps: BillingCloseDeps,
): JobDefinition {
  return {
    id,
    intervalMs,
    task: () => {
      const result = runBillingClose(deps);
      return `billed ${result.invoiced} tenant(s), skipped ${result.skipped}, total ${result.totalBilled}`;
    },
  };
}
