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

  return (
    <div className="af-root af-shell">
      <aside className={"af-shell__sidebar" + (drawerOpen ? " af-shell__sidebar--open" : "")}>
        <div className="af-shell__brand">
          <span className="af-shell__brand-mark">AF</span>
          <span className="af-shell__brand-name">AgentFoundry</span>
        </div>
        <nav className="af-shell__nav" aria-label="Primary">
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
