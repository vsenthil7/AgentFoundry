// S97 — Tenant-admin user management screen (admin:manage_users).
// Lists tenant users, creates users, edits roles, deactivates/reactivates, and
// resets passwords (showing the generated temp password once). Wired to the S91
// backend via authClient. Built on the design-system primitives.

import { useEffect, useState, useCallback } from "react";
import { AuthClient, AuthApiError, type AuthSession, type AdminUser } from "../auth/authClient.js";
import { Card, Table, Badge, Button, Banner, Modal, Field, Input, type Column } from "../ui/components.js";

export interface UsersScreenProps {
  client: AuthClient;
  session: AuthSession;
}

// The assignable tenant roles (superadmin is platform-only, not offered here).
const ASSIGNABLE_ROLES = ["admin", "composer", "reviewer", "ops", "viewer"] as const;

// A short random temp password generator for admin-created users / resets.
export function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function UsersScreen({ client, session }: UsersScreenProps) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);

  // Create-user modal state.
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRoles, setNewRoles] = useState<string[]>(["viewer"]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit-roles modal state.
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await client.listAdminUsers(session.token);
      setUsers(r.users);
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "Request failed — try again.");
      setUsers([]);
    }
  }, [client, session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRole = (list: string[], role: string): string[] =>
    list.includes(role) ? list.filter((r) => r !== role) : [...list, role];

  const submitCreate = async () => {
    setCreateError(null);
    setCreating(true);
    const password = generateTempPassword();
    try {
      const created = await client.adminCreateUser(session.token, {
        email: newEmail.trim(),
        password,
        roles: newRoles,
        displayName: newName.trim() || undefined,
      });
      setCreateOpen(false);
      setNewEmail("");
      setNewName("");
      setNewRoles(["viewer"]);
      setTempPassword({ email: created.email, password });
      setNotice(null);
      await load();
    } catch (err) {
      setCreateError(err instanceof AuthApiError ? err.message : "Network error — try again.");
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (u: AdminUser) => {
    setEditUser(u);
    setEditRoles([...u.roles]);
    setEditError(null);
  };

  const saveRoles = async (target: AdminUser) => {
    setEditError(null);
    setSavingRoles(true);
    try {
      await client.setUserRoles(session.token, target.id, editRoles);
      setEditUser(null);
      setNotice(`Updated roles for ${target.email}.`);
      await load();
    } catch (err) {
      setEditError(err instanceof AuthApiError ? err.message : "Network error — try again.");
    } finally {
      setSavingRoles(false);
    }
  };

  const setActive = async (u: AdminUser, active: boolean) => {
    setError(null);
    try {
      if (active) await client.reactivateUser(session.token, u.id);
      else await client.deactivateUser(session.token, u.id);
      setNotice(`${active ? "Reactivated" : "Deactivated"} ${u.email}.`);
      await load();
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "Network error — try again.");
    }
  };

  const resetPassword = async (u: AdminUser) => {
    setError(null);
    const password = generateTempPassword();
    try {
      await client.resetUserPassword(session.token, u.id, password);
      setTempPassword({ email: u.email, password });
      setNotice(null);
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "Network error — try again.");
    }
  };

  const columns: ReadonlyArray<Column<AdminUser>> = [
    { key: "email", header: "Email", render: (u) => u.email },
    { key: "name", header: "Name", render: (u) => u.displayName || "—" },
    {
      key: "roles",
      header: "Roles",
      render: (u) => (
        <span className="af-users__roles">
          {u.roles.map((r) => (
            <Badge key={r} tone="brand">{r}</Badge>
          ))}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (u) => (u.active ? <Badge tone="success">active</Badge> : <Badge tone="neutral">deactivated</Badge>),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (u) => (
        <span className="af-users__actions">
          <Button variant="ghost" data-testid={`edit-${u.id}`} onClick={() => openEdit(u)}>Roles</Button>
          <Button variant="ghost" data-testid={`reset-${u.id}`} onClick={() => resetPassword(u)}>Reset password</Button>
          {u.active ? (
            <Button variant="danger" data-testid={`deactivate-${u.id}`} onClick={() => setActive(u, false)}>Deactivate</Button>
          ) : (
            <Button variant="secondary" data-testid={`reactivate-${u.id}`} onClick={() => setActive(u, true)}>Reactivate</Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="af-users" data-testid="users-screen">
      <Card
        title="Users"
        actions={<Button variant="primary" data-testid="open-create" onClick={() => { setCreateOpen(true); setCreateError(null); }}>Add user</Button>}
      >
        {error && <Banner tone="danger" data-testid="users-error" className="af-users__banner">{error}</Banner>}
        {notice && <Banner tone="success" data-testid="users-notice" className="af-users__banner" onDismiss={() => setNotice(null)}>{notice}</Banner>}
        {tempPassword && (
          <Banner tone="info" data-testid="temp-password" className="af-users__banner" onDismiss={() => setTempPassword(null)}>
            Temporary password for <strong>{tempPassword.email}</strong>: <code>{tempPassword.password}</code> — share it securely; it is shown once.
          </Banner>
        )}
        {users === null ? (
          <p data-testid="users-loading" className="af-users__loading">Loading users…</p>
        ) : (
          <Table<AdminUser> columns={columns} rows={users} rowKey={(u) => u.id} empty="No users yet." />
        )}
      </Card>

      <Modal
        open={createOpen}
        title="Add a user"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" data-testid="create-submit" disabled={creating || newEmail.trim().length === 0} onClick={submitCreate}>
              Create user
            </Button>
          </>
        }
      >
        <Field label="Email" htmlFor="nu-email">
          <Input id="nu-email" data-testid="nu-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="person@company.com" />
        </Field>
        <Field label="Display name" htmlFor="nu-name" hint="Optional.">
          <Input id="nu-name" data-testid="nu-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </Field>
        <Field label="Roles" htmlFor="nu-roles">
          <div className="af-users__rolepick" data-testid="nu-roles">
            {ASSIGNABLE_ROLES.map((r) => (
              <label key={r} className="af-users__rolechk">
                <input
                  type="checkbox"
                  data-testid={`nu-role-${r}`}
                  checked={newRoles.includes(r)}
                  onChange={() => setNewRoles((cur) => toggleRole(cur, r))}
                />
                {r}
              </label>
            ))}
          </div>
        </Field>
        <p className="af-users__hint">A temporary password is generated and shown once after creation.</p>
        {createError && <Banner tone="danger" data-testid="create-error">{createError}</Banner>}
      </Modal>

      <Modal
        open={editUser !== null}
        title={editUser ? `Roles for ${editUser.email}` : ""}
        onClose={() => setEditUser(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button variant="primary" data-testid="roles-submit" disabled={savingRoles || editRoles.length === 0} onClick={() => saveRoles(editUser!)}>
              Save roles
            </Button>
          </>
        }
      >
        <div className="af-users__rolepick">
          {ASSIGNABLE_ROLES.map((r) => (
            <label key={r} className="af-users__rolechk">
              <input
                type="checkbox"
                data-testid={`er-role-${r}`}
                checked={editRoles.includes(r)}
                onChange={() => setEditRoles((cur) => toggleRole(cur, r))}
              />
              {r}
            </label>
          ))}
        </div>
        {editRoles.length === 0 && <p className="af-users__hint">Select at least one role.</p>}
        {editError && <Banner tone="danger" data-testid="roles-error">{editError}</Banner>}
      </Modal>
    </div>
  );
}
