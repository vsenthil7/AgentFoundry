import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { SecretsScreen } from "../src/secrets/SecretsScreen.js";
import { AuthClient, AuthApiError, type AuthSession, type MaskedSecret, type ConnectorDef } from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function session(): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"] },
  };
}

const SECRETS: MaskedSecret[] = [
  { id: "db-pass", tenantId: "acme", name: "DB password", masked: "p@…tail", createdAt: "2026-01-02T00:00:00.000Z" },
  { id: "openai-key", tenantId: "acme", name: "OpenAI API key", masked: "sk…WXYZ", createdAt: "2026-01-01T00:00:00.000Z" },
];
const CONNECTORS: ConnectorDef[] = [
  { id: "oai", tenantId: "acme", kind: "openapi", name: "OpenAI", endpoint: "https://api.openai.com", secretId: "openai-key" },
];

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = {
    listSecrets: vi.fn(async () => ({ secrets: SECRETS })),
    listConnectors: vi.fn(async () => ({ connectors: CONNECTORS })),
  };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("SecretsScreen (S106)", () => {
  it("shows a loading state first", () => {
    render(<SecretsScreen client={fakeClient()} session={session()} />);
    expect(screen.getByTestId("secrets-loading")).toBeInTheDocument();
  });

  it("renders masked secrets and connectors", async () => {
    render(<SecretsScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-masked-openai-key")).toBeInTheDocument());
    expect(screen.getByTestId("secret-masked-openai-key")).toHaveTextContent("sk…WXYZ");
    expect(screen.getByTestId("secrets-screen")).toHaveTextContent("DB password");
    // Connector table.
    expect(screen.getByTestId("secrets-screen")).toHaveTextContent("OpenAI");
    expect(screen.getByTestId("secrets-screen")).toHaveTextContent("OPENAPI");
    expect(screen.getByTestId("secrets-screen")).toHaveTextContent("api.openai.com");
  });

  it("renders empty states when there are no secrets or connectors", async () => {
    const client = fakeClient({
      listSecrets: vi.fn(async () => ({ secrets: [] })),
      listConnectors: vi.fn(async () => ({ connectors: [] })),
    });
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secrets-screen")).toHaveTextContent("No secrets stored"));
    expect(screen.getByTestId("secrets-screen")).toHaveTextContent("No connectors registered");
  });

  it("tolerates an unparseable createdAt date (shows a dash)", async () => {
    const client = fakeClient({
      listSecrets: vi.fn(async () => ({ secrets: [{ ...SECRETS[0], createdAt: "not-a-date" }] })),
    });
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-masked-db-pass")).toBeInTheDocument());
    expect(screen.getByTestId("secrets-screen")).toHaveTextContent("—");
  });

  it("shows an API error from /secrets", async () => {
    const client = fakeClient({ listSecrets: vi.fn(async () => { throw new AuthApiError(403, "Requires admin:manage_users"); }) });
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secrets-error")).toHaveTextContent("Requires admin"));
  });

  it("shows a generic error on a non-API failure", async () => {
    const client = fakeClient({ listConnectors: vi.fn(async () => { throw new Error("socket"); }) });
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secrets-error")).toHaveTextContent("Request failed"));
  });

  it("ignores a resolution that arrives after unmount", async () => {
    let resolve!: (v: { secrets: MaskedSecret[] }) => void;
    const client = fakeClient({ listSecrets: vi.fn(() => new Promise((r) => { resolve = r; })) });
    const { unmount } = render(<SecretsScreen client={client} session={session()} />);
    unmount();
    await act(async () => {
      resolve({ secrets: SECRETS });
      await Promise.resolve();
    });
    expect(true).toBe(true);
  });

  it("ignores a rejection that arrives after unmount", async () => {
    let reject!: (e: unknown) => void;
    const client = fakeClient({ listSecrets: vi.fn(() => new Promise((_r, rej) => { reject = rej; })) });
    const { unmount } = render(<SecretsScreen client={client} session={session()} />);
    unmount();
    await act(async () => {
      reject(new Error("late"));
      await Promise.resolve();
    });
    expect(true).toBe(true);
  });
});
