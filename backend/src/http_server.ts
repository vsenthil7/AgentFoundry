// S29 — HTTP server binding.
// Adapts the framework-free Router onto Node's http server. The request parsing
// and response serialization are extracted into pure functions so they are
// testable without opening a socket; createServer wires them to real IO.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { Router, ApiRequest, ApiResponse, HttpMethod } from "./api.js";

// Parse a raw request line + headers + body into an ApiRequest (pure).
export function parseRequest(input: {
  method: string;
  url: string;
  headers: Record<string, string>;
  rawBody: string;
}): ApiRequest {
  const url = new URL(input.url, "http://localhost");
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams) query[k] = v;

  let body: unknown = null;
  if (input.rawBody.length > 0) {
    try {
      body = JSON.parse(input.rawBody);
    } catch {
      body = input.rawBody; // non-JSON bodies passed through as text
    }
  }

  return {
    method: (input.method.toUpperCase() as HttpMethod),
    path: url.pathname,
    headers: normalizeHeaders(input.headers),
    query,
    params: {},
    body,
  };
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : v;
  }
  return out;
}

// Serialize an ApiResponse to a status + headers + string body (pure).
export function serializeResponse(res: ApiResponse): {
  status: number;
  headers: Record<string, string>;
  body: string;
} {
  const headers = { "content-type": "application/json", ...(res.headers ?? {}) };
  const body = typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? null);
  return { status: res.status, headers, body };
}

// Read a request body stream to a string.
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Build a request listener bound to a router (testable without a socket).
export function createListener(router: Router) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rawBody = await readBody(req);
    const apiReq = parseRequest({
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: normalizeHeaders(req.headers as Record<string, string | string[] | undefined>),
      rawBody,
    });
    const apiRes = await router.handle(apiReq);
    const out = serializeResponse(apiRes);
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  };
}

export function createHttpServer(router: Router): Server {
  return createServer(createListener(router));
}
