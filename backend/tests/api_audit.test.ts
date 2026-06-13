import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiAuditLog } from "../src/api_audit.js";
import { FileStore } from "../src/file_store.js";

let t: number;
const clock = () => t;

describe("ApiAuditLog (S79)", () => {
  beforeEach(() => {
    t = 1_700_000_000_000;
  });

  it("records a call with an incrementing seq and ISO timestamp", () => {
    const log = new ApiAuditLog(clock);
    const r = log.record({ method: "POST", path: "/auth/login", status: 200, latencyMs: 12, actor: "u@acme.com", tenantId: "acme" });
    expect(r.seq).toBe(1);
    expect(r.status).toBe(200);
    expect(r.actor).toBe("u@acme.com");
    expect(r.tenantId).toBe("acme");
    expect(r.timestamp).toBe(new Date(t).toISOString());
  });

  it("defaults actor to anonymous and tenantId to null", () => {
    const log = new ApiAuditLog(clock);
    const r = log.record({ method: "GET", path: "/health", status: 200, latencyMs: 1 });
    expect(r.actor).toBe("anonymous");
    expect(r.tenantId).toBeNull();
  });

  it("all() returns records in sequence order as a defensive copy", () => {
    const log = new ApiAuditLog(clock);
    log.record({ method: "GET", path: "/a", status: 200, latencyMs: 1 });
    log.record({ method: "GET", path: "/b", status: 404, latencyMs: 2 });
    const a = log.all();
    expect(a.map((r) => r.seq)).toEqual([1, 2]);
    a.pop(); // mutate the copy
    expect(log.size()).toBe(2); // internal state unaffected
  });

  it("query filters by actor, tenant, method, pathPrefix and status range", () => {
    const log = new ApiAuditLog(clock);
    log.record({ method: "GET", path: "/agents", status: 200, latencyMs: 1, actor: "a", tenantId: "t1" });
    log.record({ method: "POST", path: "/agents", status: 201, latencyMs: 1, actor: "a", tenantId: "t1" });
    log.record({ method: "GET", path: "/admin/users", status: 403, latencyMs: 1, actor: "b", tenantId: "t2" });

    expect(log.query({ actor: "a" }).length).toBe(2);
    expect(log.query({ tenantId: "t2" }).length).toBe(1);
    expect(log.query({ method: "POST" }).length).toBe(1);
    expect(log.query({ pathPrefix: "/admin" }).length).toBe(1);
    expect(log.query({ minStatus: 400 }).length).toBe(1);
    expect(log.query({ maxStatus: 299 }).length).toBe(2);
    expect(log.query({ minStatus: 200, maxStatus: 299 }).length).toBe(2);
    expect(log.query({ minStatus: 201, maxStatus: 299 }).length).toBe(1);
    expect(log.query({}).length).toBe(3);
  });

  it("summary reports total, errors, error rate and last seq", () => {
    const log = new ApiAuditLog(clock);
    expect(log.summary()).toEqual({ total: 0, errors: 0, errorRate: 0, lastSeq: 0 });
    log.record({ method: "GET", path: "/a", status: 200, latencyMs: 1 });
    log.record({ method: "GET", path: "/b", status: 500, latencyMs: 1 });
    const s = log.summary();
    expect(s.total).toBe(2);
    expect(s.errors).toBe(1);
    expect(s.errorRate).toBe(0.5);
    expect(s.lastSeq).toBe(2);
  });

  it("defaults to the system clock when none is injected", () => {
    const log = new ApiAuditLog();
    const before = Date.now();
    const r = log.record({ method: "GET", path: "/x", status: 200, latencyMs: 1 });
    expect(new Date(r.timestamp).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("persists across restart when backed by a FileStore", () => {
    const dir = mkdtempSync(join(tmpdir(), "af-apiaudit-"));
    const p = join(dir, "audit.json");
    const log1 = new ApiAuditLog(clock, new FileStore(p));
    log1.record({ method: "POST", path: "/auth/login", status: 200, latencyMs: 5, actor: "u" });
    log1.record({ method: "GET", path: "/agents", status: 200, latencyMs: 3, actor: "u" });

    // Restart: a fresh log on the same store rehydrates the trail and continues seq.
    const log2 = new ApiAuditLog(clock, new FileStore(p));
    expect(log2.size()).toBe(2);
    expect(log2.all().map((r) => r.seq)).toEqual([1, 2]);
    const r3 = log2.record({ method: "GET", path: "/health", status: 200, latencyMs: 1 });
    expect(r3.seq).toBe(3);

    rmSync(dir, { recursive: true, force: true });
  });
});
