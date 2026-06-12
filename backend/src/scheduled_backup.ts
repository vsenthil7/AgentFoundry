// S48 — Scheduled backup.
// A scheduler job (S26) that periodically snapshots a KeyValueStore (S46) and
// retains a bounded history of backups (oldest evicted). Gives the platform
// automated, retained disaster-recovery snapshots without external cron.

import { createBackup, type Backup } from "./backup.js";
import type { KeyValueStore } from "./persistence.js";
import type { JobDefinition } from "./scheduler.js";

export interface BackupRetention {
  // Maximum number of backups to keep; older ones are evicted.
  maxBackups: number;
}

export class BackupVault {
  private readonly backups: Backup[] = [];
  private readonly retention: BackupRetention;

  constructor(retention: BackupRetention = { maxBackups: 7 }) {
    if (retention.maxBackups <= 0) {
      throw new Error("maxBackups must be positive.");
    }
    this.retention = retention;
  }

  // Store a backup, evicting the oldest if over capacity.
  add(backup: Backup): void {
    this.backups.push(backup);
    while (this.backups.length > this.retention.maxBackups) {
      this.backups.shift();
    }
  }

  // All retained backups, oldest first.
  list(): readonly Backup[] {
    return this.backups;
  }

  // The most recent backup, or null.
  latest(): Backup | null {
    return this.backups.length > 0 ? this.backups[this.backups.length - 1] : null;
  }

  count(): number {
    return this.backups.length;
  }
}

export interface ScheduledBackupDeps {
  store: KeyValueStore;
  vault: BackupVault;
  now?: () => string;
}

// Run a backup once: snapshot the store into the vault. Returns the entry count.
export function runScheduledBackup(deps: ScheduledBackupDeps): number {
  const backup = createBackup(deps.store, deps.now);
  deps.vault.add(backup);
  return backup.entries.length;
}

// Build a scheduler job that backs up the store on an interval.
export function scheduledBackupJob(
  id: string,
  intervalMs: number,
  deps: ScheduledBackupDeps,
): JobDefinition {
  return {
    id,
    intervalMs,
    task: () => {
      const entries = runScheduledBackup(deps);
      return `snapshot stored: ${entries} entries, ${deps.vault.count()} backup(s) retained`;
    },
  };
}
