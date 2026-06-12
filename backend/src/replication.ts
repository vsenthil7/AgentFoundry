// S40 — Data replication & failover.
// A replicated key-value store: writes go to the primary and asynchronously to
// replicas; reads hit the primary, failing over to a healthy replica if the
// primary is down. Tracks per-node health and replication lag. Deterministic and
// in-memory, behind the same KeyValueStore seam used elsewhere.

import type { KeyValueStore } from "./persistence.js";

// A simple in-memory node that can be marked down to simulate failure.
export class MemoryNode implements KeyValueStore {
  private readonly data = new Map<string, string>();
  private up = true;

  get(key: string): string | null {
    this.assertUp();
    return this.data.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.assertUp();
    this.data.set(key, value);
  }
  delete(key: string): boolean {
    this.assertUp();
    return this.data.delete(key);
  }
  keys(): string[] {
    this.assertUp();
    return [...this.data.keys()].sort();
  }

  setUp(up: boolean): void {
    this.up = up;
  }
  isUp(): boolean {
    return this.up;
  }
  private assertUp(): void {
    if (!this.up) throw new NodeDownError();
  }
  // Test/inspection helper: size regardless of up state.
  size(): number {
    return this.data.size;
  }
}

export class NodeDownError extends Error {
  constructor() {
    super("Storage node is down.");
    this.name = "NodeDownError";
  }
}

export class NoHealthyNodeError extends Error {
  constructor() {
    super("No healthy storage node available.");
    this.name = "NoHealthyNodeError";
  }
}

export interface ReplicationStatus {
  primaryUp: boolean;
  replicaCount: number;
  healthyReplicas: number;
  lag: number; // writes pending replication (should be 0 when synced)
}

export class ReplicatedStore implements KeyValueStore {
  private readonly primary: MemoryNode;
  private readonly replicas: MemoryNode[];
  private pendingLag = 0;

  constructor(primary: MemoryNode, replicas: MemoryNode[]) {
    this.primary = primary;
    this.replicas = replicas;
  }

  // Write to primary, then replicate to healthy replicas. If a replica is down,
  // the write is queued (lag increases) and applied on the next sync.
  set(key: string, value: string): void {
    this.writeNode(this.primary, () => this.primary.set(key, value));
    let replicated = true;
    for (const r of this.replicas) {
      if (r.isUp()) r.set(key, value);
      else replicated = false;
    }
    if (!replicated) this.pendingLag++;
  }

  delete(key: string): boolean {
    const existed = this.writeNode(this.primary, () => this.primary.delete(key));
    for (const r of this.replicas) {
      if (r.isUp()) r.delete(key);
    }
    return existed;
  }

  // Read from primary; on primary failure, fail over to the first healthy replica.
  get(key: string): string | null {
    if (this.primary.isUp()) return this.primary.get(key);
    const replica = this.replicas.find((r) => r.isUp());
    if (!replica) throw new NoHealthyNodeError();
    return replica.get(key);
  }

  keys(): string[] {
    if (this.primary.isUp()) return this.primary.keys();
    const replica = this.replicas.find((r) => r.isUp());
    if (!replica) throw new NoHealthyNodeError();
    return replica.keys();
  }

  // Re-sync replicas from the primary, clearing replication lag.
  sync(): void {
    if (!this.primary.isUp()) throw new NoHealthyNodeError();
    const keys = this.primary.keys();
    for (const r of this.replicas) {
      if (!r.isUp()) continue;
      for (const k of keys) {
        const v = this.primary.get(k);
        if (v !== null) r.set(k, v);
      }
    }
    this.pendingLag = 0;
  }

  status(): ReplicationStatus {
    return {
      primaryUp: this.primary.isUp(),
      replicaCount: this.replicas.length,
      healthyReplicas: this.replicas.filter((r) => r.isUp()).length,
      lag: this.pendingLag,
    };
  }

  private writeNode<T>(node: MemoryNode, op: () => T): T {
    if (!node.isUp()) throw new NoHealthyNodeError();
    return op();
  }
}
