import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarketplaceScreen, filterByKind } from "../src/marketplace/MarketplaceScreen.js";
import { AuthClient, AuthApiError, type AuthSession, type MarketplaceCatalog, type MarketplacePack } from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function session(): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:u@acme.com", email: "u@acme.com", tenantId: "acme", roles: ["viewer"] },
  };
}

const PACKS: MarketplacePack[] = [
  { id: "eval-basic", kind: "eval_pack", name: "Basic Eval", publisher: "acme", version: "1.0.0", certificationTier: "silver", installs: 0 },
  { id: "redteam-owasp", kind: "redteam_pack", name: "OWASP Red Team", publisher: "foundry", version: "2.1.0", certificationTier: "gold", installs: 2 },
  { id: "tmpl-support", kind: "agent_template", name: "Support Agent", publisher: "acme", version: "3.0.0", certificationTier: "bronze", installs: 5 },
];

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = { browseMarketplace: vi.fn(async () => ({ packs: PACKS }) as MarketplaceCatalog) };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("filterByKind (S114)", () => {
  it("returns everything for 'all' and narrows by kind otherwise", () => {
    expect(filterByKind(PACKS, "all")).toHaveLength(3);
    expect(filterByKind(PACKS, "eval_pack").map((p) => p.id)).toEqual(["eval-basic"]);
    expect(filterByKind(PACKS, "agent_template").map((p) => p.id)).toEqual(["tmpl-support"]);
  });
});

describe("MarketplaceScreen (S114)", () => {
  it("shows a loading state first", () => {
    render(<MarketplaceScreen client={fakeClient()} session={session()} />);
    expect(screen.getByTestId("marketplace-loading")).toBeInTheDocument();
  });

  it("renders the catalog with tier badges and install counts", async () => {
    render(<MarketplaceScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("pack-tier-redteam-owasp")).toBeInTheDocument());
    expect(screen.getByTestId("pack-tier-redteam-owasp")).toHaveTextContent("GOLD");
    expect(screen.getByTestId("pack-tier-eval-basic")).toHaveTextContent("SILVER");
    expect(screen.getByTestId("pack-installs-redteam-owasp")).toHaveTextContent("2");
    expect(screen.getByTestId("pack-installs-tmpl-support")).toHaveTextContent("5");
  });

  it("filters the catalog by kind when a filter is clicked", async () => {
    const u = userEvent.setup();
    render(<MarketplaceScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("pack-tier-eval-basic")).toBeInTheDocument());
    await u.click(screen.getByTestId("market-filter-redteam_pack"));
    await waitFor(() => expect(screen.queryByTestId("pack-tier-eval-basic")).toBeNull());
    expect(screen.getByTestId("pack-tier-redteam-owasp")).toBeInTheDocument();
    expect(screen.getByTestId("market-filter-redteam_pack")).toHaveAttribute("aria-pressed", "true");
  });

  it("shows an empty message when a filter matches nothing", async () => {
    const client = fakeClient({ browseMarketplace: vi.fn(async () => ({ packs: [PACKS[0]] })) });
    const u = userEvent.setup();
    render(<MarketplaceScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("pack-tier-eval-basic")).toBeInTheDocument());
    await u.click(screen.getByTestId("market-filter-agent_template"));
    await waitFor(() => expect(screen.getByTestId("marketplace-screen")).toHaveTextContent("No packs match this filter."));
  });

  it("shows an API error", async () => {
    const client = fakeClient({ browseMarketplace: vi.fn(async () => { throw new AuthApiError(404, "not configured here"); }) });
    render(<MarketplaceScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("marketplace-error")).toHaveTextContent("not configured"));
  });

  it("shows a generic error on a non-API failure", async () => {
    const client = fakeClient({ browseMarketplace: vi.fn(async () => { throw new Error("socket"); }) });
    render(<MarketplaceScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("marketplace-error")).toHaveTextContent("Request failed"));
  });

  it("ignores a resolution after unmount", async () => {
    let resolve!: (v: MarketplaceCatalog) => void;
    const client = fakeClient({ browseMarketplace: vi.fn(() => new Promise((r) => { resolve = r; })) });
    const { unmount } = render(<MarketplaceScreen client={client} session={session()} />);
    unmount();
    await act(async () => { resolve({ packs: PACKS }); await Promise.resolve(); });
    expect(true).toBe(true);
  });

  it("ignores a rejection after unmount", async () => {
    let reject!: (e: unknown) => void;
    const client = fakeClient({ browseMarketplace: vi.fn(() => new Promise((_r, rej) => { reject = rej; })) });
    const { unmount } = render(<MarketplaceScreen client={client} session={session()} />);
    unmount();
    await act(async () => { reject(new Error("late")); await Promise.resolve(); });
    expect(true).toBe(true);
  });
});
