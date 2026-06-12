// S46 — Backup & restore.
// Snapshots a KeyValueStore's full contents into a serializable, checksummed
// backup and restores it into a (fresh) store. Verifies integrity on restore so
// a corrupted backup is rejected. Works with any KeyValueStore (incl. the
// ReplicatedStore from S40), giving the platform a DR primitive.

import { createHash } from "node:crypto";
import type { KeyValueStore } from "./persistence.js";

export interface BackupEntry {
  key: string;
  value: string;
}

export interface Backup {
  version: 1;
  createdAt: string;
  entries: BackupEntry[];
  checksum: string; // SHA-256 over the serialized entries
}

export class BackupIntegrityError extends Error {
  constructor() {
    super("Backup checksum mismatch: the backup is corrupted or tampered.");
    this.name = "BackupIntegrityError";
  }
}

export class RestoreTargetNotEmptyError extends Error {
  constructor() {
    super("Restore target store is not empty; refusing to overwrite.");
    this.name = "RestoreTargetNotEmptyError";
  }
}

function checksum(entries: BackupEntry[]): string {
  // Deterministic: entries are sorted by key before hashing.
  const canonical = JSON.stringify(
    [...entries].sort((a, b) => a.key.localeCompare(b.key)),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

// Create a backup snapshot of a store.
export function createBackup(
  store: KeyValueStore,
  now: () => string = () => new Date(0).toISOString(),
): Backup {
  const entries: BackupEntry[] = store
    .keys()
    .sort()
    .map((key) => ({ key, value: store.get(key) ?? "" }));
  return {
    version: 1,
    createdAt: now(),
    entries,
    checksum: checksum(entries),
  };
}

// Verify a backup's integrity without restoring.
export function verifyBackup(backup: Backup): boolean {
  return backup.checksum === checksum(backup.entries);
}

// Restore a backup into a target store. By default refuses a non-empty target.
export function restoreBackup(
  backup: Backup,
  target: KeyValueStore,
  opts: { allowOverwrite?: boolean } = {},
): number {
  if (!verifyBackup(backup)) throw new BackupIntegrityError();
  if (!opts.allowOverwrite && target.keys().length > 0) {
    throw new RestoreTargetNotEmptyError();
  }
  for (const { key, value } of backup.entries) {
    target.set(key, value);
  }
  return backup.entries.length;
}

// Serialize / deserialize a backup for off-box storage.
export function serializeBackup(backup: Backup): string {
  return JSON.stringify(backup);
}

export function deserializeBackup(serialized: string): Backup {
  const parsed = JSON.parse(serialized) as Backup;
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new BackupIntegrityError();
  }
  return parsed;
}
