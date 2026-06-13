import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsersScreen, generateTempPassword } from "../src/admin/UsersScreen.js";
import { AuthClient, AuthApiError, type AuthSession, type AdminUser } from "../src/auth/authClient.js";

beforeEach(() => cleanup());
afterEach(() => vi.restoreAllMocks());

function session(): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"] },
  };
}

function user(over: Partial<AdminUser> = {}): AdminUser {
  return { id: "acme:u@acme.com", email: "u@acme.com", tenantId: "acme", roles: ["viewer"], active: true, ...over };
}

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = {
    listAdminUsers: vi.fn(async () => ({ users: [user(), user({ id: "acme:a@acme.com", email: "a@acme.com", roles: ["admin"], displayName: "Ada" })] })),
    adminCreateUser: vi.fn(async () => user({ id: "acme:new@acme.com", email: "new@acme.com" })),
    setUserRoles: vi.fn(async () => user({ roles: ["composer"] })),
    deactivateUser: vi.fn(async () => user({ active: false })),
    reactivateUser: vi.fn(async () => user({ active: true })),
    resetUserPassword: vi.fn(async () => ({ reset: true })),
  };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("generateTempPassword (S97)", () => {
  it("produces a 14-char password from the allowed alphabet", () => {
    const pw = generateTempPassword();
    expect(pw).toHaveLength(14);
    expect(pw).toMatch(/^[A-HJ-NP-Za-hj-km-np-z2-9]+$/);
  });
});

