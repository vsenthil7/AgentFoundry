import { describe, it, expect } from "vitest";
import {
  BackupVault,
  runScheduledBackup,
  scheduledBackupJob,
} from "../src/scheduled_backup.js";
import { MemoryNode } from "../src/replication.js";
import { Scheduler } from "../src/scheduler.js";
import { verifyBackup } from "../src/backup.js";

function seeded(): MemoryNode {
  const n = new MemoryNode();
  n.set("k1", "v1");
  n.set("k2", "v2");
  return n;
}

describe("BackupVault", () => {
  it("rejects a non-positive retention", () => {
    expect(() => new BackupVault({ maxBackups: 0 })).toThrow();
  });

  it("retains backups up to capacity, evicting oldest", () => {
    const vault = new BackupVault({ maxBackups: 2 });
    const store = seeded();
    let t = 0;
    runScheduledBackup({ store, vault, now: () => new Date(t).toISOString() });
    t = 1000;
    runScheduledBackup({ store, vault, now: () => new Date(t).toISOString() });
    t = 2000;
    runScheduledBackup({ store, vault, now: () => new Date(t).toISOString() });
    expect(vault.count()).toBe(2);
    // Oldest (t=0) evicted; remaining are t=1000, t=2000.
    expect(vault.list()[0].createdAt).toBe(new Date(1000).toISOString());
  });

  it("returns the latest backup", () => {
    const vault = new BackupVault();
    expect(vault.latest()).toBeNull();
    runScheduledBackup({ store: seeded(), vault });
    expect(vault.latest()?.entries).toHaveLength(2);
  });
});

describe("runScheduledBackup", () => {
  it("snapshots the store into the vault", () => {
    const vault = new BackupVault();
    const count = runScheduledBackup({ store: seeded(), vault });
    expect(count).toBe(2);
    expect(verifyBackup(vault.latest()!)).toBe(true);
  });
});

describe("scheduledBackupJob", () => {
  it("runs on a schedule and stores snapshots", async () => {
    const vault = new BackupVault();
    const store = seeded();
    const job = scheduledBackupJob("nightly-backup", 1000, { store, vault });
    let t = 0;
    const scheduler = new Scheduler(() => t);
    scheduler.schedule(job);
    t = 1000;
    const runs = await scheduler.tick();
    expect(runs[0].status).toBe("succeeded");
    expect(runs[0].detail).toContain("2 entries");
    expect(vault.count()).toBe(1);
  });
});
