import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileScreen } from "../src/profile/ProfileScreen.js";
import { AuthClient, AuthApiError, type AuthSession, type SessionUser } from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function session(over: Partial<SessionUser> = {}): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.UTC(2026, 0, 2, 3, 4), // 2026-01-02 03:04 UTC
    user: { id: "acme:owner@acme.com", email: "owner@acme.com", tenantId: "acme", roles: ["admin"], ...over },
  };
}

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = {
    updateProfile: vi.fn(async () => session().user),
    changePassword: vi.fn(async () => ({ changed: true, otherSessionsRevoked: 0 })),
  };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("ProfileScreen identity (S96)", () => {
  it("shows email, tenant, roles and a formatted session expiry", () => {
    render(<ProfileScreen client={fakeClient()} session={session()} />);
    expect(screen.getByTestId("profile-email")).toHaveTextContent("owner@acme.com");
    expect(screen.getByTestId("profile-screen")).toHaveTextContent("acme");
    expect(screen.getByTestId("profile-screen")).toHaveTextContent("admin");
    expect(screen.getByTestId("profile-expiry")).toHaveTextContent("2026-01-02 03:04 UTC");
  });

  it("prefills the display name when present", () => {
    render(<ProfileScreen client={fakeClient()} session={session({ displayName: "Owner One" })} />);
    expect(screen.getByTestId("p-displayName")).toHaveValue("Owner One");
  });
});

describe("ProfileScreen profile edit (S96)", () => {
  it("saves profile changes and reports success + notifies parent", async () => {
    const u = userEvent.setup();
    const onProfileUpdated = vi.fn();
    const updateProfile = vi.fn(async () => session({ displayName: "New Name", email: "new@acme.com" }).user);
    render(<ProfileScreen client={fakeClient({ updateProfile })} session={session()} onProfileUpdated={onProfileUpdated} />);
    await u.clear(screen.getByTestId("p-displayName"));
    await u.type(screen.getByTestId("p-displayName"), "New Name");
    await u.clear(screen.getByTestId("p-email"));
    await u.type(screen.getByTestId("p-email"), "owner@acme.com");
    await u.click(screen.getByTestId("p-save"));
    await waitFor(() => expect(screen.getByTestId("profile-msg")).toHaveTextContent("Profile updated."));
    expect(updateProfile).toHaveBeenCalledWith("tok", { displayName: "New Name", email: "owner@acme.com" });
    expect(onProfileUpdated).toHaveBeenCalledOnce();
  });

  it("shows an API error from the profile save", async () => {
    const u = userEvent.setup();
    const updateProfile = vi.fn(async () => {
      throw new AuthApiError(409, "Email already registered: x@acme.com");
    });
    render(<ProfileScreen client={fakeClient({ updateProfile })} session={session()} />);
    await u.click(screen.getByTestId("p-save"));
    await waitFor(() => expect(screen.getByTestId("profile-msg")).toHaveTextContent("already registered"));
  });

  it("shows a network error from the profile save", async () => {
    const u = userEvent.setup();
    const updateProfile = vi.fn(async () => {
      throw new Error("offline");
    });
    render(<ProfileScreen client={fakeClient({ updateProfile })} session={session()} />);
    await u.click(screen.getByTestId("p-save"));
    await waitFor(() => expect(screen.getByTestId("profile-msg")).toHaveTextContent("Network error"));
  });

  it("works without an onProfileUpdated callback", async () => {
    const u = userEvent.setup();
    render(<ProfileScreen client={fakeClient()} session={session()} />);
    await u.click(screen.getByTestId("p-save"));
    await waitFor(() => expect(screen.getByTestId("profile-msg")).toHaveTextContent("Profile updated."));
  });
});

