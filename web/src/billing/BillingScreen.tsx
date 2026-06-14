// S107 — Billing & invoices read screen (admin).
// Surfaces the S34 billing engine + S37 invoice store over HTTP: the live
// current-period invoice (priced line items), the stored invoice history, a
// lifetime summary, and the period-over-period delta. Money is held in integer
// minor units end-to-end and only formatted for display at the edge. Read-only.

import { useEffect, useState } from "react";
import {
  AuthClient,
  AuthApiError,
  type AuthSession,
  type Invoice,
  type InvoiceHistory,
  type LineItem,
} from "../auth/authClient.js";
import { Card, Table, Badge, Banner, type Column, type BadgeTone } from "../ui/components.js";

export interface BillingScreenProps {
  client: AuthClient;
  session: AuthSession;
}

// Format integer minor units (e.g. cents) as a currency string.
export function formatMoney(minor: number, currency: string): string {
  const major = (minor / 100).toFixed(2);
  return `${major} ${currency}`;
}

function deltaTone(delta: number): BadgeTone {
  if (delta > 0) return "warn"; // spend went up
  if (delta < 0) return "success"; // spend went down
  return "neutral";
}

export function BillingScreen({ client, session }: BillingScreenProps) {
  const [current, setCurrent] = useState<Invoice | null>(null);
  const [history, setHistory] = useState<InvoiceHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([client.getCurrentInvoice(session.token), client.getInvoiceHistory(session.token)])
      .then(([c, h]) => {
        if (!live) return;
        setCurrent(c);
        setHistory(h);
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof AuthApiError ? err.message : "Request failed — try again.");
      });
    return () => {
      live = false;
    };
  }, [client, session.token]);

  if (error) {
    return (
      <div className="af-billing" data-testid="billing-screen">
        <Banner tone="danger" data-testid="billing-error">{error}</Banner>
      </div>
    );
  }
  if (current === null || history === null) {
    return (
      <div className="af-billing" data-testid="billing-screen">
        <p data-testid="billing-loading" className="af-billing__loading">Loading billing…</p>
      </div>
    );
  }

  const lineColumns: ReadonlyArray<Column<LineItem>> = [
    { key: "resource", header: "Resource", render: (l) => l.resource },
    { key: "qty", header: "Qty", align: "right", render: (l) => String(l.quantity) },
    { key: "unit", header: "Unit", align: "right", render: (l) => formatMoney(l.unitPrice, current.currency) },
    { key: "amount", header: "Amount", align: "right", render: (l) => formatMoney(l.amount, current.currency) },
  ];

  const historyColumns: ReadonlyArray<Column<Invoice>> = [
    { key: "period", header: "Period", render: (i) => i.period },
    { key: "subtotal", header: "Subtotal", align: "right", render: (i) => formatMoney(i.subtotal, i.currency) },
    { key: "total", header: "Total", align: "right", render: (i) => formatMoney(i.total, i.currency) },
  ];

  const pop = history.periodOverPeriod;

  return (
    <div className="af-billing" data-testid="billing-screen">
      <Card
        title={`Current period · ${current.period}`}
        actions={<Badge tone="brand" data-testid="billing-current-total">{formatMoney(current.total, current.currency)}</Badge>}
      >
        <Table<LineItem>
          columns={lineColumns}
          rows={current.lineItems}
          rowKey={(l) => l.resource}
          empty="No metered usage yet this period."
        />
      </Card>

      <div className="af-billing__cards">
        <Card title="Lifetime">
          <div className="af-billing__metric" data-testid="billing-lifetime">{formatMoney(history.summary.lifetimeTotal, history.summary.currency)}</div>
          <span className="af-billing__sub">{history.summary.invoiceCount} invoice(s)</span>
        </Card>
        <Card title="Period over period">
          {pop === null ? (
            <span className="af-billing__sub" data-testid="billing-pop-none">Not enough history yet.</span>
          ) : (
            <>
              <Badge tone={deltaTone(pop.delta)} data-testid="billing-pop">
                {pop.delta >= 0 ? "+" : "−"}{formatMoney(Math.abs(pop.delta), history.summary.currency)} ({pop.pct.toFixed(1)}%)
              </Badge>
              <span className="af-billing__sub">vs the previous stored period</span>
            </>
          )}
        </Card>
      </div>

      <Card title="Invoice history">
        <Table<Invoice>
          columns={historyColumns}
          rows={history.invoices}
          rowKey={(i) => i.period}
          empty="No invoices stored yet."
        />
      </Card>
    </div>
  );
}
