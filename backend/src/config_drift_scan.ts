// S65 — Scheduled config-drift scan + auto-remediation.
// A scheduler job (S26) that periodically checks each tenant for config drift
// (S62), alerts on drift (S16/S38 style), and optionally auto-remediates by
// re-applying the active profile (S61) to bring live state back in line.

import { detectConfigDrift, type LiveConfigProbe, type ConfigDriftReport } from "./config_drift.js";
import type { TenantProfile } from "./tenant_profile.js";
import type { NotificationChannel } from "./notifications.js";
import type { JobDefinition } from "./scheduler.js";

export interface DriftScanTenant {
  tenantId: string;
  profile: TenantProfile;
  probe: LiveConfigProbe;
}

export interface ConfigDriftScanDeps {
  tenants: () => DriftScanTenant[];
  channel: NotificationChannel;
  // Optional remediation: re-apply the profile; returns true if remediated.
  remediate?: (profile: TenantProfile) => boolean;
  recipient?: string;
  now?: () => string;
}

export interface ConfigDriftScanResult {
  scanned: number;
  drifted: number;
  remediated: number;
  reports: ConfigDriftReport[];
}

export function runConfigDriftScan(deps: ConfigDriftScanDeps): ConfigDriftScanResult {
  const now = deps.now ?? (() => new Date(0).toISOString());
  const recipient = deps.recipient ?? "on-call";
  const reports: ConfigDriftReport[] = [];
  let drifted = 0;
  let remediated = 0;

  const tenants = [...deps.tenants()].sort((a, b) => a.tenantId.localeCompare(b.tenantId));
  for (const t of tenants) {
    const report = detectConfigDrift(t.profile, t.probe);
    reports.push(report);
    if (report.inSync) continue;

    drifted++;
    let remediatedNote = "";
    if (deps.remediate && deps.remediate(t.profile)) {
      remediated++;
      remediatedNote = " Auto-remediated by re-applying the profile.";
    }
    deps.channel.send({
      to: recipient,
      subject: `[CONFIG DRIFT] ${t.tenantId} diverged from profile v${report.profileVersion}`,
      body:
        `Fields drifted: ${report.findings.map((f) => f.field).join(", ")}.` + remediatedNote,
      timestamp: now(),
    });
  }

  return { scanned: reports.length, drifted, remediated, reports };
}

export function configDriftScanJob(
  id: string,
  intervalMs: number,
  deps: ConfigDriftScanDeps,
): JobDefinition {
  return {
    id,
    intervalMs,
    task: () => {
      const r = runConfigDriftScan(deps);
      return `scanned ${r.scanned} tenant(s), ${r.drifted} drifted, ${r.remediated} remediated`;
    },
  };
}
