import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformScreen } from "../src/platform/PlatformScreen.js";
import { AuthClient, AuthApiError, type AuthSession, type PlatformTenant, type AdminUser } from "../src/auth/authClient.js";

beforeEach(() => cleanup());
afterEach(() => vi.restoreAllMocks());

function session(): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "platform:root", email: "root@platform.io", tenantId: "platform", roles: ["superadmin"] },
  };
}

function tenant(over: Partial<PlatformTenant> = {}): PlatformTenant {
  return { id: "acme", name: "Acme", status: "active", userCount: 3, ...over };
}
function adminUser(over: Partial<AdminUser> = {}): AdminUser {
  return { id: "acme:u@acme.com", email: "u@acme.com", tenantId: "acme", roles: ["admin"], active: true, ...over };
}

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = {
    listTenants: vi.fn(async () => ({ tenants: [tenant(), tenant({ id: "globex", name: "Globex", status: "suspended", userCount: undefined })] })),
    listTenantUsers: vi.fn(async () => ({ users: [adminUser(), adminUser({ id: "acme:v@acme.com", email: "v@acme.com", roles: ["viewer"], active: false })] })),
    provisionTenant: vi.fn(async () => ({ tenant: tenant({ id: "newco", name: "NewCo" }), admin: adminUser({ id: "newco:a@newco.com", email: "a@newco.com" }) })),
    suspendTenant: vi.fn(async () => tenant({ status: "suspended" })),
    activateTenant: vi.fn(async () => tenant({ status: "active" })),
  };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("PlatformScreen load (S98)", () => {
  it("lists tenants with status + user counts", async () => {
    render(<PlatformScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    expect(screen.getByText("Globex")).toBeInTheDocument();
    expect(screen.getAllByText("active").length).toBeGreaterThan(0);
    expect(screen.getByText("suspended")).toBeInTheDocument();
  });

  it("shows an API error when listing fails", async () => {
    const client = fakeClient({ listTenants: vi.fn(async () => { throw new AuthApiError(403, "Requires admin:platform"); }) });
    render(<PlatformScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("platform-error")).toHaveTextContent("admin:platform"));
  });

  it("shows a generic error on a non-API list failure", async () => {
    const client = fakeClient({ listTenants: vi.fn(async () => { throw new Error("socket"); }) });
    render(<PlatformScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("platform-error")).toHaveTextContent("Request failed"));
  });

  it("renders the empty state when there are no tenants", async () => {
    const client = fakeClient({ listTenants: vi.fn(async () => ({ tenants: [] })) });
    render(<PlatformScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByText("No tenants yet.")).toBeInTheDocument());
  });
});

describe("PlatformScreen drill (S98)", () => {
  it("drills into a tenant's users", async () => {
    const u = userEvent.setup();
    render(<PlatformScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("drill-acme"));
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
  });

  it("shows a drill error when the tenant users fail to load", async () => {
    const u = userEvent.setup();
    const client = fakeClient({ listTenantUsers: vi.fn(async () => { throw new AuthApiError(404, "Tenant not found"); }) });
    render(<PlatformScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("drill-acme"));
    await waitFor(() => expect(screen.getByTestId("drill-error")).toHaveTextContent("Tenant not found"));
  });

  it("shows a generic drill error on a non-API failure", async () => {
    const u = userEvent.setup();
    const client = fakeClient({ listTenantUsers: vi.fn(async () => { throw new Error("socket"); }) });
    render(<PlatformScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("drill-acme"));
    await waitFor(() => expect(screen.getByTestId("drill-error")).toHaveTextContent("Request failed"));
  });

  it("shows the empty state when a tenant has no users", async () => {
    const u = userEvent.setup();
    const client = fakeClient({ listTenantUsers: vi.fn(async () => ({ users: [] })) });
    render(<PlatformScreen client={client} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("drill-acme"));
    await waitFor(() => expect(screen.getByText("No users in this tenant.")).toBeInTheDocument());
  });

  it("closes the drill modal", async () => {
    const u = userEvent.setup();
    render(<PlatformScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("drill-acme"));
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByTestId("drill-close"));
    await waitFor(() => expect(screen.queryByText("u@acme.com")).toBeNull());
  });
});

