import { describe, it, expect } from "vitest";
import {
  createBackup,
  verifyBackup,
  restoreBackup,
  serializeBackup,
  deserializeBackup,
  BackupIntegrityError,
  RestoreTargetNotEmptyError,
} from "../src/backup.js";
import { MemoryNode } from "../src/replication.js";

function seeded(): MemoryNode {
  const n = new MemoryNode();
  n.set("agent:a1", "deployed");
  n.set("agent:a2", "draft");
  n.set("policy:baseline", "v1");
  return n;
}

describe("createBackup", () => {
  it("snapshots all entries with a checksum", () => {
    const b = createBackup(seeded());
    expect(b.entries).toHaveLength(3);
    expect(b.version).toBe(1);
    expect(b.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses an injected clock", () => {
    const b = createBackup(seeded(), () => "2026-06-08T15:00:00.000Z");
    expect(b.createdAt).toBe("2026-06-08T15:00:00.000Z");
  });

  it("snapshots an empty store", () => {
    const b = createBackup(new MemoryNode());
    expect(b.entries).toHaveLength(0);
    expect(verifyBackup(b)).toBe(true);
  });

  it("handles a key whose value is absent (defensive null fallback)", () => {
    // A store that lists a key but returns null for it (e.g. a race or a
    // lazily-evicted entry). Backup records it as an empty string.
    const flaky = {
      keys: () => ["ghost"],
      get: () => null,
      set: () => {},
      delete: () => false,
    };
    const b = createBackup(flaky);
    expect(b.entries).toEqual([{ key: "ghost", value: "" }]);
  });
});

describe("verifyBackup", () => {
  it("validates an intact backup", () => {
    expect(verifyBackup(createBackup(seeded()))).toBe(true);
  });

  it("detects a tampered backup", () => {
    const b = createBackup(seeded());
    b.entries[0].value = "TAMPERED";
    expect(verifyBackup(b)).toBe(false);
  });
});

describe("restoreBackup", () => {
  it("restores into an empty store", () => {
    const b = createBackup(seeded());
    const target = new MemoryNode();
    const count = restoreBackup(b, target);
    expect(count).toBe(3);
    expect(target.get("agent:a1")).toBe("deployed");
  });

  it("refuses a non-empty target by default", () => {
    const b = createBackup(seeded());
    const target = new MemoryNode();
    target.set("existing", "data");
    expect(() => restoreBackup(b, target)).toThrow(RestoreTargetNotEmptyError);
  });

  it("overwrites when allowed", () => {
    const b = createBackup(seeded());
    const target = new MemoryNode();
    target.set("existing", "data");
    expect(restoreBackup(b, target, { allowOverwrite: true })).toBe(3);
    expect(target.get("agent:a1")).toBe("deployed");
  });

  it("rejects a corrupted backup", () => {
    const b = createBackup(seeded());
    b.entries[0].value = "TAMPERED";
    expect(() => restoreBackup(b, new MemoryNode())).toThrow(BackupIntegrityError);
  });

  it("round-trips a store through backup + restore", () => {
    const source = seeded();
    const restored = new MemoryNode();
    restoreBackup(createBackup(source), restored);
    expect(restored.keys()).toEqual(source.keys());
  });
});

describe("serialization", () => {
  it("round-trips a backup through serialize/deserialize", () => {
    const b = createBackup(seeded());
    const restored = deserializeBackup(serializeBackup(b));
    expect(verifyBackup(restored)).toBe(true);
    expect(restored.entries).toHaveLength(3);
  });

  it("rejects a malformed serialized backup", () => {
    expect(() => deserializeBackup('{"version":2}')).toThrow(BackupIntegrityError);
  });

  it("rejects serialized data with no entries array", () => {
    expect(() => deserializeBackup('{"version":1}')).toThrow(BackupIntegrityError);
  });
});
