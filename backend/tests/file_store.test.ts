import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../src/file_store.js";
import { Repository } from "../src/persistence.js";

describe("FileStore (S77 durable persistence)", () => {
  let dir: string;
  let p: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "af-fs-"));
    p = join(dir, "store.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("set then get", () => {
    const s = new FileStore(p);
    s.set("k", "v");
    expect(s.get("k")).toBe("v");
  });

  it("get returns null for missing key", () => {
    const s = new FileStore(p);
    expect(s.get("nope")).toBeNull();
  });

  it("delete returns true then false", () => {
    const s = new FileStore(p);
    s.set("k", "v");
    expect(s.delete("k")).toBe(true);
    expect(s.delete("k")).toBe(false);
  });

  it("keys are sorted and prefix-filterable", () => {
    const s = new FileStore(p);
    s.set("a:2", "x");
    s.set("a:1", "x");
    s.set("b:1", "x");
    expect(s.keys()).toEqual(["a:1", "a:2", "b:1"]);
    expect(s.keys("a:")).toEqual(["a:1", "a:2"]);
  });

  it("persists across restart: a new FileStore on the same path sees prior data", () => {
    const s1 = new FileStore(p);
    s1.set("agent:1", JSON.stringify({ name: "Acme" }));
    s1.set("agent:2", JSON.stringify({ name: "Beta" }));
    // Simulate a process restart by constructing a fresh instance on the same file.
    const s2 = new FileStore(p);
    expect(s2.get("agent:1")).toBe(JSON.stringify({ name: "Acme" }));
    expect(s2.keys("agent:")).toEqual(["agent:1", "agent:2"]);
    expect(s2.size()).toBe(2);
  });

  it("delete is durable across restart", () => {
    const s1 = new FileStore(p);
    s1.set("k", "v");
    s1.delete("k");
    const s2 = new FileStore(p);
    expect(s2.get("k")).toBeNull();
  });

  it("creates the backing directory if it does not exist", () => {
    const nested = join(dir, "deep", "nested", "store.json");
    const s = new FileStore(nested);
    s.set("k", "v");
    expect(existsSync(nested)).toBe(true);
    expect(new FileStore(nested).get("k")).toBe("v");
  });

  it("tolerates an empty backing file (treats as no data)", () => {
    writeFileSync(p, "", "utf8");
    const s = new FileStore(p);
    expect(s.keys()).toEqual([]);
    expect(s.size()).toBe(0);
  });

  it("tolerates a whitespace-only backing file", () => {
    writeFileSync(p, "   \n  ", "utf8");
    const s = new FileStore(p);
    expect(s.size()).toBe(0);
  });

  it("size reflects record count", () => {
    const s = new FileStore(p);
    expect(s.size()).toBe(0);
    s.set("a", "1");
    s.set("b", "2");
    expect(s.size()).toBe(2);
  });

  it("destroy removes the file and clears memory, idempotently", () => {
    const s = new FileStore(p);
    s.set("k", "v");
    expect(existsSync(p)).toBe(true);
    expect(s.destroy()).toBe(true);
    expect(existsSync(p)).toBe(false);
    expect(s.get("k")).toBeNull();
    // Second destroy is a no-op (file already gone).
    expect(s.destroy()).toBe(false);
  });

  it("works as a drop-in KeyValueStore behind Repository (same seam as InMemoryStore)", () => {
    const s = new FileStore(p);
    const repo = new Repository<{ name: string }>(s, "agent");
    repo.save("1", { name: "Acme" });
    expect(repo.load("1")).toEqual({ name: "Acme" });
    // Survives restart through the repository abstraction too.
    const repo2 = new Repository<{ name: string }>(new FileStore(p), "agent");
    expect(repo2.load("1")).toEqual({ name: "Acme" });
    expect(repo2.all()).toEqual([{ name: "Acme" }]);
    expect(repo2.remove("1")).toBe(true);
    expect(repo2.load("1")).toBeNull();
  });
});
