import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryStore,
  Repository,
  AuditLedger,
  type AuditEntry,
} from "../src/persistence.js";

describe("InMemoryStore", () => {
  let s: InMemoryStore;
  beforeEach(() => (s = new InMemoryStore()));

  it("get returns null for missing key", () => {
    expect(s.get("nope")).toBeNull();
  });
  it("set then get", () => {
    s.set("k", "v");
    expect(s.get("k")).toBe("v");
  });
  it("delete returns true then false", () => {
    s.set("k", "v");
    expect(s.delete("k")).toBe(true);
    expect(s.delete("k")).toBe(false);
  });
  it("keys are sorted and prefix-filterable", () => {
    s.set("a:2", "x");
    s.set("a:1", "x");
    s.set("b:1", "x");
    expect(s.keys()).toEqual(["a:1", "a:2", "b:1"]);
    expect(s.keys("a:")).toEqual(["a:1", "a:2"]);
  });
});

describe("Repository", () => {
  interface Thing {
    id: string;
    n: number;
  }
  let repo: Repository<Thing>;
  beforeEach(() => (repo = new Repository<Thing>(new InMemoryStore(), "thing")));

  it("save and load round-trip", () => {
    repo.save("1", { id: "1", n: 42 });
    expect(repo.load("1")).toEqual({ id: "1", n: 42 });
  });
  it("load returns null when absent", () => {
    expect(repo.load("ghost")).toBeNull();
  });
  it("remove deletes", () => {
    repo.save("1", { id: "1", n: 1 });
    expect(repo.remove("1")).toBe(true);
    expect(repo.load("1")).toBeNull();
  });
  it("all lists every saved record", () => {
    repo.save("1", { id: "1", n: 1 });
    repo.save("2", { id: "2", n: 2 });
    expect(repo.all()).toHaveLength(2);
  });
});

describe("AuditLedger — chaining", () => {
  let ledger: AuditLedger;
  beforeEach(() => (ledger = new AuditLedger()));

  it("first entry links to genesis", () => {
    const e = ledger.append({ actor: "a", action: "approve", subject: "agent-1" });
    expect(e.seq).toBe(0);
    expect(e.prevHash).toBe("0".repeat(64));
    expect(e.hash).toHaveLength(64);
  });

  it("each entry links to the prior hash", () => {
    const e0 = ledger.append({ actor: "a", action: "create", subject: "x" });
    const e1 = ledger.append({ actor: "b", action: "approve", subject: "x" });
    expect(e1.prevHash).toBe(e0.hash);
    expect(ledger.size()).toBe(2);
  });

  it("verifies an untampered chain", () => {
    ledger.append({ actor: "a", action: "create", subject: "x" });
    ledger.append({ actor: "b", action: "approve", subject: "x", detail: "ok" });
    ledger.append({ actor: "c", action: "deploy", subject: "x" });
    expect(ledger.verify()).toEqual({ valid: true, brokenAt: null });
  });

  it("freezes entries", () => {
    const e = ledger.append({ actor: "a", action: "create", subject: "x" });
    expect(Object.isFrozen(e)).toBe(true);
  });

  it("verifies an empty ledger as valid", () => {
    expect(ledger.verify()).toEqual({ valid: true, brokenAt: null });
  });
});

describe("AuditLedger — tamper detection", () => {
  function buildEntries(): AuditEntry[] {
    const l = new AuditLedger();
    l.append({ actor: "a", action: "create", subject: "x" });
    l.append({ actor: "b", action: "approve", subject: "x", detail: "score 0.92" });
    l.append({ actor: "c", action: "deploy", subject: "x" });
    return [...l.list()];
  }

  it("detects a mutated field via verifyChain", () => {
    const entries = buildEntries();
    // Tamper: change an approver detail without recomputing the hash.
    const tampered = entries.map((e, i) =>
      i === 1 ? { ...e, detail: "score 0.99" } : e,
    );
    const result = AuditLedger.verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("detects a broken link (reordered/removed entry)", () => {
    const entries = buildEntries();
    const broken = [entries[0], entries[2]]; // drop entry 1
    const result = AuditLedger.verifyChain(broken);
    expect(result.valid).toBe(false);
  });

  it("accepts an intact exported chain", () => {
    const entries = buildEntries();
    expect(AuditLedger.verifyChain(entries)).toEqual({ valid: true, brokenAt: null });
  });

  it("detects a forged hash", () => {
    const entries = buildEntries();
    const forged = entries.map((e, i) =>
      i === 2 ? { ...e, hash: "deadbeef".repeat(8) } : e,
    );
    expect(AuditLedger.verifyChain(forged).valid).toBe(false);
  });
});