describe("PlatformScreen provision (S98)", () => {
  it("provisions a tenant and reveals the admin temp password once", async () => {
    const u = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const provisionTenant = vi.fn(async () => ({ tenant: tenant({ id: "newco", name: "NewCo" }), admin: adminUser({ id: "newco:a@newco.com", email: "a@newco.com" }) }));
    render(<PlatformScreen client={fakeClient({ provisionTenant })} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-provision"));
    await u.type(screen.getByTestId("pt-id"), "newco");
    await u.type(screen.getByTestId("pt-name"), "NewCo");
    await u.type(screen.getByTestId("pt-email"), "a@newco.com");
    await u.click(screen.getByTestId("provision-submit"));
    await waitFor(() => expect(screen.getByTestId("temp-password")).toHaveTextContent("a@newco.com"));
    const call = provisionTenant.mock.calls[0][1] as { tenantId: string; tenantName: string; adminEmail: string };
    expect(call.tenantId).toBe("newco");
    expect(call.adminEmail).toBe("a@newco.com");
  });

  it("disables provision until all fields are filled", async () => {
    const u = userEvent.setup();
    render(<PlatformScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-provision"));
    expect(screen.getByTestId("provision-submit")).toBeDisabled();
    await u.type(screen.getByTestId("pt-id"), "newco");
    await u.type(screen.getByTestId("pt-name"), "NewCo");
    expect(screen.getByTestId("provision-submit")).toBeDisabled(); // email still empty
    await u.type(screen.getByTestId("pt-email"), "a@newco.com");
    expect(screen.getByTestId("provision-submit")).toBeEnabled();
  });

  it("shows an API error inside the provision modal", async () => {
    const u = userEvent.setup();
    const provisionTenant = vi.fn(async () => { throw new AuthApiError(409, "Tenant already exists: acme"); });
    render(<PlatformScreen client={fakeClient({ provisionTenant })} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-provision"));
    await u.type(screen.getByTestId("pt-id"), "acme");
    await u.type(screen.getByTestId("pt-name"), "Acme");
    await u.type(screen.getByTestId("pt-email"), "a@acme.com");
    await u.click(screen.getByTestId("provision-submit"));
    await waitFor(() => expect(screen.getByTestId("provision-error")).toHaveTextContent("already exists"));
  });

  it("shows a network error inside the provision modal", async () => {
    const u = userEvent.setup();
    const provisionTenant = vi.fn(async () => { throw new Error("offline"); });
    render(<PlatformScreen client={fakeClient({ provisionTenant })} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-provision"));
    await u.type(screen.getByTestId("pt-id"), "newco");
    await u.type(screen.getByTestId("pt-name"), "NewCo");
    await u.type(screen.getByTestId("pt-email"), "a@newco.com");
    await u.click(screen.getByTestId("provision-submit"));
    await waitFor(() => expect(screen.getByTestId("provision-error")).toHaveTextContent("Network error"));
  });

  it("can cancel the provision modal", async () => {
    const u = userEvent.setup();
    const provisionTenant = vi.fn();
    render(<PlatformScreen client={fakeClient({ provisionTenant })} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-provision"));
    await u.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("pt-id")).toBeNull());
    expect(provisionTenant).not.toHaveBeenCalled();
  });
});

describe("PlatformScreen suspend / activate (S98)", () => {
  it("suspends a tenant after confirmation", async () => {
    const u = userEvent.setup();
    const suspendTenant = vi.fn(async () => tenant({ status: "suspended" }));
    render(<PlatformScreen client={fakeClient({ suspendTenant })} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("suspend-acme"));
    await u.click(screen.getByTestId("suspend-confirm"));
    await waitFor(() => expect(screen.getByTestId("platform-notice")).toHaveTextContent("Suspended Acme"));
    expect(suspendTenant).toHaveBeenCalledWith("tok", "acme");
  });

  it("can cancel the suspend confirmation without suspending", async () => {
    const u = userEvent.setup();
    const suspendTenant = vi.fn();
    render(<PlatformScreen client={fakeClient({ suspendTenant })} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("suspend-acme"));
    await u.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("suspend-confirm")).toBeNull());
    expect(suspendTenant).not.toHaveBeenCalled();
  });

  it("surfaces an error if suspend fails", async () => {
    const u = userEvent.setup();
    const suspendTenant = vi.fn(async () => { throw new AuthApiError(404, "Tenant not found"); });
    render(<PlatformScreen client={fakeClient({ suspendTenant })} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("suspend-acme"));
    await u.click(screen.getByTestId("suspend-confirm"));
    await waitFor(() => expect(screen.getByTestId("platform-error")).toHaveTextContent("Tenant not found"));
  });

  it("surfaces a network error if suspend throws non-API", async () => {
    const u = userEvent.setup();
    const suspendTenant = vi.fn(async () => { throw new Error("offline"); });
    render(<PlatformScreen client={fakeClient({ suspendTenant })} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("suspend-acme"));
    await u.click(screen.getByTestId("suspend-confirm"));
    await waitFor(() => expect(screen.getByTestId("platform-error")).toHaveTextContent("Network error"));
  });

  it("reactivates a suspended tenant", async () => {
    const u = userEvent.setup();
    const activateTenant = vi.fn(async () => tenant({ id: "globex", name: "Globex", status: "active" }));
    render(<PlatformScreen client={fakeClient({ activateTenant })} session={session()} />);
    await waitFor(() => expect(screen.getByText("Globex")).toBeInTheDocument());
    await u.click(screen.getByTestId("activate-globex"));
    await waitFor(() => expect(screen.getByTestId("platform-notice")).toHaveTextContent("Reactivated Globex"));
    expect(activateTenant).toHaveBeenCalledWith("tok", "globex");
  });

  it("surfaces an error if activate fails", async () => {
    const u = userEvent.setup();
    const activateTenant = vi.fn(async () => { throw new AuthApiError(404, "Tenant not found"); });
    render(<PlatformScreen client={fakeClient({ activateTenant })} session={session()} />);
    await waitFor(() => expect(screen.getByText("Globex")).toBeInTheDocument());
    await u.click(screen.getByTestId("activate-globex"));
    await waitFor(() => expect(screen.getByTestId("platform-error")).toHaveTextContent("Tenant not found"));
  });

  it("surfaces a network error if activate throws non-API", async () => {
    const u = userEvent.setup();
    const activateTenant = vi.fn(async () => { throw new Error("offline"); });
    render(<PlatformScreen client={fakeClient({ activateTenant })} session={session()} />);
    await waitFor(() => expect(screen.getByText("Globex")).toBeInTheDocument());
    await u.click(screen.getByTestId("activate-globex"));
    await waitFor(() => expect(screen.getByTestId("platform-error")).toHaveTextContent("Network error"));
  });

  it("dismisses the notice banner", async () => {
    const u = userEvent.setup();
    render(<PlatformScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("Globex")).toBeInTheDocument());
    await u.click(screen.getByTestId("activate-globex"));
    await waitFor(() => expect(screen.getByTestId("platform-notice")).toBeInTheDocument());
    await u.click(screen.getByLabelText("Dismiss"));
    await waitFor(() => expect(screen.queryByTestId("platform-notice")).toBeNull());
  });
});

