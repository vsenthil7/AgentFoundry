import { describe, it, expect, beforeEach } from "vitest";
import { PostgresStore, type PgClient, type PgQueryResult } from "../src/postgres_store.js";

// A fake Postgres that behaves like a real table for our query shapes.
// It understands CREATE TABLE, SELECT k,v, INSERT ... ON CONFLICT, and DELETE.
class FakePg implements PgClient {
  table = new Map<string, string>();
  queries: string[] = [];
  failNext = false;

  async query(text: string, values: unknown[] = []): Promise<PgQueryResult> {
    this.queries.push(text.trim().split("\n")[0].trim());
    if (this.failNext) {
      this.failNext = false;
      throw new Error("simulated db error");
    }
    if (text.includes("CREATE TABLE")) {
      return { rows: [] };
    }
    if (text.startsWith("SELECT")) {
      return { rows: [...this.table.entries()].map(([k, v]) => ({ k, v })) };
    }
    if (text.includes("INSERT")) {
      this.table.set(String(values[0]), String(values[1]));
      return { rows: [] };
    }
    if (text.startsWith("DELETE")) {
      this.table.delete(String(values[0]));
      return { rows: [] };
    }
    return { rows: [] };
  }
}

// Allow async write-through .catch handlers to run.
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("PostgresStore (S81)", () => {
  let pg: FakePg;
  beforeEach(() => {
    pg = new FakePg();
  });

  it("init creates the table and hydrates an empty cache", async () => {
    const store = new PostgresStore(pg);
    expect(store.isHydrated()).toBe(false);
    await store.init();
    expect(store.isHydrated()).toBe(true);
    expect(store.size()).toBe(0);
    expect(pg.queries[0]).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("set writes through to the database and is readable from cache", async () => {
    const store = new PostgresStore(pg);
    await store.init();
    store.set("agent:1", "alpha");
    expect(store.get("agent:1")).toBe("alpha");
    await tick();
    expect(pg.table.get("agent:1")).toBe("alpha"); // written through
  });

  it("get returns null for a missing key", async () => {
    const store = new PostgresStore(pg);
    await store.init();
    expect(store.get("nope")).toBeNull();
  });

  it("delete removes from cache and database, returning prior existence", async () => {
    const store = new PostgresStore(pg);
    await store.init();
    store.set("k", "v");
    await tick();
    expect(store.delete("k")).toBe(true);
    await tick();
    expect(store.get("k")).toBeNull();
    expect(pg.table.has("k")).toBe(false);
    // Deleting a missing key returns false and issues no DB call.
    const before = pg.queries.length;
    expect(store.delete("k")).toBe(false);
    expect(pg.queries.length).toBe(before);
  });

  it("keys are sorted and prefix-filterable", async () => {
    const store = new PostgresStore(pg);
    await store.init();
    store.set("a:2", "x");
    store.set("a:1", "x");
    store.set("b:1", "x");
    expect(store.keys()).toEqual(["a:1", "a:2", "b:1"]);
    expect(store.keys("a:")).toEqual(["a:1", "a:2"]);
  });

  it("hydrates prior data on restart (new store, same database)", async () => {
    const store1 = new PostgresStore(pg);
    await store1.init();
    store1.set("agent:1", JSON.stringify({ name: "Acme" }));
    store1.set("agent:2", JSON.stringify({ name: "Beta" }));
    await tick();

    // Restart: a fresh store on the same backing pg hydrates from the table.
    const store2 = new PostgresStore(pg);
    await store2.init();
    expect(store2.size()).toBe(2);
    expect(store2.get("agent:1")).toBe(JSON.stringify({ name: "Acme" }));
    expect(store2.keys("agent:")).toEqual(["agent:1", "agent:2"]);
  });

  it("uses a custom table name when provided", async () => {
    const store = new PostgresStore(pg, "custom_kv");
    await store.init();
    expect(pg.queries[0]).toContain("custom_kv");
  });

  it("invokes the write-error handler when a set write-through fails", async () => {
    const errors: Array<{ op: string; key: string }> = [];
    const store = new PostgresStore(pg, "agentfoundry_kv", (op, key) => errors.push({ op, key }));
    await store.init();
    pg.failNext = true; // the next INSERT throws
    store.set("k", "v");
    await tick();
    expect(errors).toEqual([{ op: "set", key: "k" }]);
    // Cache still updated (read path unaffected by the durable-write failure).
    expect(store.get("k")).toBe("v");
  });

  it("invokes the write-error handler when a delete write-through fails", async () => {
    const errors: Array<{ op: string; key: string }> = [];
    const store = new PostgresStore(pg, "agentfoundry_kv", (op, key) => errors.push({ op, key }));
    await store.init();
    store.set("k", "v");
    await tick();
    pg.failNext = true; // the DELETE throws
    expect(store.delete("k")).toBe(true);
    await tick();
    expect(errors).toEqual([{ op: "delete", key: "k" }]);
  });

  it("default write-error handler does not throw (smoke)", async () => {
    const store = new PostgresStore(pg); // default console.error handler
    await store.init();
    pg.failNext = true;
    expect(() => store.set("k", "v")).not.toThrow();
    await tick();
  });

  it("flush resolves (API symmetry hook)", async () => {
    const store = new PostgresStore(pg);
    await store.init();
    await expect(store.flush()).resolves.toBeUndefined();
  });
});
