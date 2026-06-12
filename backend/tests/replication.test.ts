import { describe, it, expect, beforeEach } from "vitest";
import {
  ReplicatedStore,
  MemoryNode,
  NodeDownError,
  NoHealthyNodeError,
} from "../src/replication.js";

let primary: MemoryNode;
let r1: MemoryNode;
let r2: MemoryNode;
let store: ReplicatedStore;
beforeEach(() => {
  primary = new MemoryNode();
  r1 = new MemoryNode();
  r2 = new MemoryNode();
  store = new ReplicatedStore(primary, [r1, r2]);
});

describe("MemoryNode", () => {
  it("stores and retrieves values", () => {
    primary.set("k", "v");
    expect(primary.get("k")).toBe("v");
    expect(primary.get("missing")).toBeNull();
  });
  it("deletes values", () => {
    primary.set("k", "v");
    expect(primary.delete("k")).toBe(true);
    expect(primary.delete("k")).toBe(false);
  });
  it("lists keys sorted", () => {
    primary.set("b", "1");
    primary.set("a", "2");
    expect(primary.keys()).toEqual(["a", "b"]);
  });
  it("throws when down", () => {
    primary.setUp(false);
    expect(() => primary.get("k")).toThrow(NodeDownError);
    expect(() => primary.set("k", "v")).toThrow(NodeDownError);
    expect(() => primary.delete("k")).toThrow(NodeDownError);
    expect(() => primary.keys()).toThrow(NodeDownError);
  });
  it("reports size regardless of state", () => {
    primary.set("k", "v");
    primary.setUp(false);
    expect(primary.size()).toBe(1);
  });
});

describe("replicated writes", () => {
  it("writes to primary and all healthy replicas", () => {
    store.set("k", "v");
    expect(primary.get("k")).toBe("v");
    expect(r1.get("k")).toBe("v");
    expect(r2.get("k")).toBe("v");
    expect(store.status().lag).toBe(0);
  });

  it("increments lag when a replica is down", () => {
    r2.setUp(false);
    store.set("k", "v");
    expect(store.status().lag).toBe(1);
    expect(r1.get("k")).toBe("v"); // healthy replica still written
  });

  it("deletes across primary and healthy replicas", () => {
    store.set("k", "v");
    expect(store.delete("k")).toBe(true);
    expect(primary.get("k")).toBeNull();
    expect(r1.get("k")).toBeNull();
  });

  it("throws when writing with the primary down", () => {
    primary.setUp(false);
    expect(() => store.set("k", "v")).toThrow(NoHealthyNodeError);
  });

  it("delete skips a down replica without failing", () => {
    store.set("k", "v");
    r1.setUp(false);
    expect(store.delete("k")).toBe(true);
  });
});

describe("read failover", () => {
  it("reads from primary when up", () => {
    store.set("k", "v");
    expect(store.get("k")).toBe("v");
  });

  it("fails over to a healthy replica when primary is down", () => {
    store.set("k", "v");
    primary.setUp(false);
    expect(store.get("k")).toBe("v"); // served from r1
  });

  it("throws when no node is healthy", () => {
    store.set("k", "v");
    primary.setUp(false);
    r1.setUp(false);
    r2.setUp(false);
    expect(() => store.get("k")).toThrow(NoHealthyNodeError);
  });

  it("lists keys with failover", () => {
    store.set("a", "1");
    store.set("b", "2");
    primary.setUp(false);
    expect(store.keys()).toEqual(["a", "b"]);
  });

  it("lists keys from primary when up", () => {
    store.set("a", "1");
    store.set("b", "2");
    expect(store.keys()).toEqual(["a", "b"]);
  });

  it("throws on keys() when all nodes down", () => {
    primary.setUp(false);
    r1.setUp(false);
    r2.setUp(false);
    expect(() => store.keys()).toThrow(NoHealthyNodeError);
  });
});

describe("sync", () => {
  it("re-syncs a recovered replica and clears lag", () => {
    r1.setUp(false);
    store.set("k", "v"); // lag becomes 1, r1 missed it
    expect(store.status().lag).toBe(1);
    r1.setUp(true);
    store.sync();
    expect(r1.get("k")).toBe("v");
    expect(store.status().lag).toBe(0);
  });

  it("skips replicas still down during sync", () => {
    store.set("k", "v");
    r1.setUp(false);
    store.sync(); // r1 down -> skipped, no throw
    expect(store.status().lag).toBe(0);
  });

  it("throws when syncing with primary down", () => {
    primary.setUp(false);
    expect(() => store.sync()).toThrow(NoHealthyNodeError);
  });
});

describe("status", () => {
  it("reports node health and replica counts", () => {
    r2.setUp(false);
    const s = store.status();
    expect(s.primaryUp).toBe(true);
    expect(s.replicaCount).toBe(2);
    expect(s.healthyReplicas).toBe(1);
  });
});
