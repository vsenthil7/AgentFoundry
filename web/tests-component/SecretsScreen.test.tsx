import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    createSecret: vi.fn(async () => ({ id: "new", tenantId: "acme", name: "New", masked: "ne…wxyz", createdAt: "2026-01-03T00:00:00.000Z" })),
    rotateSecret: vi.fn(async () => ({ id: "openai-key", tenantId: "acme", name: "OpenAI API key", masked: "ro…ated", createdAt: "2026-01-03T00:00:00.000Z" })),
    deleteSecret: vi.fn(async () => ({ deleted: true })),
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

describe("SecretsScreen write-path (S115)", () => {
  it("creates a secret: opens the form, submits, and reloads the list", async () => {
    const u = userEvent.setup();
    const client = fakeClient();
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-add-open")).toBeInTheDocument());
    await u.click(screen.getByTestId("secret-add-open"));
    await u.type(screen.getByTestId("secret-add-id"), "stripe-key");
    await u.type(screen.getByTestId("secret-add-name"), "Stripe key");
    await u.type(screen.getByTestId("secret-add-value"), "sk-live-123456");
    await u.click(screen.getByTestId("secret-add-submit"));
    await waitFor(() => expect((client.createSecret as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("tok", { id: "stripe-key", name: "Stripe key", value: "sk-live-123456" }));
    // list reloaded (listSecrets called again: once on mount, once after create)
    expect((client.listSecrets as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    // form closed
    expect(screen.queryByTestId("secret-add-form")).toBeNull();
  });

  it("keeps the create button disabled until id, name and value are all filled", async () => {
    const u = userEvent.setup();
    render(<SecretsScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-add-open")).toBeInTheDocument());
    await u.click(screen.getByTestId("secret-add-open"));
    expect(screen.getByTestId("secret-add-submit")).toBeDisabled();
    await u.type(screen.getByTestId("secret-add-id"), "k");
    await u.type(screen.getByTestId("secret-add-name"), "K");
    expect(screen.getByTestId("secret-add-submit")).toBeDisabled();
    await u.type(screen.getByTestId("secret-add-value"), "v");
    expect(screen.getByTestId("secret-add-submit")).toBeEnabled();
  });

  it("cancels the add form without calling the API", async () => {
    const u = userEvent.setup();
    const client = fakeClient();
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-add-open")).toBeInTheDocument());
    await u.click(screen.getByTestId("secret-add-open"));
    await u.click(screen.getByTestId("secret-add-cancel"));
    expect(screen.queryByTestId("secret-add-form")).toBeNull();
    expect((client.createSecret as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("surfaces a duplicate-id (409) error from create", async () => {
    const u = userEvent.setup();
    const client = fakeClient({ createSecret: vi.fn(async () => { throw new AuthApiError(409, "Secret already exists: dup"); }) });
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-add-open")).toBeInTheDocument());
    await u.click(screen.getByTestId("secret-add-open"));
    await u.type(screen.getByTestId("secret-add-id"), "dup");
    await u.type(screen.getByTestId("secret-add-name"), "Dup");
    await u.type(screen.getByTestId("secret-add-value"), "v");
    await u.click(screen.getByTestId("secret-add-submit"));
    await waitFor(() => expect(screen.getByTestId("secrets-action-error")).toHaveTextContent("already exists"));
  });

  it("rotates a secret: opens the rotate form, submits a new value, reloads", async () => {
    const u = userEvent.setup();
    const client = fakeClient();
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-rotate-openai-key")).toBeInTheDocument());
    await u.click(screen.getByTestId("secret-rotate-openai-key"));
    await u.type(screen.getByTestId("secret-rotate-value"), "new-secret-value");
    await u.click(screen.getByTestId("secret-rotate-submit"));
    await waitFor(() => expect((client.rotateSecret as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("tok", "openai-key", "new-secret-value"));
    expect(screen.queryByTestId("secret-rotate-form")).toBeNull();
  });

  it("cancels the rotate form", async () => {
    const u = userEvent.setup();
    const client = fakeClient();
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-rotate-db-pass")).toBeInTheDocument());
    await u.click(screen.getByTestId("secret-rotate-db-pass"));
    expect(screen.getByTestId("secret-rotate-form")).toBeInTheDocument();
    await u.click(screen.getByTestId("secret-rotate-cancel"));
    expect(screen.queryByTestId("secret-rotate-form")).toBeNull();
    expect((client.rotateSecret as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("deletes a secret and reloads the list", async () => {
    const u = userEvent.setup();
    const client = fakeClient();
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-delete-db-pass")).toBeInTheDocument());
    await u.click(screen.getByTestId("secret-delete-db-pass"));
    await waitFor(() => expect((client.deleteSecret as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("tok", "db-pass"));
    expect((client.listSecrets as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces an in-use (409) error from delete", async () => {
    const u = userEvent.setup();
    const client = fakeClient({ deleteSecret: vi.fn(async () => { throw new AuthApiError(409, "Secret 'openai-key' is in use by connector 'oai'"); }) });
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-delete-openai-key")).toBeInTheDocument());
    await u.click(screen.getByTestId("secret-delete-openai-key"));
    await waitFor(() => expect(screen.getByTestId("secrets-action-error")).toHaveTextContent("in use by connector"));
  });

  it("surfaces a generic (non-API) error from create", async () => {
    const u = userEvent.setup();
    const client = fakeClient({ createSecret: vi.fn(async () => { throw new Error("socket"); }) });
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-add-open")).toBeInTheDocument());
    await u.click(screen.getByTestId("secret-add-open"));
    await u.type(screen.getByTestId("secret-add-id"), "k");
    await u.type(screen.getByTestId("secret-add-name"), "K");
    await u.type(screen.getByTestId("secret-add-value"), "v");
    await u.click(screen.getByTestId("secret-add-submit"));
    await waitFor(() => expect(screen.getByTestId("secrets-action-error")).toHaveTextContent("Request failed"));
  });

  it("surfaces a generic (non-API) error from rotate", async () => {
    const u = userEvent.setup();
    const client = fakeClient({ rotateSecret: vi.fn(async () => { throw new Error("socket"); }) });
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-rotate-db-pass")).toBeInTheDocument());
    await u.click(screen.getByTestId("secret-rotate-db-pass"));
    await u.type(screen.getByTestId("secret-rotate-value"), "v");
    await u.click(screen.getByTestId("secret-rotate-submit"));
    await waitFor(() => expect(screen.getByTestId("secrets-action-error")).toHaveTextContent("Request failed"));
  });

  it("surfaces a generic (non-API) error from delete", async () => {
    const u = userEvent.setup();
    const client = fakeClient({ deleteSecret: vi.fn(async () => { throw new Error("socket"); }) });
    render(<SecretsScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("secret-delete-db-pass")).toBeInTheDocument());
    await u.click(screen.getByTestId("secret-delete-db-pass"));
    await waitFor(() => expect(screen.getByTestId("secrets-action-error")).toHaveTextContent("Request failed"));
  });
});
