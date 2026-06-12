// S77 - Durable file-backed persistence.
// FileStore implements the same KeyValueStore contract as InMemoryStore (S14),
// so every engine module that depends on the storage seam gains durability with
// zero code change. State survives process restart. Writes are atomic
// (write-temp-then-rename) so a crash mid-write never corrupts the store.

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { KeyValueStore } from "./persistence.js";

export class FileStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  constructor(private readonly path: string) {
    const dir = dirname(this.path);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    if (existsSync(this.path)) {
      this.load();
    }
  }

  private load(): void {
    const raw = readFileSync(this.path, "utf8");
    if (raw.trim() === "") {
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [k, v] of Object.entries(parsed)) {
      this.map.set(k, v);
    }
  }

  private flush(): void {
    const obj: Record<string, string> = {};
    for (const [k, v] of this.map) {
      obj[k] = v;
    }
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(obj), "utf8");
    renameSync(tmp, this.path);
  }

  get(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
    this.flush();
  }

  delete(key: string): boolean {
    const existed = this.map.delete(key);
    if (existed) {
      this.flush();
    }
    return existed;
  }

  keys(prefix?: string): string[] {
    const all = [...this.map.keys()].sort();
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }

  size(): number {
    return this.map.size;
  }

  destroy(): boolean {
    this.map.clear();
    if (existsSync(this.path)) {
      unlinkSync(this.path);
      return true;
    }
    return false;
  }
}
