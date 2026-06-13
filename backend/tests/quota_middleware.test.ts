import { describe, it, expect, beforeEach } from "vitest";
import { quotaMiddleware, resourceForRequest } from "../src/quota_middleware.js";
import { QuotaManager } from "../src/ratelimit.js";
import type { ApiRequest, ApiResponse } from "../src/api.js";

function req(over: Partial<ApiRequest> = {}): ApiRequest {
  return { method: "POST", path: "/agents", headers: {}, query: {}, params: {}, body: null, tenantId: "acme", ...over };
}

const ok = async (): Promise<ApiResponse> => ({ status: 201, body: { created: true } });
const fail = async (): Promise<ApiResponse> => ({ status: 400, body: { error: "bad" } });

describe("resourceForRequest", () => {
  it("maps POST /agents to agents", () => {
    expect(resourceForRequest(req({ method: "POST", path: "/agents" }))).toBe("agents");
  });
  it("maps deploy and evaluate sub-routes", () => {
    expect(resourceForRequest(req({ path: "/agents/abc/deploy" }))).toBe("deployments");
    expect(resourceForRequest(req({ path: "/agents/abc/evaluate" }))).toBe("eval_runs");
  });
  it("returns null for unmetered routes", () => {
    expect(resourceForRequest(req({ method: "GET", path: "/agents" }))).toBeNull();
    expect(resourceForRequest(req({ method: "POST", path: "/auth/login" }))).toBeNull();
  });
});

describe("quotaMiddleware (S88)", () => {
  let mgr: QuotaManager;
  beforeEach(() => {
    mgr = new QuotaManager(() => 1_700_000_000_000);
  });

  it("passes through unmetered routes without recording", async () => {
    const mw = quotaMiddleware({ manager: mgr });
    const res = await mw(req({ method: "GET", path: "/agents" }), ok);
    expect(res.status).toBe(201);
    expect(mgr.status("acme", "agents").used).toBe(0);
  });

  it("passes through when there is no tenant context", async () => {
    const mw = quotaMiddleware({ manager: mgr });
    const res = await mw(req({ tenantId: undefined }), ok);
    expect(res.status).toBe(201);
  });

  it("records usage on a successful create", async () => {
    mgr.setLimits("acme", { limits: { agents: 2 } });
    const mw = quotaMiddleware({ manager: mgr });
    await mw(req(), ok);
    expect(mgr.status("acme", "agents").used).toBe(1);
  });

  it("does NOT record usage when the handler fails", async () => {
    mgr.setLimits("acme", { limits: { agents: 2 } });
    const mw = quotaMiddleware({ manager: mgr });
    const res = await mw(req(), fail);
    expect(res.status).toBe(400);
    expect(mgr.status("acme", "agents").used).toBe(0);
  });

  it("rejects with 429 once the cap is reached", async () => {
    mgr.setLimits("acme", { limits: { agents: 1 } });
    const mw = quotaMiddleware({ manager: mgr });
    const first = await mw(req(), ok);
    expect(first.status).toBe(201);
    // Second create: pre-check sees used(1) >= limit(1) -> 429.
    const second = await mw(req(), ok);
    expect(second.status).toBe(429);
    expect((second.body as { resource: string }).resource).toBe("agents");
    expect(mgr.status("acme", "agents").used).toBe(1); // not incremented by the rejected call
  });

  it("allows unlimited resources when no limit is set", async () => {
    const mw = quotaMiddleware({ manager: mgr });
    for (let i = 0; i < 5; i++) expect((await mw(req(), ok)).status).toBe(201);
    expect(mgr.status("acme", "agents").used).toBe(5);
  });

  it("surfaces a race that pushes over the cap between pre-check and record as 429", async () => {
    mgr.setLimits("acme", { limits: { agents: 1 } });
    const mw = quotaMiddleware({ manager: mgr });
    // Handler that consumes the last unit out-of-band before we record, forcing
    // manager.record() to throw QuotaExceededError on our post-success record.
    const sneaky = async (): Promise<ApiResponse> => {
      mgr.record("acme", "agents", 1); // now at the limit
      return { status: 201, body: {} };
    };
    const res = await mw(req(), sneaky);
    expect(res.status).toBe(429);
    expect((res.body as { error: string }).error).toContain("Quota exceeded");
  });

  it("rethrows non-quota errors from record()", async () => {
    const throwingManager = {
      status: () => ({ resource: "agents" as const, used: 0, limit: 5, remaining: 5, exceeded: false }),
      record: () => {
        throw new Error("db down");
      },
    } as unknown as QuotaManager;
    const mw = quotaMiddleware({ manager: throwingManager });
    await expect(mw(req(), ok)).rejects.toThrow("db down");
  });

  it("supports a custom resourceFor mapping", async () => {
    mgr.setLimits("acme", { limits: { eval_runs: 1 } });
    const mw = quotaMiddleware({ manager: mgr, resourceFor: () => "eval_runs" });
    expect((await mw(req(), ok)).status).toBe(201);
    expect((await mw(req(), ok)).status).toBe(429);
  });

  it("exposes the underlying manager", () => {
    const mw = quotaMiddleware({ manager: mgr });
    expect(mw.manager).toBe(mgr);
  });
});
