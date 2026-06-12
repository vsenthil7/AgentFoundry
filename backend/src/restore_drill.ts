// S50 — Restore drill.
// A backup you never test isn't a backup. This job takes the latest retained
// backup (S48), restores it into a throwaway store, and verifies the restored
// contents match the backup — alerting (S16) if a drill fails. Runs on the
// scheduler (S26).

import { restoreBackup, verifyBackup, type Backup } from "./backup.js";
import { MemoryNode } from "./replication.js";
import type { KeyValueStore } from "./persistence.js";
import type { BackupVault } from "./scheduled_backup.js";
import type { NotificationChannel } from "./notifications.js";
import type { JobDefinition } from "./scheduler.js";

export interface RestoreDrillResult {
  attempted: boolean;
  passed: boolean;
  entriesRestored: number;
  reason?: string;
}

export interface RestoreDrillDeps {
  vault: BackupVault;
  channel: NotificationChannel;
  recipient?: string;
  now?: () => string;
  // Factory for the scratch store to restore into (defaults to MemoryNode).
  // Allows drilling against the real store implementation in production.
  scratchStore?: () => KeyValueStore;
}

// Restore the latest backup into a scratch store and verify integrity + contents.
export function runRestoreDrill(deps: RestoreDrillDeps): RestoreDrillResult {
  const backup = deps.vault.latest();
  if (!backup) {
    return { attempted: false, passed: false, entriesRestored: 0, reason: "no backup available" };
  }

  const result = drill(backup, deps.scratchStore ?? (() => new MemoryNode()));
  if (!result.passed) {
    const now = deps.now ?? (() => new Date(0).toISOString());
    deps.channel.send({
      to: deps.recipient ?? "on-call",
      subject: "[DR] Restore drill FAILED",
      body: `Latest backup (${backup.createdAt}) failed restore drill: ${result.reason}.`,
      timestamp: now(),
    });
  }
  return result;
}

function drill(backup: Backup, makeScratch: () => KeyValueStore): RestoreDrillResult {
  if (!verifyBackup(backup)) {
    return { attempted: true, passed: false, entriesRestored: 0, reason: "checksum mismatch" };
  }
  const scratch = makeScratch();
  let entriesRestored: number;
  try {
    entriesRestored = restoreBackup(backup, scratch);
  } catch (err) {
    return {
      attempted: true,
      passed: false,
      entriesRestored: 0,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  // Verify every entry round-tripped.
  for (const entry of backup.entries) {
    if (scratch.get(entry.key) !== entry.value) {
      return { attempted: true, passed: false, entriesRestored, reason: `mismatch at key ${entry.key}` };
    }
  }
  return { attempted: true, passed: true, entriesRestored };
}

export function restoreDrillJob(
  id: string,
  intervalMs: number,
  deps: RestoreDrillDeps,
): JobDefinition {
  return {
    id,
    intervalMs,
    task: () => {
      const result = runRestoreDrill(deps);
      if (!result.attempted) return "skipped: no backup available";
      return result.passed
        ? `restore drill passed: ${result.entriesRestored} entries verified`
        : `restore drill FAILED: ${result.reason}`;
    },
  };
}
