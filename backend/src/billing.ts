// S34 — Billing & usage metering.
// Turns metered usage (from quotas/observability) into priced, invoiceable line
// items per tenant per billing period. Deterministic; integrates with the
// QuotaManager's resource model. Pricing is a per-resource rate card.

import type { QuotaResource } from "./ratelimit.js";

export interface RateCard {
  // Price per unit, in the smallest currency unit (e.g. cents), per resource.
  unitPrices: Partial<Record<QuotaResource, number>>;
  currency: string;
  // Optional flat platform fee per period (cents).
  platformFee?: number;
}

export interface UsageRecord {
  tenantId: string;
  resource: QuotaResource;
  quantity: number;
}

export interface LineItem {
  resource: QuotaResource | "platform_fee";
  quantity: number;
  unitPrice: number;
  amount: number; // quantity * unitPrice
}

export interface Invoice {
  readonly tenantId: string;
  readonly period: string;
  readonly currency: string;
  readonly lineItems: readonly LineItem[];
  readonly subtotal: number;
  readonly total: number;
}

export class BillingEngine {
  private readonly rateCard: RateCard;
  // tenantId -> period -> resource -> quantity
  private readonly usage = new Map<string, Map<QuotaResource, number>>();
  private readonly now: () => number;

  constructor(rateCard: RateCard, now: () => number = () => Date.now()) {
    this.rateCard = rateCard;
    this.now = now;
  }

  private period(): string {
    const d = new Date(this.now());
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  private key(tenantId: string): string {
    return `${tenantId}:${this.period()}`;
  }

  // Meter usage (called whenever a billable action occurs).
  meter(tenantId: string, resource: QuotaResource, quantity = 1): void {
    if (quantity < 0) throw new Error("Metered quantity cannot be negative.");
    const k = this.key(tenantId);
    let m = this.usage.get(k);
    if (!m) {
      m = new Map();
      this.usage.set(k, m);
    }
    m.set(resource, (m.get(resource) ?? 0) + quantity);
  }

  meteredQuantity(tenantId: string, resource: QuotaResource): number {
    return this.usage.get(this.key(tenantId))?.get(resource) ?? 0;
  }

  // Generate an invoice for the current billing period.
  invoice(tenantId: string): Invoice {
    const period = this.period();
    const usageMap = this.usage.get(this.key(tenantId)) ?? new Map<QuotaResource, number>();

    const lineItems: LineItem[] = [];
    // Deterministic order over priced resources.
    const resources = Object.keys(this.rateCard.unitPrices).sort() as QuotaResource[];
    for (const resource of resources) {
      const unitPrice = this.rateCard.unitPrices[resource]!;
      const quantity = usageMap.get(resource) ?? 0;
      if (quantity > 0) {
        lineItems.push({ resource, quantity, unitPrice, amount: quantity * unitPrice });
      }
    }

    if (this.rateCard.platformFee && this.rateCard.platformFee > 0) {
      lineItems.push({
        resource: "platform_fee",
        quantity: 1,
        unitPrice: this.rateCard.platformFee,
        amount: this.rateCard.platformFee,
      });
    }

    const subtotal = lineItems.reduce((s, li) => s + li.amount, 0);
    return {
      tenantId,
      period,
      currency: this.rateCard.currency,
      lineItems,
      subtotal,
      total: subtotal,
    };
  }

  // Format an invoice total as a human-readable currency string.
  static formatAmount(amountMinor: number, currency: string): string {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}
