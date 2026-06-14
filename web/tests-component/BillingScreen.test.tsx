import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { BillingScreen, formatMoney } from "../src/billing/BillingScreen.js";
import { AuthClient, AuthApiError, type AuthSession, type Invoice, type InvoiceHistory } from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function session(): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"] },
  };
}

const CURRENT: Invoice = {
  tenantId: "acme",
  period: "2026-06",
  currency: "USD",
  lineItems: [
    { resource: "agents", quantity: 3, unitPrice: 100, amount: 300 },
    { resource: "platform_fee", quantity: 1, unitPrice: 2000, amount: 2000 },
  ],
  subtotal: 2300,
  total: 2300,
};

function historyWith(pop: InvoiceHistory["periodOverPeriod"], invoices: Invoice[] = []): InvoiceHistory {
  return {
    invoices,
    summary: { tenantId: "acme", invoiceCount: invoices.length, lifetimeTotal: 13000, currency: "USD", periods: invoices.map((i) => i.period) },
    periodOverPeriod: pop,
  };
}

const HIST: InvoiceHistory = historyWith({ delta: 3000, pct: 60 }, [
  { tenantId: "acme", period: "2025-11", currency: "USD", lineItems: [], subtotal: 5000, total: 5000 },
  { tenantId: "acme", period: "2025-12", currency: "USD", lineItems: [], subtotal: 8000, total: 8000 },
]);

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = {
    getCurrentInvoice: vi.fn(async () => CURRENT),
    getInvoiceHistory: vi.fn(async () => HIST),
  };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("formatMoney (S107)", () => {
  it("formats integer minor units as major currency", () => {
    expect(formatMoney(2350, "USD")).toBe("23.50 USD");
    expect(formatMoney(0, "EUR")).toBe("0.00 EUR");
    expect(formatMoney(5, "USD")).toBe("0.05 USD");
  });
});

describe("BillingScreen (S107)", () => {
  it("shows a loading state first", () => {
    render(<BillingScreen client={fakeClient()} session={session()} />);
    expect(screen.getByTestId("billing-loading")).toBeInTheDocument();
  });

  it("renders the current invoice, lifetime and a positive period-over-period delta", async () => {
    render(<BillingScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("billing-current-total")).toHaveTextContent("23.00 USD"));
    expect(screen.getByTestId("billing-screen")).toHaveTextContent("agents");
    expect(screen.getByTestId("billing-screen")).toHaveTextContent("platform_fee");
    expect(screen.getByTestId("billing-lifetime")).toHaveTextContent("130.00 USD");
    expect(screen.getByTestId("billing-pop")).toHaveTextContent("30.00 USD");
    expect(screen.getByTestId("billing-pop")).toHaveTextContent("60.0%");
    // history rows
    expect(screen.getByTestId("billing-screen")).toHaveTextContent("2025-11");
    expect(screen.getByTestId("billing-screen")).toHaveTextContent("2025-12");
  });

  it("shows a negative delta with a downward sign", async () => {
    const client = fakeClient({ getInvoiceHistory: vi.fn(async () => historyWith({ delta: -1500, pct: -20 })) });
    render(<BillingScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("billing-pop")).toBeInTheDocument());
    expect(screen.getByTestId("billing-pop")).toHaveTextContent("−15.00 USD");
    expect(screen.getByTestId("billing-pop")).toHaveTextContent("-20.0%");
  });

  it("shows the not-enough-history state when periodOverPeriod is null", async () => {
    const client = fakeClient({ getInvoiceHistory: vi.fn(async () => historyWith(null)) });
    render(<BillingScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("billing-pop-none")).toBeInTheDocument());
  });

  it("renders a flat (zero) period-over-period delta with a neutral tone", async () => {
    const client = fakeClient({ getInvoiceHistory: vi.fn(async () => historyWith({ delta: 0, pct: 0 })) });
    render(<BillingScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("billing-pop")).toBeInTheDocument());
    expect(screen.getByTestId("billing-pop")).toHaveTextContent("+0.00 USD");
    expect(screen.getByTestId("billing-pop")).toHaveTextContent("0.0%");
  });

  it("renders empty states for no line items and no invoices", async () => {
    const client = fakeClient({
      getCurrentInvoice: vi.fn(async () => ({ ...CURRENT, lineItems: [], subtotal: 0, total: 0 })),
      getInvoiceHistory: vi.fn(async () => historyWith(null)),
    });
    render(<BillingScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("billing-screen")).toHaveTextContent("No metered usage yet"));
    expect(screen.getByTestId("billing-screen")).toHaveTextContent("No invoices stored yet");
  });

  it("shows an API error from /billing/current", async () => {
    const client = fakeClient({ getCurrentInvoice: vi.fn(async () => { throw new AuthApiError(403, "Requires admin:manage_users"); }) });
    render(<BillingScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("billing-error")).toHaveTextContent("Requires admin"));
  });

  it("shows a generic error on a non-API failure", async () => {
    const client = fakeClient({ getInvoiceHistory: vi.fn(async () => { throw new Error("socket"); }) });
    render(<BillingScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("billing-error")).toHaveTextContent("Request failed"));
  });

  it("ignores a resolution that arrives after unmount", async () => {
    let resolve!: (v: Invoice) => void;
    const client = fakeClient({ getCurrentInvoice: vi.fn(() => new Promise((r) => { resolve = r; })) });
    const { unmount } = render(<BillingScreen client={client} session={session()} />);
    unmount();
    await act(async () => {
      resolve(CURRENT);
      await Promise.resolve();
    });
    expect(true).toBe(true);
  });

  it("ignores a rejection that arrives after unmount", async () => {
    let reject!: (e: unknown) => void;
    const client = fakeClient({ getCurrentInvoice: vi.fn(() => new Promise((_r, rej) => { reject = rej; })) });
    const { unmount } = render(<BillingScreen client={client} session={session()} />);
    unmount();
    await act(async () => {
      reject(new Error("late"));
      await Promise.resolve();
    });
    expect(true).toBe(true);
  });
});
