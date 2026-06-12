import { describe, it, expect } from "vitest";
import {
  Router,
  json,
  HttpError,
  authMiddleware,
  loggingMiddleware,
  type ApiRequest,
} from "../src/api.js";

function req(over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: "GET",
    path: "/",
    headers: {},
    query: {},
    params: {},
    body: null,
    ...over,
  };
}

describe("routing", () => {
  it("matches a static route", async () => {
    const r = new Router().get("/health", () => json(200, { ok: true }));
    const res = await r.handle(req({ method: "GET", path: "/health" }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 404 for an unmatched route", async () => {
    const r = new Router().get("/a", () => json(200, {}));
    const res = await r.handle(req({ path: "/b" }));
    expect(res.status).toBe(404);
  });

  it("extracts path params", async () => {
    const r = new Router().get("/agents/:id", (rq) => json(200, { id: rq.params.id }));
    const res = await r.handle(req({ path: "/agents/acme-bot" }));
    expect(res.body).toEqual({ id: "acme-bot" });
  });

  it("distinguishes methods on the same path", async () => {
    const r = new Router()
      .get("/x", () => json(200, { m: "get" }))
      .post("/x", () => json(201, { m: "post" }));
    expect((await r.handle(req({ method: "GET", path: "/x" }))).body).toEqual({ m: "get" });
    expect((await r.handle(req({ method: "POST", path: "/x" }))).body).toEqual({ m: "post" });
  });

  it("does not match different segment counts", async () => {
    const r = new Router().get("/a/:id", () => json(200, {}));
    expect((await r.handle(req({ path: "/a" }))).status).toBe(404);
    expect((await r.handle(req({ path: "/a/1/2" }))).status).toBe(404);
  });

  it("does not match a different static segment", async () => {
    const r = new Router().get("/a/b", () => json(200, {}));
    expect((await r.handle(req({ path: "/a/c" }))).status).toBe(404);
  });

  it("supports put and delete", async () => {
    const r = new Router()
      .put("/x", () => json(200, { m: "put" }))
      .delete("/x", () => json(200, { m: "del" }));
    expect((await r.handle(req({ method: "PUT", path: "/x" }))).body).toEqual({ m: "put" });
    expect((await r.handle(req({ method: "DELETE", path: "/x" }))).body).toEqual({ m: "del" });
  });
});

describe("error handling", () => {
  it("maps HttpError to its status", async () => {
    const r = new Router().get("/x", () => {
      throw new HttpError(400, "bad");
    });
    const res = await r.handle(req({ path: "/x" }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad" });
  });

  it("maps an unexpected throw to 500", async () => {
    const r = new Router().get("/x", () => {
      throw new Error("boom");
    });
    const res = await r.handle(req({ path: "/x" }));
    expect(res.status).toBe(500);
  });
});

describe("middleware", () => {
  it("runs middleware before the handler", async () => {
    const order: string[] = [];
    const r = new Router()
      .use(async (_rq, next) => {
        order.push("mw");
        return next();
      })
      .get("/x", () => {
        order.push("handler");
        return json(200, {});
      });
    await r.handle(req({ path: "/x" }));
    expect(order).toEqual(["mw", "handler"]);
  });

  it("authMiddleware rejects without a valid token", async () => {
    const r = new Router()
      .use(authMiddleware(() => null))
      .get("/x", () => json(200, {}));
    const res = await r.handle(req({ path: "/x", headers: { authorization: "Bearer bad" } }));
    expect(res.status).toBe(401);
  });

  it("authMiddleware populates user + tenant on success", async () => {
    const r = new Router()
      .use(authMiddleware((t) => (t === "good" ? { userId: "u1", tenantId: "t1" } : null)))
      .get("/x", (rq) => json(200, { u: rq.userId, t: rq.tenantId }));
    const res = await r.handle(req({ path: "/x", headers: { authorization: "Bearer good" } }));
    expect(res.body).toEqual({ u: "u1", t: "t1" });
  });

  it("authMiddleware rejects a missing header", async () => {
    const r = new Router()
      .use(authMiddleware(() => ({ userId: "u", tenantId: "t" })))
      .get("/x", () => json(200, {}));
    const res = await r.handle(req({ path: "/x" }));
    expect(res.status).toBe(401);
  });

  it("loggingMiddleware records method/path/status", async () => {
    const log: unknown[] = [];
    const r = new Router()
      .use(loggingMiddleware((e) => log.push(e)))
      .get("/x", () => json(200, {}));
    await r.handle(req({ path: "/x" }));
    expect(log).toEqual([{ method: "GET", path: "/x", status: 200 }]);
  });
});
