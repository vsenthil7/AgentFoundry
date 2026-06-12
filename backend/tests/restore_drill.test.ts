import { describe, it, expect } from "vitest";
import { runRestoreDrill, restoreDrillJob } from "../src/restore_drill.js";
import { BackupVault, runScheduledBackup } from "../src/scheduled_backup.js";
import { InMemoryChannel } from "../src/notifications.js";
import { MemoryNode } from "../src/replication.js";
import { Scheduler } from "../src/scheduler.js";

function vaultWithBackup(): BackupVault {
  const vault = new BackupVault();
  const store = new MemoryNode();
  store.set("agent:a1", "deployed");
  store.set("policy:p", "v1");
  runScheduledBackup({ store, vault });
  return vault;
}

describe("runRestoreDrill", () => {
  it("passes when the latest backup restores cleanly", () => {
    const channel = new InMemoryChannel();
    const result = runRestoreDrill({ vault: vaultWithBackup(), channel });
    expect(result.passed).toBe(true);
    expect(result.entriesRestored).toBe(2);
    expect(channel.sent).toHaveLength(0);
  });

  it("skips and reports when no backup exists", () => {
    const channel = new InMemoryChannel();
    const result = runRestoreDrill({ vault: new BackupVault(), channel });
    expect(result.attempted).toBe(false);
    expect(result.reason).toContain("no backup");
  });

  it("fails and alerts on a corrupted backup", () => {
    const vault = vaultWithBackup();
    // Corrupt the retained backup's checksum target.
    (vault.latest()!.entries[0] as { value: string }).value = "TAMPERED";
    const channel = new InMemoryChannel();
    const result = runRestoreDrill({ vault, channel });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("checksum");
    expect(channel.for("on-call")).toHaveLength(1);
    expect(channel.for("on-call")[0].subject).toContain("FAILED");
  });

  it("routes failure alerts to a custom recipient", () => {
    const vault = vaultWithBackup();
    (vault.latest()!.entries[0] as { value: string }).value = "X";
    const channel = new InMemoryChannel();
    runRestoreDrill({ vault, channel, recipient: "sre", now: () => "2026-06-09T11:00:00.000Z" });
    expect(channel.for("sre")).toHaveLength(1);
  });

  it("fails when the scratch store rejects the restore", () => {
    const channel = new InMemoryChannel();
    // A scratch store whose set() throws an Error (e.g. write-protected target).
    const faulty = {
      keys: () => [],
      get: () => null,
      set: () => { throw new Error("disk full"); },
      delete: () => false,
    };
    const result = runRestoreDrill({ vault: vaultWithBackup(), channel, scratchStore: () => faulty });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("disk full");
  });

  it("handles a non-Error throw from the scratch store", () => {
    const channel = new InMemoryChannel();
    const faulty = {
      keys: () => [],
      get: () => null,
      set: () => { throw "string failure"; },
      delete: () => false,
    };
    const result = runRestoreDrill({ vault: vaultWithBackup(), channel, scratchStore: () => faulty });
    expect(result.reason).toBe("string failure");
  });

  it("fails when restored content does not match the backup", () => {
    const channel = new InMemoryChannel();
    // A scratch store that accepts writes but returns wrong values on read.
    const lying = {
      keys: () => [],
      get: () => "WRONG",
      set: () => {},
      delete: () => false,
    };
    const result = runRestoreDrill({ vault: vaultWithBackup(), channel, scratchStore: () => lying });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("mismatch at key");
  });
});

describe("restoreDrillJob", () => {
  it("reports a passing drill via the scheduler", async () => {
    const job = restoreDrillJob("restore-drill", 1000, { vault: vaultWithBackup(), channel: new InMemoryChannel() });
    let t = 0;
    const scheduler = new Scheduler(() => t);
    scheduler.schedule(job);
    t = 1000;
    const runs = await scheduler.tick();
    expect(runs[0].detail).toContain("passed");
  });

  it("reports skipped when no backup is available", async () => {
    const job = restoreDrillJob("restore-drill", 1000, { vault: new BackupVault(), channel: new InMemoryChannel() });
    let t = 0;
    const scheduler = new Scheduler(() => t);
    scheduler.schedule(job);
    t = 1000;
    const runs = await scheduler.tick();
    expect(runs[0].detail).toContain("skipped");
  });

  it("reports failure detail via the scheduler", async () => {
    const vault = vaultWithBackup();
    (vault.latest()!.entries[0] as { value: string }).value = "X";
    const job = restoreDrillJob("restore-drill", 1000, { vault, channel: new InMemoryChannel() });
    let t = 0;
    const scheduler = new Scheduler(() => t);
    scheduler.schedule(job);
    t = 1000;
    const runs = await scheduler.tick();
    expect(runs[0].detail).toContain("FAILED");
  });
});
