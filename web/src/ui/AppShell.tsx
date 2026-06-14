// S94 — AppShell: the persistent SaaS layout (sidebar nav + topbar + content).
// Screens render inside `children`; the shell owns navigation, the brand, the
// signed-in user chip, and a mobile drawer toggle. Purely presentational —
// routing state (active id + onNavigate) is supplied by the caller.

import React, { useState } from "react";
import { Avatar, Button } from "./components.js";

export interface NavItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}
export interface ShellUser {
  email: string;
  displayName?: string;
  roles: readonly string[];
}
export interface AppShellProps {
  nav: ReadonlyArray<NavItem>;
  active: string;
  onNavigate: (id: string) => void;
  user: ShellUser;
  onLogout: () => void;
  children: React.ReactNode;
}

export function AppShell({ nav, active, onNavigate, user, onLogout, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeLabel = nav.find((n) => n.id === active)?.label ?? "";

  const go = (id: string) => {
    onNavigate(id);
    setDrawerOpen(false);
  };

  // S108 — roving keyboard navigation across the sidebar nav items. Arrow keys
  // move focus (wrapping), Home/End jump to the first/last item. Enter/Space
  // activate natively (they are <button>s). This makes the nav operable without
  // a pointer and matches the WAI-ARIA navigation pattern.
  const onNavKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    // currentTarget is the <nav> the handler is bound to, so the item list is
    // always present — no defensive null/empty guard needed.
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>(".af-shell__navitem"));
    const current = items.findIndex((el) => el === document.activeElement);
    e.preventDefault();
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else next = current <= 0 ? items.length - 1 : current - 1; // ArrowUp
    items[next].focus();
  };

  // S108 — Escape closes the mobile drawer when it is open.
  const onShellKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && drawerOpen) setDrawerOpen(false);
  };

  return (
    <div className="af-root af-shell" onKeyDown={onShellKeyDown}>
      <aside className={"af-shell__sidebar" + (drawerOpen ? " af-shell__sidebar--open" : "")}>
        <div className="af-shell__brand">
          <span className="af-shell__brand-mark">AF</span>
          <span className="af-shell__brand-name">AgentFoundry</span>
        </div>
        <nav className="af-shell__nav" aria-label="Primary" onKeyDown={onNavKeyDown}>
          {nav.map((item) => (
            <button
              key={item.id}
              className={"af-shell__navitem af-focusable" + (item.id === active ? " af-shell__navitem--active" : "")}
              aria-current={item.id === active ? "page" : undefined}
              onClick={() => go(item.id)}
            >
              {item.icon && <span className="af-shell__navicon" aria-hidden="true">{item.icon}</span>}
              <span className="af-shell__navlabel">{item.label}</span>
              {item.badge !== undefined && <span className="af-shell__navbadge">{item.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="af-shell__userbox">
          <Avatar name={user.displayName || user.email} />
          <div className="af-shell__userinfo">
            <span className="af-shell__username">{user.displayName || user.email}</span>
            <span className="af-shell__userrole">{user.roles.join(", ")}</span>
          </div>
        </div>
      </aside>

      {drawerOpen && <div className="af-shell__scrim" onClick={() => setDrawerOpen(false)} />}

      <div className="af-shell__main">
        <header className="af-shell__topbar">
          <button
            className="af-shell__menu af-focusable"
            aria-label="Toggle navigation"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            ☰
          </button>
          <h1 className="af-shell__title">{activeLabel}</h1>
          <div className="af-shell__topactions">
            <span className="af-shell__tenant">{user.email}</span>
            <Button variant="ghost" onClick={onLogout}>Sign out</Button>
          </div>
        </header>
        <main className="af-shell__content">{children}</main>
      </div>
    </div>
  );
}
