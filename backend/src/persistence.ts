// S14 — Persistence & tamper-evident audit ledger.
// A storage interface (so the in-memory store can be swapped for a DB) and a
// hash-chained audit log: each entry's hash includes the prior entry's hash, so
// any tampering anywhere in the chain is detectable.

import { createHash } from "node:crypto";

// ---- Persistence interface ----

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): boolean;
  keys(prefix?: string): string[];
}

// Default in-memory implementation. A DB-backed store implements the same shape.
export class InMemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  get(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  delete(key: string): boolean {
    return this.map.delete(key);
  }
  keys(prefix?: string): string[] {
    const all = [...this.map.keys()].sort();
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }
}

// Generic serializable repository over a KeyValueStore.
export class Repository<T> {
  constructor(
    private readonly store: KeyValueStore,
    private readonly namespace: string,
  ) {}

  private k(id: string): string {
    return `${this.namespace}:${id}`;
  }

  save(id: string, value: T): void {
    this.store.set(this.k(id), JSON.stringify(value));
  }
  load(id: string): T | null {
    const raw = this.store.get(this.k(id));
    return raw === null ? null : (JSON.parse(raw) as T);
  }
  remove(id: string): boolean {
    return this.store.delete(this.k(id));
  }
  all(): T[] {
    return this.store
      .keys(`${this.namespace}:`)
      .map((k) => JSON.parse(this.store.get(k)!) as T);
  }
}

// ---- Tamper-evident audit ledger ----

export interface AuditEntry {
  readonly seq: number;
  readonly timestamp: string;
  readonly actor: string;
  readonly action: string;
  readonly subject: string;
  readonly detail: string;
  readonly prevHash: string;
  readonly hash: string;
}

const GENESIS = "0".repeat(64);

function computeHash(
  e: Omit<AuditEntry, "hash">,
): string {
  const payload = `${e.seq}|${e.timestamp}|${e.actor}|${e.action}|${e.subject}|${e.detail}|${e.prevHash}`;
  return createHash("sha256").update(payload).digest("hex");
}

export interface VerifyResult {
  valid: boolean;
  brokenAt: number | null; // seq of first broken entry, or null
}

export class AuditLedger {
  private readonly entries: AuditEntry[] = [];
  private readonly now: () => string;

  constructor(now: () => string = () => new Date(0).toISOString()) {
    this.now = now;
  }

  append(
    record: { actor: string; action: string; subject: string; detail?: string },
  ): AuditEntry {
    const prevHash = this.entries.length
      ? this.entries[this.entries.length - 1].hash
      : GENESIS;
    const base: Omit<AuditEntry, "hash"> = {
      seq: this.entries.length,
      timestamp: this.now(),
      actor: record.actor,
      action: record.action,
      subject: record.subject,
      detail: record.detail ?? "",
      prevHash,
    };
    const entry: AuditEntry = Object.freeze({ ...base, hash: computeHash(base) });
    this.entries.push(entry);
    return entry;
  }

  list(): readonly AuditEntry[] {
    return this.entries;
  }

  size(): number {
    return this.entries.length;
  }

  // Verify the entire chain: each hash recomputes, and each links to the prior.
  verify(): VerifyResult {
    return AuditLedger.verifyChain(this.entries);
  }

  // Detect tampering against a provided (untrusted) copy of entries.
  static verifyChain(entries: AuditEntry[]): VerifyResult {
    let prev = GENESIS;
    for (const e of entries) {
      const recomputed = computeHash({
        seq: e.seq,
        timestamp: e.timestamp,
        actor: e.actor,
        action: e.action,
        subject: e.subject,
        detail: e.detail,
        prevHash: e.prevHash,
      });
      if (e.prevHash !== prev || e.hash !== recomputed) {
        return { valid: false, brokenAt: e.seq };
      }
      prev = e.hash;
    }
    return { valid: true, brokenAt: null };
  }
}