describe("PlatformScreen modal close affordances (S98)", () => {
  it("dismisses the admin temp-password banner after provisioning", async () => {
    const u = userEvent.setup();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    render(<PlatformScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-provision"));
    await u.type(screen.getByTestId("pt-id"), "newco");
    await u.type(screen.getByTestId("pt-name"), "NewCo");
    await u.type(screen.getByTestId("pt-email"), "a@newco.com");
    await u.click(screen.getByTestId("provision-submit"));
    await waitFor(() => expect(screen.getByTestId("temp-password")).toBeInTheDocument());
    await u.click(screen.getByLabelText("Dismiss"));
    await waitFor(() => expect(screen.queryByTestId("temp-password")).toBeNull());
  });

  it("closes the drill modal via the X (onClose)", async () => {
    const u = userEvent.setup();
    render(<PlatformScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("drill-acme"));
    await waitFor(() => expect(screen.getByText("u@acme.com")).toBeInTheDocument());
    await u.click(screen.getByLabelText("Close"));
    await waitFor(() => expect(screen.queryByText("u@acme.com")).toBeNull());
  });

  it("closes the provision modal via the X (onClose)", async () => {
    const u = userEvent.setup();
    render(<PlatformScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-provision"));
    await u.click(screen.getByLabelText("Close"));
    await waitFor(() => expect(screen.queryByTestId("pt-id")).toBeNull());
  });

  it("closes the suspend confirm modal via the X (onClose)", async () => {
    const u = userEvent.setup();
    render(<PlatformScreen client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await u.click(screen.getByTestId("suspend-acme"));
    await waitFor(() => expect(screen.getByTestId("suspend-confirm")).toBeInTheDocument());
    await u.click(screen.getByLabelText("Close"));
    await waitFor(() => expect(screen.queryByTestId("suspend-confirm")).toBeNull());
  });
});
