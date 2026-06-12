import { describe, it, expect } from "vitest";
import {
  parseRequest,
  serializeResponse,
  createListener,
  createHttpServer,
} from "../src/http_server.js";
import { Router, json } from "../src/api.js";
import type { ServerResponse } from "node:http";

describe("parseRequest", () => {
  it("parses method, path, and JSON body", () => {
    const r = parseRequest({
      method: "post",
      url: "/agents",
      headers: { "content-type": "application/json" },
      rawBody: '{"id":"a"}',
    });
    expect(r.method).toBe("POST");
    expect(r.path).toBe("/agents");
    expect(r.body).toEqual({ id: "a" });
  });

  it("parses query parameters", () => {
    const r = parseRequest({ method: "GET", url: "/agents?state=draft&owner=x", headers: {}, rawBody: "" });
    expect(r.query).toEqual({ state: "draft", owner: "x" });
  });

  it("passes a non-JSON body through as text", () => {
    const r = parseRequest({ method: "POST", url: "/x", headers: {}, rawBody: "not json" });
    expect(r.body).toBe("not json");
  });

  it("uses null body for an empty request", () => {
    const r = parseRequest({ method: "GET", url: "/x", headers: {}, rawBody: "" });
    expect(r.body).toBeNull();
  });

  it("lowercases header names", () => {
    const r = parseRequest({ method: "GET", url: "/x", headers: { Authorization: "Bearer t" }, rawBody: "" });
    expect(r.headers["authorization"]).toBe("Bearer t");
  });

  it("joins array headers and skips undefined ones", () => {
    const r = parseRequest({
      method: "GET",
      url: "/x",
      // Cast through unknown to simulate Node's array/undefined header values.
      headers: { "x-multi": ["a", "b"], "x-empty": undefined } as unknown as Record<string, string>,
      rawBody: "",
    });
    expect(r.headers["x-multi"]).toBe("a,b");
    expect(r.headers["x-empty"]).toBeUndefined();
  });
});

describe("serializeResponse", () => {
  it("serializes a JSON body with content-type", () => {
    const out = serializeResponse(json(200, { ok: true }));
    expect(out.status).toBe(200);
    expect(out.headers["content-type"]).toBe("application/json");
    expect(out.body).toBe('{"ok":true}');
  });

  it("passes a string body through", () => {
    const out = serializeResponse({ status: 200, body: "plain" });
    expect(out.body).toBe("plain");
  });

  it("handles a null body", () => {
    const out = serializeResponse({ status: 204, body: null });
    expect(out.body).toBe("null");
  });

  it("merges custom headers", () => {
    const out = serializeResponse({ status: 200, body: {}, headers: { "x-custom": "1" } });
    expect(out.headers["x-custom"]).toBe("1");
  });
});

describe("createListener", () => {
  it("routes a parsed request and writes the response", async () => {
    const router = new Router().get("/health", () => json(200, { status: "ok" }));
    const listener = createListener(router);

    // Fake IncomingMessage with an async data/end stream.
    const chunks = ["", ""];
    let dataCb: ((c: Buffer) => void) | null = null;
    let endCb: (() => void) | null = null;
    const req = {
      method: "GET",
      url: "/health",
      headers: {},
      on(event: string, cb: (arg?: unknown) => void) {
        if (event === "data") dataCb = cb as (c: Buffer) => void;
        if (event === "end") endCb = cb as () => void;
        return this;
      },
    };

    let writtenStatus = 0;
    let writtenBody = "";
    const res = {
      writeHead(status: number) {
        writtenStatus = status;
      },
      end(body: string) {
        writtenBody = body;
      },
    } as unknown as ServerResponse;

    const promise = listener(req as never, res);
    // Drive the stream: no data, then end.
    void chunks;
    void dataCb;
    endCb!();
    await promise;

    expect(writtenStatus).toBe(200);
    expect(writtenBody).toBe('{"status":"ok"}');
  });

  it("defaults method to GET and url to / when missing", async () => {
    const router = new Router().get("/", () => json(200, { root: true }));
    const listener = createListener(router);
    let endCb: (() => void) | null = null;
    const req = {
      // method and url intentionally omitted to exercise the ?? fallbacks
      headers: {},
      on(event: string, cb: (arg?: unknown) => void) {
        if (event === "end") endCb = cb as () => void;
        return this;
      },
    };
    let writtenBody = "";
    const res = {
      writeHead() {},
      end(body: string) {
        writtenBody = body;
      },
    } as unknown as ServerResponse;

    const promise = listener(req as never, res);
    endCb!();
    await promise;
    expect(writtenBody).toBe('{"root":true}');
  });
});

describe("createHttpServer — real socket roundtrip", () => {
  it("serves a request over an ephemeral port", async () => {
    const router = new Router().get("/ping", () => json(200, { pong: true }));
    const server = createHttpServer(router);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const res = await fetch(`http://localhost:${port}/ping`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ pong: true });

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("handles a POST with a JSON body over a socket", async () => {
    const router = new Router().post("/echo", (req) => json(200, { got: req.body }));
    const server = createHttpServer(router);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const res = await fetch(`http://localhost:${port}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    const body = await res.json();
    expect(body).toEqual({ got: { hello: "world" } });

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
