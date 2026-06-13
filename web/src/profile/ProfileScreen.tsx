// S96 — Profile & security screen (self-service, every signed-in user).
// View identity (roles, tenant, session expiry); edit display name + email
// (PATCH /auth/profile); change password with current→new→confirm validation
// (POST /auth/password). Built on the design-system primitives.

import { useState } from "react";
import { AuthClient, AuthApiError, type AuthSession, type SessionUser } from "../auth/authClient.js";
import { passwordStrength } from "../auth/AuthGate.js";
import { Card, Field, Input, Button, Banner, Badge } from "../ui/components.js";

export interface ProfileScreenProps {
  client: AuthClient;
  session: AuthSession;
  // Called when the profile changes so the parent can refresh the displayed user.
  onProfileUpdated?: (user: SessionUser) => void;
}

function formatExpiry(ms: number): string {
  // Deterministic, locale-independent ISO-ish rendering (date + HH:MM UTC).
  const d = new Date(ms);
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function ProfileScreen({ client, session, onProfileUpdated }: ProfileScreenProps) {
  const u = session.user;
  const [displayName, setDisplayName] = useState(u.displayName ?? "");
  const [email, setEmail] = useState(u.email);
  const [profileMsg, setProfileMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  const saveProfile = async () => {
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const updated = await client.updateProfile(session.token, {
        displayName: displayName.trim(),
        email: email.trim(),
      });
      setProfileMsg({ tone: "success", text: "Profile updated." });
      onProfileUpdated?.(updated);
    } catch (err) {
      setProfileMsg({ tone: "danger", text: err instanceof AuthApiError ? err.message : "Network error — try again." });
    } finally {
      setSavingProfile(false);
    }
  };

  const newPwStrength = newPw.length > 0 ? passwordStrength(newPw) : null;
  const mismatch = confirmPw.length > 0 && newPw !== confirmPw;
  const canChangePw = currentPw.length > 0 && newPw.length >= 8 && newPw === confirmPw && !savingPw;

  const changePassword = async () => {
    setPwMsg(null);
    setSavingPw(true);
    try {
      const r = await client.changePassword(session.token, currentPw, newPw);
      setPwMsg({
        tone: "success",
        text:
          r.otherSessionsRevoked > 0
            ? `Password changed. ${r.otherSessionsRevoked} other session(s) were signed out.`
            : "Password changed.",
      });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwMsg({ tone: "danger", text: err instanceof AuthApiError ? err.message : "Network error — try again." });
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="af-profile" data-testid="profile-screen">
      <Card title="Your identity" className="af-profile__card">
        <dl className="af-profile__facts">
          <div>
            <dt>Email</dt>
            <dd data-testid="profile-email">{u.email}</dd>
          </div>
          <div>
            <dt>Tenant</dt>
            <dd>{u.tenantId}</dd>
          </div>
          <div>
            <dt>Roles</dt>
            <dd className="af-profile__roles">
              {u.roles.map((r) => (
                <Badge key={r} tone="brand">{r}</Badge>
              ))}
            </dd>
          </div>
          <div>
            <dt>Session expires</dt>
            <dd data-testid="profile-expiry">{formatExpiry(session.expiresAt)}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Profile" className="af-profile__card">
        <Field label="Display name" htmlFor="p-name" hint="Shown across the console; optional.">
          <Input id="p-name" data-testid="p-displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
        </Field>
        <Field label="Email" htmlFor="p-email">
          <Input id="p-email" data-testid="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {profileMsg && (
          <Banner tone={profileMsg.tone} data-testid="profile-msg" className="af-profile__msg">
            {profileMsg.text}
          </Banner>
        )}
        <Button variant="primary" disabled={savingProfile} onClick={saveProfile} data-testid="p-save">
          Save profile
        </Button>
      </Card>

      <Card title="Change password" className="af-profile__card">
        <Field label="Current password" htmlFor="p-current">
          <Input id="p-current" data-testid="p-current" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
        </Field>
        <Field
          label="New password"
          htmlFor="p-new"
          hint={newPwStrength ? <span data-testid="p-strength" className={`af-auth__strength af-auth__strength--${newPwStrength.tone}`}>{newPwStrength.label}</span> : undefined}
        >
          <Input id="p-new" data-testid="p-new" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        </Field>
        <Field
          label="Confirm new password"
          htmlFor="p-confirm"
          error={mismatch ? "Passwords do not match" : undefined}
        >
          <Input id="p-confirm" data-testid="p-confirm" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
        </Field>
        {pwMsg && (
          <Banner tone={pwMsg.tone} data-testid="pw-msg" className="af-profile__msg">
            {pwMsg.text}
          </Banner>
        )}
        <Button variant="primary" disabled={!canChangePw} onClick={changePassword} data-testid="pw-save">
          Change password
        </Button>
      </Card>
    </div>
  );
}
