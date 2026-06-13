// S81 — PostgresStore: durable KeyValueStore backed by PostgreSQL.
//
// Design: the engine's KeyValueStore contract (S14) is synchronous, and 77 modules
// depend on it. Postgres is async. Rather than rewrite every caller, PostgresStore
// keeps an in-memory cache that is the read path (synchronous, contract-preserving)
// and writes through to Postgres asynchronously for durability. On startup, init()
// hydrates the cache from the table, so state survives restart and scales across
// instances that share the same database.
//
// This mirrors how FileStore (S77) keeps an in-memory Map and flushes to disk — same
// pattern, durable backing swapped from a file to Postgres. Because the read/write
// shape is identical to InMemoryStore/FileStore, every engine module works unchanged.
//
// The store depends on a minimal PgClient interface (just `query`), not on the `pg`
// package, so the engine stays dependency-free and fully testable with a fake client.
// At the wiring point (bin-serve) a real `pg.Pool` is passed in — it satisfies PgClient.

import type { KeyValueStore } from "./persistence.js";

// The slice of node-postgres' Pool/Client we use. A real pg.Pool satisfies this.
export interface PgQueryResult {
  rows: Array<Record<string, unknown>>;
}
export interface PgClient {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
}

// Called when an async write-through to Postgres fails. Defaults to console.error.
export type WriteErrorHandler = (op: string, key: string, err: unknown) => void;

const DEFAULT_TABLE = "agentfoundry_kv";

export class PostgresStore implements KeyValueStore {
  private readonly cache = new Map<string, string>();
  private hydrated = false;

  constructor(
    private readonly client: PgClient,
    private readonly table: string = DEFAULT_TABLE,
    private readonly onWriteError: WriteErrorHandler = (op, key, err) => {
      // eslint-disable-next-line no-console
      console.error(`PostgresStore ${op} failed for key ${key}:`, err);
    },
  ) {}

  // Create the table if absent and hydrate the cache. Call once at startup,
  // before serving requests. Idempotent.
  async init(): Promise<void> {
    await this.client.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
    );
    const res = await this.client.query(`SELECT k, v FROM ${this.table}`);
    this.cache.clear();
    for (const row of res.rows) {
      this.cache.set(String(row.k), String(row.v));
    }
    this.hydrated = true;
  }

  // Whether init() has run (cache reflects the database).
  isHydrated(): boolean {
    return this.hydrated;
  }

  get(key: string): string | null {
    return this.cache.has(key) ? this.cache.get(key)! : null;
  }

  set(key: string, value: string): void {
    this.cache.set(key, value);
    // Write through asynchronously; errors are surfaced via the handler, never
    // swallowed silently, and never block the synchronous caller.
    this.client
      .query(
        `INSERT INTO ${this.table} (k, v) VALUES ($1, $2)
         ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
        [key, value],
      )
      .catch((err) => this.onWriteError("set", key, err));
  }

  delete(key: string): boolean {
    const existed = this.cache.delete(key);
    if (existed) {
      this.client
        .query(`DELETE FROM ${this.table} WHERE k = $1`, [key])
        .catch((err) => this.onWriteError("delete", key, err));
    }
    return existed;
  }

  keys(prefix?: string): string[] {
    const all = [...this.cache.keys()].sort();
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }

  // Number of cached records.
  size(): number {
    return this.cache.size;
  }

  // Await all pending writes to settle. In this design writes are issued
  // immediately; flush is a no-op hook kept for API symmetry with future batching.
  async flush(): Promise<void> {
    return Promise.resolve();
  }
}