describe("UsersScreen load (S97)", () => {
  it("renders the tenant users in a table", async () => {
    render(<UsersScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    expect(screen.getByText("a@acme.com")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("shows an API error when listing fails", async () => {
    const client = fakeClient({ listAdminUsers: vi.fn(async () => { throw new AuthApiError(500, "boom"); }) });
    render(<UsersScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("users-error")).toHaveTextContent("boom"));
  });

  it("shows a generic error on a non-API list failure", async () => {
    const client = fakeClient({ listAdminUsers: vi.fn(async () => { throw new Error("socket"); }) });
    render(<UsersScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("users-error")).toHaveTextContent("Request failed"));
  });

  it("renders the empty state when there are no users", async () => {
    const client = fakeClient({ listAdminUsers: vi.fn(async () => ({ users: [] })) });
    render(<UsersScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByText("No users yet.")).toBeInTheDocument());
  });
});

describe("UsersScreen create (S97)", () => {
  it("creates a user, toggles roles, and reveals the temp password once", async () => {
    const u = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const adminCreateUser = vi.fn(async () => user({ id: "acme:new@acme.com", email: "new@acme.com", roles: ["composer"] }));
    render(<UsersScreen client={fakeClient({ adminCreateUser })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-create"));
    await u.type(screen.getByTestId("nu-email"), "new@acme.com");
    await u.type(screen.getByTestId("nu-name"), "New Person");
    await u.click(screen.getByTestId("nu-role-composer")); // add composer
    await u.click(screen.getByTestId("nu-role-viewer")); // remove default viewer
    await u.click(screen.getByTestId("create-submit"));
    await waitFor(() => expect(screen.getByTestId("temp-password")).toBeInTheDocument());
    expect(screen.getByTestId("temp-password")).toHaveTextContent("new@acme.com");
    const call = adminCreateUser.mock.calls[0][1] as { email: string; roles: string[]; displayName?: string };
    expect(call.email).toBe("new@acme.com");
    expect(call.roles).toContain("composer");
    expect(call.roles).not.toContain("viewer");
    expect(call.displayName).toBe("New Person");
  });

  it("disables create until an email is entered", async () => {
    const u = userEvent.setup();
    render(<UsersScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-create"));
    expect(screen.getByTestId("create-submit")).toBeDisabled();
    await u.type(screen.getByTestId("nu-email"), "x@acme.com");
    expect(screen.getByTestId("create-submit")).toBeEnabled();
  });

  it("shows an API error inside the create modal and stays open", async () => {
    const u = userEvent.setup();
    const adminCreateUser = vi.fn(async () => { throw new AuthApiError(409, "Email already registered: x@acme.com"); });
    render(<UsersScreen client={fakeClient({ adminCreateUser })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-create"));
    await u.type(screen.getByTestId("nu-email"), "x@acme.com");
    await u.click(screen.getByTestId("create-submit"));
    await waitFor(() => expect(screen.getByTestId("create-error")).toHaveTextContent("already registered"));
  });

  it("shows a network error inside the create modal", async () => {
    const u = userEvent.setup();
    const adminCreateUser = vi.fn(async () => { throw new Error("offline"); });
    render(<UsersScreen client={fakeClient({ adminCreateUser })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-create"));
    await u.type(screen.getByTestId("nu-email"), "x@acme.com");
    await u.click(screen.getByTestId("create-submit"));
    await waitFor(() => expect(screen.getByTestId("create-error")).toHaveTextContent("Network error"));
  });

  it("can be cancelled without creating", async () => {
    const u = userEvent.setup();
    const adminCreateUser = vi.fn();
    render(<UsersScreen client={fakeClient({ adminCreateUser })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-create"));
    await u.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("nu-email")).toBeNull());
    expect(adminCreateUser).not.toHaveBeenCalled();
  });

  it("closes the create modal via the X button", async () => {
    const u = userEvent.setup();
    render(<UsersScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-create"));
    await u.click(screen.getByLabelText("Close"));
    await waitFor(() => expect(screen.queryByTestId("nu-email")).toBeNull());
  });
});

describe("UsersScreen edit roles (S97)", () => {
  it("opens the edit modal, toggles a role, and saves", async () => {
    const u = userEvent.setup();
    const setUserRoles = vi.fn(async () => user({ roles: ["viewer", "reviewer"] }));
    render(<UsersScreen client={fakeClient({ setUserRoles })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("edit-acme:u@acme.com"));
    await u.click(screen.getByTestId("er-role-reviewer"));
    await u.click(screen.getByTestId("roles-submit"));
    await waitFor(() => expect(screen.getByTestId("users-notice")).toHaveTextContent("Updated roles for u@acme.com"));
    const call = setUserRoles.mock.calls[0];
    expect(call[1]).toBe("acme:u@acme.com");
    expect(call[2]).toContain("reviewer");
  });

  it("disables save when all roles are removed", async () => {
    const u = userEvent.setup();
    render(<UsersScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("edit-acme:u@acme.com"));
    await u.click(screen.getByTestId("er-role-viewer")); // remove the only role
    expect(screen.getByTestId("roles-submit")).toBeDisabled();
  });

  it("closes the edit modal via Cancel", async () => {
    const u = userEvent.setup();
    const setUserRoles = vi.fn();
    render(<UsersScreen client={fakeClient({ setUserRoles })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("edit-acme:u@acme.com"));
    await u.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("er-role-viewer")).toBeNull());
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("closes the edit modal via the X button", async () => {
    const u = userEvent.setup();
    render(<UsersScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("edit-acme:u@acme.com"));
    await u.click(screen.getByLabelText("Close"));
    await waitFor(() => expect(screen.queryByTestId("er-role-viewer")).toBeNull());
  });

  it("shows an error if saving roles fails", async () => {
    const u = userEvent.setup();
    const setUserRoles = vi.fn(async () => { throw new AuthApiError(409, "Cannot remove the last admin"); });
    render(<UsersScreen client={fakeClient({ setUserRoles })} session={session()} />);
    await waitFor(() => expect(screen.getByText("a@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("edit-acme:a@acme.com"));
    await u.click(screen.getByTestId("er-role-reviewer"));
    await u.click(screen.getByTestId("roles-submit"));
    await waitFor(() => expect(screen.getByTestId("roles-error")).toHaveTextContent("last admin"));
  });

  it("shows a network error if saving roles throws non-API", async () => {
    const u = userEvent.setup();
    const setUserRoles = vi.fn(async () => { throw new Error("offline"); });
    render(<UsersScreen client={fakeClient({ setUserRoles })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("edit-acme:u@acme.com"));
    await u.click(screen.getByTestId("er-role-reviewer"));
    await u.click(screen.getByTestId("roles-submit"));
    await waitFor(() => expect(screen.getByTestId("roles-error")).toHaveTextContent("Network error"));
  });
});

describe("UsersScreen activate / reset (S97)", () => {
  it("deactivates an active user", async () => {
    const u = userEvent.setup();
    const deactivateUser = vi.fn(async () => user({ active: false }));
    render(<UsersScreen client={fakeClient({ deactivateUser })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("deactivate-acme:u@acme.com"));
    await waitFor(() => expect(screen.getByTestId("users-notice")).toHaveTextContent("Deactivated u@acme.com"));
    expect(deactivateUser).toHaveBeenCalledWith("tok", "acme:u@acme.com");
  });

  it("reactivates a deactivated user", async () => {
    const u = userEvent.setup();
    const reactivateUser = vi.fn(async () => user({ active: true }));
    const listAdminUsers = vi.fn(async () => ({ users: [user({ active: false })] }));
    render(<UsersScreen client={fakeClient({ reactivateUser, listAdminUsers })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("reactivate-acme:u@acme.com"));
    await waitFor(() => expect(screen.getByTestId("users-notice")).toHaveTextContent("Reactivated u@acme.com"));
  });

  it("surfaces an error when activate/deactivate fails", async () => {
    const u = userEvent.setup();
    const deactivateUser = vi.fn(async () => { throw new AuthApiError(409, "last admin"); });
    render(<UsersScreen client={fakeClient({ deactivateUser })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("deactivate-acme:u@acme.com"));
    await waitFor(() => expect(screen.getByTestId("users-error")).toHaveTextContent("last admin"));
  });

  it("surfaces a network error when activate throws non-API", async () => {
    const u = userEvent.setup();
    const deactivateUser = vi.fn(async () => { throw new Error("offline"); });
    render(<UsersScreen client={fakeClient({ deactivateUser })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("deactivate-acme:u@acme.com"));
    await waitFor(() => expect(screen.getByTestId("users-error")).toHaveTextContent("Network error"));
  });

  it("resets a password and reveals the temp password once, dismissable", async () => {
    const u = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const resetUserPassword = vi.fn(async () => ({ reset: true }));
    render(<UsersScreen client={fakeClient({ resetUserPassword })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("reset-acme:u@acme.com"));
    await waitFor(() => expect(screen.getByTestId("temp-password")).toHaveTextContent("u@acme.com"));
    expect(resetUserPassword).toHaveBeenCalledOnce();
    await u.click(screen.getByLabelText("Dismiss"));
    await waitFor(() => expect(screen.queryByTestId("temp-password")).toBeNull());
  });

  it("surfaces an error when reset fails", async () => {
    const u = userEvent.setup();
    const resetUserPassword = vi.fn(async () => { throw new AuthApiError(404, "User not found"); });
    render(<UsersScreen client={fakeClient({ resetUserPassword })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("reset-acme:u@acme.com"));
    await waitFor(() => expect(screen.getByTestId("users-error")).toHaveTextContent("User not found"));
  });

  it("surfaces a network error when reset throws non-API", async () => {
    const u = userEvent.setup();
    const resetUserPassword = vi.fn(async () => { throw new Error("offline"); });
    render(<UsersScreen client={fakeClient({ resetUserPassword })} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("reset-acme:u@acme.com"));
    await waitFor(() => expect(screen.getByTestId("users-error")).toHaveTextContent("Network error"));
  });

  it("dismisses the success notice banner", async () => {
    const u = userEvent.setup();
    render(<UsersScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("deactivate-acme:u@acme.com"));
    await waitFor(() => expect(screen.getByTestId("users-notice")).toBeInTheDocument());
    await u.click(screen.getByLabelText("Dismiss"));
    await waitFor(() => expect(screen.queryByTestId("users-notice")).toBeNull());
  });
});
