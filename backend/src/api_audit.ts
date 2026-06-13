// S79 — API call audit log.
// Records every HTTP request handled by the server: who called, what path/method,
// the resulting status, a millisecond latency, and a monotonically increasing
// sequence number. This is the auditable "what was called / what came back" trail
// the operator can review later. It deliberately records metadata only — never
// request or response bodies — so secrets and PII never land in the audit log.
//
// Backed by an optional KeyValueStore (S14/S77) so the trail survives restart when
// a FileStore is supplied; otherwise it is in-memory (dev/offline).

import type { KeyValueStore } from "./persistence.js";

export interface ApiCallRecord {
  readonly seq: number;
  readonly timestamp: string; // ISO
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly latencyMs: number;
  // The authenticated principal if the request resolved one, else "anonymous".
  readonly actor: string;
  // The tenant the call was scoped to, if any.
  readonly tenantId: string | null;
}

export interface ApiAuditQuery {
  actor?: string;
  tenantId?: string;
  method?: string;
  pathPrefix?: string;
  minStatus?: number;
  maxStatus?: number;
}

export class ApiAuditLog {
  private readonly records: ApiCallRecord[] = [];
  private seq = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly store: KeyValueStore | null = null,
  ) {
    if (this.store) this.rehydrate();
  }

  private rehydrate(): void {
    const keys = this.store!.keys("apicall:");
    for (const k of keys) {
      const rec = JSON.parse(this.store!.get(k)!) as ApiCallRecord;
      this.records.push(rec);
      if (rec.seq > this.seq) this.seq = rec.seq;
    }
    this.records.sort((a, b) => a.seq - b.seq);
  }

  // Record one handled call. Returns the stored record.
  record(entry: {
    method: string;
    path: string;
    status: number;
    latencyMs: number;
    actor?: string;
    tenantId?: string | null;
  }): ApiCallRecord {
    this.seq += 1;
    const rec: ApiCallRecord = {
      seq: this.seq,
      timestamp: new Date(this.now()).toISOString(),
      method: entry.method,
      path: entry.path,
      status: entry.status,
      latencyMs: entry.latencyMs,
      actor: entry.actor ?? "anonymous",
      tenantId: entry.tenantId ?? null,
    };
    this.records.push(rec);
    if (this.store) {
      this.store.set(`apicall:${String(rec.seq).padStart(12, "0")}`, JSON.stringify(rec));
    }
    return rec;
  }

  // All records in sequence order (defensive copy).
  all(): ApiCallRecord[] {
    return [...this.records];
  }

  // Filtered query for audit review.
  query(q: ApiAuditQuery): ApiCallRecord[] {
    return this.records.filter((r) => {
      if (q.actor !== undefined && r.actor !== q.actor) return false;
      if (q.tenantId !== undefined && r.tenantId !== q.tenantId) return false;
      if (q.method !== undefined && r.method !== q.method) return false;
      if (q.pathPrefix !== undefined && !r.path.startsWith(q.pathPrefix)) return false;
      if (q.minStatus !== undefined && r.status < q.minStatus) return false;
      if (q.maxStatus !== undefined && r.status > q.maxStatus) return false;
      return true;
    });
  }

  // Count of recorded calls.
  size(): number {
    return this.records.length;
  }

  // Summary for an operator dashboard: totals and error rate.
  summary(): { total: number; errors: number; errorRate: number; lastSeq: number } {
    const total = this.records.length;
    let errors = 0;
    for (const r of this.records) {
      if (r.status >= 400) errors += 1;
    }
    const errorRate = total === 0 ? 0 : errors / total;
    return { total, errors, errorRate, lastSeq: this.seq };
  }
}
