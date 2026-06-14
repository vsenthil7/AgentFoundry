import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell, type NavItem, type ShellUser } from "../src/ui/AppShell.js";

beforeEach(() => cleanup());

const nav: NavItem[] = [
  { id: "overview", label: "Overview", icon: <span>◆</span> },
  { id: "reviews", label: "Reviews", badge: 3 },
  { id: "users", label: "Users" },
];

function adminUser(over: Partial<ShellUser> = {}): ShellUser {
  return { email: "owner@acme.com", displayName: "Owner One", roles: ["admin"], ...over };
}

function renderShell(over: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  const onNavigate = vi.fn();
  const onLogout = vi.fn();
  render(
    <AppShell
      nav={nav}
      active="overview"
      onNavigate={onNavigate}
      user={adminUser()}
      onLogout={onLogout}
      {...over}
    >
      <div data-testid="page">PAGE</div>
    </AppShell>,
  );
  return { onNavigate, onLogout };
}

describe("AppShell (S94)", () => {
  it("renders the brand, nav, content, and the active section title", () => {
    renderShell();
    expect(screen.getByText("AgentFoundry")).toBeInTheDocument();
    expect(screen.getByTestId("page")).toHaveTextContent("PAGE");
    // The topbar title reflects the active nav label.
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("marks the active nav item with aria-current", () => {
    renderShell();
    const overview = screen.getByRole("button", { name: /Overview/ });
    expect(overview).toHaveClass("af-shell__navitem--active");
    expect(overview).toHaveAttribute("aria-current", "page");
  });

  it("renders an icon and a badge when provided", () => {
    renderShell();
    expect(screen.getByText("◆")).toBeInTheDocument();
    expect(screen.getByText("3")).toHaveClass("af-shell__navbadge");
  });

  it("navigates when a nav item is clicked", async () => {
    const { onNavigate } = renderShell();
    await userEvent.click(screen.getByRole("button", { name: "Users" }));
    expect(onNavigate).toHaveBeenCalledWith("users");
  });

  it("signs out via the topbar button", async () => {
    const { onLogout } = renderShell();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("toggles the mobile drawer open and closed, and closes via the scrim", async () => {
    renderShell();
    const sidebar = document.querySelector(".af-shell__sidebar")!;
    expect(sidebar).not.toHaveClass("af-shell__sidebar--open");
    await userEvent.click(screen.getByLabelText("Toggle navigation"));
    expect(sidebar).toHaveClass("af-shell__sidebar--open");
    // The scrim appears while open; clicking it closes the drawer.
    const scrim = document.querySelector(".af-shell__scrim")!;
    expect(scrim).toBeInTheDocument();
    await userEvent.click(scrim);
    expect(sidebar).not.toHaveClass("af-shell__sidebar--open");
  });

  it("closes the drawer after navigating from it", async () => {
    const { onNavigate } = renderShell();
    await userEvent.click(screen.getByLabelText("Toggle navigation"));
    const sidebar = document.querySelector(".af-shell__sidebar")!;
    expect(sidebar).toHaveClass("af-shell__sidebar--open");
    await userEvent.click(screen.getByRole("button", { name: /Reviews/ }));
    expect(onNavigate).toHaveBeenCalledWith("reviews");
    expect(sidebar).not.toHaveClass("af-shell__sidebar--open");
  });

  it("falls back to the email when no displayName is set", () => {
    renderShell({ user: adminUser({ displayName: undefined }) });
    // username appears in the sidebar user box (email used as the name)
    expect(screen.getAllByText("owner@acme.com").length).toBeGreaterThan(0);
  });

  it("shows an empty title when the active id is unknown", () => {
    renderShell({ active: "does-not-exist" });
    expect(document.querySelector(".af-shell__title")).toHaveTextContent("");
  });

  // ---- S108: keyboard-accessible nav ----
  it("moves focus across nav items with ArrowDown/ArrowUp (wrapping)", async () => {
    const u = userEvent.setup();
    renderShell();
    const items = screen.getAllByRole("button", { name: /Overview|Reviews|Users/ });
    items[0].focus();
    expect(document.activeElement).toBe(items[0]);
    await u.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await u.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[2]);
    // Wrap forward to the first.
    await u.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[0]);
    // Wrap backward to the last.
    await u.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(items[2]);
  });

  it("ArrowUp from a middle item moves to the previous item", async () => {
    const u = userEvent.setup();
    renderShell();
    const items = screen.getAllByRole("button", { name: /Overview|Reviews|Users/ });
    items[2].focus();
    await u.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(items[1]); // current - 1
  });

  it("jumps to the first/last nav item with Home/End", async () => {
    const u = userEvent.setup();
    renderShell();
    const items = screen.getAllByRole("button", { name: /Overview|Reviews|Users/ });
    items[1].focus();
    await u.keyboard("{End}");
    expect(document.activeElement).toBe(items[2]);
    await u.keyboard("{Home}");
    expect(document.activeElement).toBe(items[0]);
  });

  it("ArrowDown from outside the list focuses the first item", async () => {
    renderShell();
    const nav = document.querySelector(".af-shell__nav")!;
    const items = screen.getAllByRole("button", { name: /Overview|Reviews|Users/ });
    // No nav item is focused; ArrowDown on the nav should focus the first item.
    fireEvent.keyDown(nav, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("ignores non-navigation keys in the nav", async () => {
    const u = userEvent.setup();
    renderShell();
    const items = screen.getAllByRole("button", { name: /Overview|Reviews|Users/ });
    items[0].focus();
    await u.keyboard("a"); // a printable, non-nav key
    expect(document.activeElement).toBe(items[0]); // focus unchanged
  });

  it("closes the open drawer when Escape is pressed", async () => {
    const u = userEvent.setup();
    renderShell();
    await u.click(screen.getByLabelText("Toggle navigation"));
    const sidebar = document.querySelector(".af-shell__sidebar")!;
    expect(sidebar).toHaveClass("af-shell__sidebar--open");
    await u.keyboard("{Escape}");
    expect(sidebar).not.toHaveClass("af-shell__sidebar--open");
  });

  it("Escape is a no-op when the drawer is already closed", async () => {
    const u = userEvent.setup();
    renderShell();
    const sidebar = document.querySelector(".af-shell__sidebar")!;
    expect(sidebar).not.toHaveClass("af-shell__sidebar--open");
    await u.keyboard("{Escape}");
    expect(sidebar).not.toHaveClass("af-shell__sidebar--open");
  });
});