describe("ProfileScreen password change (S96)", () => {
  it("disables the button until current + matching 8+ char new password are present", async () => {
    const u = userEvent.setup();
    render(<ProfileScreen client={fakeClient()} session={session()} />);
    const save = screen.getByTestId("pw-save");
    expect(save).toBeDisabled();
    await u.type(screen.getByTestId("p-current"), "oldpass1");
    await u.type(screen.getByTestId("p-new"), "newpass123");
    expect(save).toBeDisabled(); // confirm empty
    await u.type(screen.getByTestId("p-confirm"), "newpass123");
    expect(save).toBeEnabled();
  });

  it("shows a mismatch error and keeps the button disabled", async () => {
    const u = userEvent.setup();
    render(<ProfileScreen client={fakeClient()} session={session()} />);
    await u.type(screen.getByTestId("p-current"), "oldpass1");
    await u.type(screen.getByTestId("p-new"), "newpass123");
    await u.type(screen.getByTestId("p-confirm"), "different1");
    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    expect(screen.getByTestId("pw-save")).toBeDisabled();
  });

  it("shows a live strength hint for the new password", async () => {
    const u = userEvent.setup();
    render(<ProfileScreen client={fakeClient()} session={session()} />);
    await u.type(screen.getByTestId("p-new"), "Sup3rStr0ng!Pass");
    expect(screen.getByTestId("p-strength")).toHaveTextContent("Strong password");
  });

  it("changes the password and reports success (no other sessions)", async () => {
    const u = userEvent.setup();
    const changePassword = vi.fn(async () => ({ changed: true, otherSessionsRevoked: 0 }));
    render(<ProfileScreen client={fakeClient({ changePassword })} session={session()} />);
    await u.type(screen.getByTestId("p-current"), "oldpass1");
    await u.type(screen.getByTestId("p-new"), "newpass123");
    await u.type(screen.getByTestId("p-confirm"), "newpass123");
    await u.click(screen.getByTestId("pw-save"));
    await waitFor(() => expect(screen.getByTestId("pw-msg")).toHaveTextContent("Password changed."));
    expect(changePassword).toHaveBeenCalledWith("tok", "oldpass1", "newpass123");
    // Fields cleared on success.
    expect(screen.getByTestId("p-current")).toHaveValue("");
  });

  it("mentions revoked sessions when the server reports them", async () => {
    const u = userEvent.setup();
    const changePassword = vi.fn(async () => ({ changed: true, otherSessionsRevoked: 2 }));
    render(<ProfileScreen client={fakeClient({ changePassword })} session={session()} />);
    await u.type(screen.getByTestId("p-current"), "oldpass1");
    await u.type(screen.getByTestId("p-new"), "newpass123");
    await u.type(screen.getByTestId("p-confirm"), "newpass123");
    await u.click(screen.getByTestId("pw-save"));
    await waitFor(() => expect(screen.getByTestId("pw-msg")).toHaveTextContent("2 other session(s) were signed out"));
  });

  it("shows an API error from the password change", async () => {
    const u = userEvent.setup();
    const changePassword = vi.fn(async () => {
      throw new AuthApiError(401, "Current password is incorrect.");
    });
    render(<ProfileScreen client={fakeClient({ changePassword })} session={session()} />);
    await u.type(screen.getByTestId("p-current"), "wrongpass");
    await u.type(screen.getByTestId("p-new"), "newpass123");
    await u.type(screen.getByTestId("p-confirm"), "newpass123");
    await u.click(screen.getByTestId("pw-save"));
    await waitFor(() => expect(screen.getByTestId("pw-msg")).toHaveTextContent("Current password is incorrect."));
  });

  it("shows a network error from the password change", async () => {
    const u = userEvent.setup();
    const changePassword = vi.fn(async () => {
      throw new Error("offline");
    });
    render(<ProfileScreen client={fakeClient({ changePassword })} session={session()} />);
    await u.type(screen.getByTestId("p-current"), "oldpass1");
    await u.type(screen.getByTestId("p-new"), "newpass123");
    await u.type(screen.getByTestId("p-confirm"), "newpass123");
    await u.click(screen.getByTestId("pw-save"));
    await waitFor(() => expect(screen.getByTestId("pw-msg")).toHaveTextContent("Network error"));
  });
});
