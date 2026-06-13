import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthGate } from "../src/auth/AuthGate.js";
import { AuthClient, AuthApiError, type AuthSession } from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function adminSession(): AuthSession {
  return {
    token: "tok-admin",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"] },
  };
}
function viewerSession(): AuthSession {
  return {
    token: "tok-viewer",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:v@acme.com", email: "v@acme.com", tenantId: "acme", roles: ["viewer"] },
  };
}

// A fake client implementing only what AuthGate calls.
function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = {
    login: vi.fn(async () => adminSession()),
    register: vi.fn(async () => adminSession()),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => adminSession().user),
    listUsers: vi.fn(async () => ({ users: [adminSession().user, viewerSession().user] })),
  };
  return { ...base, ...over } as unknown as AuthClient;
}

const child = () => <div data-testid="console">CONSOLE</div>;

describe("AuthGate (S78)", () => {
  it("shows the login screen when logged out", () => {
    render(<AuthGate client={fakeClient()}>{child}</AuthGate>);
    expect(screen.getByTestId("auth-screen")).toBeInTheDocument();
    expect(screen.getByTestId("auth-submit")).toHaveTextContent("Sign in");
    expect(screen.queryByTestId("console")).not.toBeInTheDocument();
  });

  it("toggles to the registration screen and back", async () => {
    const u = userEvent.setup();
    render(<AuthGate client={fakeClient()}>{child}</AuthGate>);
    await u.click(screen.getByTestId("auth-toggle"));
    expect(screen.getByTestId("f-tenantId")).toBeInTheDocument();
    expect(screen.getByTestId("auth-submit")).toHaveTextContent("Register");
    await u.click(screen.getByTestId("auth-toggle"));
    expect(screen.queryByTestId("f-tenantId")).not.toBeInTheDocument();
  });

  it("logs in and renders the console + session bar", async () => {
    const u = userEvent.setup();
    render(<AuthGate client={fakeClient()}>{child}</AuthGate>);
    await u.type(screen.getByTestId("f-email"), "owner@acme.com");
    await u.type(screen.getByTestId("f-password"), "supersecret");
    await u.click(screen.getByTestId("auth-submit"));
    await waitFor(() => expect(screen.getByTestId("authed-shell")).toBeInTheDocument());
    expect(screen.getByTestId("console")).toBeInTheDocument();
    expect(screen.getByTestId("session-bar")).toHaveTextContent("owner@acme.com");
  });

  it("registers via the register flow", async () => {
    const u = userEvent.setup();
    const client = fakeClient();
    render(<AuthGate client={client}>{child}</AuthGate>);
    await u.click(screen.getByTestId("auth-toggle"));
    await u.type(screen.getByTestId("f-tenantId"), "acme");
    await u.type(screen.getByTestId("f-tenantName"), "Acme");
    await u.type(screen.getByTestId("f-email"), "owner@acme.com");
    await u.type(screen.getByTestId("f-password"), "supersecret");
    await u.click(screen.getByTestId("auth-submit"));
    await waitFor(() => expect(screen.getByTestId("authed-shell")).toBeInTheDocument());
    expect((client.register as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("shows an API error message on bad credentials", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      login: vi.fn(async () => {
        throw new AuthApiError(401, "Invalid email or password.");
      }),
    });
    render(<AuthGate client={client}>{child}</AuthGate>);
    await u.type(screen.getByTestId("f-email"), "owner@acme.com");
    await u.type(screen.getByTestId("f-password"), "wrongpass");
    await u.click(screen.getByTestId("auth-submit"));
    await waitFor(() => expect(screen.getByTestId("auth-error")).toHaveTextContent("Invalid email or password."));
    expect(screen.queryByTestId("console")).not.toBeInTheDocument();
  });

  it("shows a network error message when fetch throws a non-API error", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      login: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    });
    render(<AuthGate client={client}>{child}</AuthGate>);
    await u.type(screen.getByTestId("f-email"), "owner@acme.com");
    await u.type(screen.getByTestId("f-password"), "supersecret");
    await u.click(screen.getByTestId("auth-submit"));
    await waitFor(() => expect(screen.getByTestId("auth-error")).toHaveTextContent("Network error"));
  });

  it("admin sees the user-admin panel listing tenant users with roles", async () => {
    const u = userEvent.setup();
    render(<AuthGate client={fakeClient()}>{child}</AuthGate>);
    await u.type(screen.getByTestId("f-email"), "owner@acme.com");
    await u.type(screen.getByTestId("f-password"), "supersecret");
    await u.click(screen.getByTestId("auth-submit"));
    await waitFor(() => expect(screen.getByTestId("admin-console")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId("user-row").length).toBe(2));
    expect(screen.getByTestId("users-panel")).toHaveTextContent("viewer");
  });

  it("viewer does NOT see the admin console", async () => {
    const u = userEvent.setup();
    const client = fakeClient({ login: vi.fn(async () => viewerSession()) });
    render(<AuthGate client={client}>{child}</AuthGate>);
    await u.type(screen.getByTestId("f-email"), "v@acme.com");
    await u.type(screen.getByTestId("f-password"), "supersecret");
    await u.click(screen.getByTestId("auth-submit"));
    await waitFor(() => expect(screen.getByTestId("authed-shell")).toBeInTheDocument());
    expect(screen.queryByTestId("admin-console")).not.toBeInTheDocument();
  });

  it("logout returns to the login screen and revokes server-side", async () => {
    const u = userEvent.setup();
    const client = fakeClient();
    render(<AuthGate client={client}>{child}</AuthGate>);
    await u.type(screen.getByTestId("f-email"), "owner@acme.com");
    await u.type(screen.getByTestId("f-password"), "supersecret");
    await u.click(screen.getByTestId("auth-submit"));
    await waitFor(() => expect(screen.getByTestId("authed-shell")).toBeInTheDocument());
    await u.click(screen.getByTestId("logout-btn"));
    await waitFor(() => expect(screen.getByTestId("auth-screen")).toBeInTheDocument());
    expect((client.logout as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("tok-admin");
  });

  it("admin console shows an error if listUsers fails", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      listUsers: vi.fn(async () => {
        throw new AuthApiError(500, "boom");
      }),
    });
    render(<AuthGate client={client}>{child}</AuthGate>);
    await u.type(screen.getByTestId("f-email"), "owner@acme.com");
    await u.type(screen.getByTestId("f-password"), "supersecret");
    await u.click(screen.getByTestId("auth-submit"));
    await waitFor(() => expect(screen.getByTestId("users-panel")).toHaveTextContent("boom"));
  });

  it("admin console shows 'No users yet' when the tenant list is empty", async () => {
    const u = userEvent.setup();
    const client = fakeClient({ listUsers: vi.fn(async () => ({ users: [] })) });
    render(<AuthGate client={client}>{child}</AuthGate>);
    await u.type(screen.getByTestId("f-email"), "owner@acme.com");
    await u.type(screen.getByTestId("f-password"), "supersecret");
    await u.click(screen.getByTestId("auth-submit"));
    await waitFor(() => expect(screen.getByTestId("users-panel")).toBeInTheDocument());
  });

  it("admin console handles a non-API listUsers failure", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      listUsers: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    });
    render(<AuthGate client={client}>{child}</AuthGate>);
    await u.type(screen.getByTestId("f-email"), "owner@acme.com");
    await u.type(screen.getByTestId("f-password"), "supersecret");
    await u.click(screen.getByTestId("auth-submit"));
    await waitFor(() => expect(screen.getByTestId("users-panel")).toHaveTextContent("Request failed"));
  });

  it("logout still clears the session even if the server logout call fails", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      logout: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    render(<AuthGate client={client}>{child}</AuthGate>);
    await u.type(screen.getByTestId("f-email"), "owner@acme.com");
    await u.type(screen.getByTestId("f-password"), "supersecret");
    await u.click(screen.getByTestId("auth-submit"));
    await waitFor(() => expect(screen.getByTestId("authed-shell")).toBeInTheDocument());
    await u.click(screen.getByTestId("logout-btn"));
    await waitFor(() => expect(screen.getByTestId("auth-screen")).toBeInTheDocument());
  });

  it("offers a one-click demo sign-in that logs in without typing (S89)", async () => {
    const u = userEvent.setup();
    const login = vi.fn(async () => adminSession());
    render(<AuthGate client={fakeClient({ login })}>{child}</AuthGate>);
    await u.click(screen.getByTestId("auth-demo"));
    await waitFor(() => expect(screen.getByTestId("authed-shell")).toBeInTheDocument());
    expect(login).toHaveBeenCalledWith({ email: "owner@acme.test", password: "demo-password-123" });
  });

  it("hides the demo button in register mode", async () => {
    const u = userEvent.setup();
    render(<AuthGate client={fakeClient()}>{child}</AuthGate>);
    expect(screen.getByTestId("auth-demo")).toBeInTheDocument();
    await u.click(screen.getByTestId("auth-toggle")); // -> register
    expect(screen.queryByTestId("auth-demo")).toBeNull();
  });

  it("surfaces an error when demo sign-in fails", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      login: vi.fn(async () => {
        throw new AuthApiError(401, "Invalid email or password.");
      }),
    });
    render(<AuthGate client={client}>{child}</AuthGate>);
    await u.click(screen.getByTestId("auth-demo"));
    await waitFor(() => expect(screen.getByTestId("auth-error")).toHaveTextContent("Invalid email or password."));
  });

  it("shows a generic error when demo sign-in hits a network failure", async () => {
    const u = userEvent.setup();
    const client = fakeClient({
      login: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    render(<AuthGate client={client}>{child}</AuthGate>);
    await u.click(screen.getByTestId("auth-demo"));
    await waitFor(() => expect(screen.getByTestId("auth-error")).toHaveTextContent("Network error"));
  });
});
