// S98 — Superadmin platform console screen (admin:platform, cross-tenant).
// Lists every tenant with user counts + status, drills into a tenant's users,
// provisions a new tenant + first admin, and suspends/reactivates a tenant with
// confirmation. Wired to the S92 backend via authClient. Superadmin-only — the
// caller is responsible for route-guarding (rendered only when the role is held).

import { useEffect, useState, useCallback } from "react";
import { AuthClient, AuthApiError, type AuthSession, type PlatformTenant, type AdminUser } from "../auth/authClient.js";
import { generateTempPassword } from "../admin/UsersScreen.js";
import { Card, Table, Badge, Button, Banner, Modal, Field, Input, type Column } from "../ui/components.js";

export interface PlatformScreenProps {
  client: AuthClient;
  session: AuthSession;
}

export function PlatformScreen({ client, session }: PlatformScreenProps) {
  const [tenants, setTenants] = useState<PlatformTenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);

  // Drill-into-tenant-users modal.
  const [drillTenant, setDrillTenant] = useState<PlatformTenant | null>(null);
  const [drillUsers, setDrillUsers] = useState<AdminUser[] | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);

  // Provision-tenant modal.
  const [createOpen, setCreateOpen] = useState(false);
  const [tId, setTId] = useState("");
  const [tName, setTName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Suspend confirm modal.
  const [suspendTenant, setSuspendTenant] = useState<PlatformTenant | null>(null);
  const [suspending, setSuspending] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await client.listTenants(session.token);
      setTenants(r.tenants);
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "Request failed — try again.");
      setTenants([]);
    }
  }, [client, session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDrill = async (t: PlatformTenant) => {
    setDrillTenant(t);
    setDrillUsers(null);
    setDrillError(null);
    try {
      const r = await client.listTenantUsers(session.token, t.id);
      setDrillUsers(r.users);
    } catch (err) {
      setDrillError(err instanceof AuthApiError ? err.message : "Request failed — try again.");
      setDrillUsers([]);
    }
  };

  const submitCreate = async () => {
    setCreateError(null);
    setCreating(true);
    const adminPassword = generateTempPassword();
    try {
      const r = await client.provisionTenant(session.token, {
        tenantId: tId.trim(),
        tenantName: tName.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
      });
      setCreateOpen(false);
      setTId("");
      setTName("");
      setAdminEmail("");
      setTempPassword({ email: r.admin.email, password: adminPassword });
      setNotice(null);
      await load();
    } catch (err) {
      setCreateError(err instanceof AuthApiError ? err.message : "Network error — try again.");
    } finally {
      setCreating(false);
    }
  };

  const confirmSuspend = async (target: PlatformTenant) => {
    setSuspending(true);
    setError(null);
    try {
      await client.suspendTenant(session.token, target.id);
      setSuspendTenant(null);
      setNotice(`Suspended ${target.name}. Its users can no longer sign in.`);
      await load();
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "Network error — try again.");
    } finally {
      setSuspending(false);
    }
  };

  const activate = async (t: PlatformTenant) => {
    setError(null);
    try {
      await client.activateTenant(session.token, t.id);
      setNotice(`Reactivated ${t.name}.`);
      await load();
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "Network error — try again.");
    }
  };

  const columns: ReadonlyArray<Column<PlatformTenant>> = [
    { key: "name", header: "Tenant", render: (t) => t.name },
    { key: "id", header: "ID", render: (t) => t.id },
    { key: "users", header: "Users", align: "right", render: (t) => t.userCount ?? 0 },
    {
      key: "status",
      header: "Status",
      render: (t) => (t.status === "active" ? <Badge tone="success">active</Badge> : <Badge tone="danger">suspended</Badge>),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (t) => (
        <span className="af-platform__actions">
          <Button variant="ghost" data-testid={`drill-${t.id}`} onClick={() => openDrill(t)}>Users</Button>
          {t.status === "active" ? (
            <Button variant="danger" data-testid={`suspend-${t.id}`} onClick={() => setSuspendTenant(t)}>Suspend</Button>
          ) : (
            <Button variant="secondary" data-testid={`activate-${t.id}`} onClick={() => activate(t)}>Reactivate</Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="af-platform" data-testid="platform-screen">
      <Card
        title="Tenants"
        actions={<Button variant="primary" data-testid="open-provision" onClick={() => { setCreateOpen(true); setCreateError(null); }}>Provision tenant</Button>}
      >
        {error && <Banner tone="danger" data-testid="platform-error" className="af-platform__banner">{error}</Banner>}
        {notice && <Banner tone="success" data-testid="platform-notice" className="af-platform__banner" onDismiss={() => setNotice(null)}>{notice}</Banner>}
        {tempPassword && (
          <Banner tone="info" data-testid="temp-password" className="af-platform__banner" onDismiss={() => setTempPassword(null)}>
            Admin temporary password for <strong>{tempPassword.email}</strong>: <code>{tempPassword.password}</code> — share it securely; it is shown once.
          </Banner>
        )}
        {tenants === null ? (
          <p data-testid="platform-loading" className="af-platform__loading">Loading tenants…</p>
        ) : (
          <Table<PlatformTenant> columns={columns} rows={tenants} rowKey={(t) => t.id} empty="No tenants yet." />
        )}
      </Card>

      {/* Drill into a tenant's users */}
      <Modal
        open={drillTenant !== null}
        title={drillTenant ? `Users in ${drillTenant.name}` : ""}
        onClose={() => setDrillTenant(null)}
        footer={<Button variant="ghost" data-testid="drill-close" onClick={() => setDrillTenant(null)}>Close</Button>}
      >
        {drillError && <Banner tone="danger" data-testid="drill-error">{drillError}</Banner>}
        {drillUsers === null ? (
          <p data-testid="drill-loading">Loading…</p>
        ) : (
          <Table<AdminUser>
            columns={[
              { key: "email", header: "Email", render: (u) => u.email },
              { key: "roles", header: "Roles", render: (u) => u.roles.join(", ") },
              { key: "active", header: "Status", render: (u) => (u.active ? "active" : "deactivated") },
            ]}
            rows={drillUsers}
            rowKey={(u) => u.id}
            empty="No users in this tenant."
          />
        )}
      </Modal>

      {/* Provision a new tenant */}
      <Modal
        open={createOpen}
        title="Provision a tenant"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              data-testid="provision-submit"
              disabled={creating || tId.trim().length === 0 || tName.trim().length === 0 || adminEmail.trim().length === 0}
              onClick={submitCreate}
            >
              Provision
            </Button>
          </>
        }
      >
        <Field label="Tenant ID" htmlFor="pt-id">
          <Input id="pt-id" data-testid="pt-id" value={tId} onChange={(e) => setTId(e.target.value)} placeholder="globex" />
        </Field>
        <Field label="Tenant name" htmlFor="pt-name">
          <Input id="pt-name" data-testid="pt-name" value={tName} onChange={(e) => setTName(e.target.value)} placeholder="Globex Inc." />
        </Field>
        <Field label="Admin email" htmlFor="pt-email" hint="The first admin of the new tenant.">
          <Input id="pt-email" data-testid="pt-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@globex.com" />
        </Field>
        <p className="af-platform__hint">A temporary admin password is generated and shown once after provisioning.</p>
        {createError && <Banner tone="danger" data-testid="provision-error">{createError}</Banner>}
      </Modal>

      {/* Suspend confirm */}
      <Modal
        open={suspendTenant !== null}
        title="Suspend tenant?"
        onClose={() => setSuspendTenant(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSuspendTenant(null)}>Cancel</Button>
            <Button variant="danger" data-testid="suspend-confirm" disabled={suspending} onClick={() => confirmSuspend(suspendTenant!)}>
              Suspend
            </Button>
          </>
        }
      >
        <p>
          Suspending <strong>{suspendTenant?.name}</strong> immediately revokes all its users' sessions and blocks
          them from signing in until the tenant is reactivated. Superadmins are unaffected.
        </p>
      </Modal>
    </div>
  );
}
