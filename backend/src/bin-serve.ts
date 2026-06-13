// bin-serve: runnable HTTP server for AgentFoundry.
// Wires the full platform behind real authentication + a durable store, records
// an audit trail of every API call, and serves the built web console (dist/) so
// the whole product runs from one port.
//
//   Backend API:  http://localhost:PORT/...        (e.g. /auth/login, /agents)
//   Web console:  http://localhost:PORT/            (the gated React app)
//   Audit trail:  GET /audit/api                    (admin-scoped)
//
// Run:  npx tsx src/bin-serve.ts          (defaults to PORT=8080)
//       PORT=3000 AF_DATA=./data npx tsx src/bin-serve.ts
//
// Persistence: when AF_DATA is set, credentials/sessions/audit survive restart via
// FileStore; otherwise everything is in-memory (offline/dev).

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { GovernedRegistry } from "./governed_registry.js";
import { IdentityStore } from "./identity.js";
import { ReviewQueue, InMemoryChannel } from "./notifications.js";
import { EventBus } from "./events.js";
import { buildApi, type ApiDeps } from "./api_server.js";
import { AuthService } from "./auth.js";
import { FileStore } from "./file_store.js";
import { ApiAuditLog } from "./api_audit.js";
import { createListener } from "./http_server.js";
import { HttpError, json } from "./api.js";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.AF_DATA ?? "";
const WEB_DIST = process.env.AF_WEB_DIST ?? join(process.cwd(), "..", "web", "dist");

function makeStore(name: string): FileStore | null {
  if (!DATA_DIR) return null;
  return new FileStore(join(DATA_DIR, `${name}.json`));
}

const identity = new IdentityStore();
const auth = new AuthService(identity, makeStore("auth"));
const audit = new ApiAuditLog(() => Date.now(), makeStore("apicall"));

const deps: ApiDeps = {
  identity,
  registry: new GovernedRegistry(),
  reviews: new ReviewQueue(new InMemoryChannel()),
  events: new EventBus({ transport: { post: async () => true } }),
  auth,
  tokens: new Map<string, string>(),
};

const router = buildApi(deps);

// Audit middleware: time the call, record metadata (never bodies) after handling.
router.use(async (req, next) => {
  const started = Date.now();
  const res = await next();
  audit.record({
    method: req.method,
    path: req.path,
    status: res.status,
    latencyMs: Date.now() - started,
    actor: req.userId ?? "anonymous",
    tenantId: req.tenantId ?? null,
  });
  return res;
});

// Admin-scoped audit read endpoint.
router.get("/audit/api", (req) => {
  const user = deps.identity.getUser(req.userId!);
  if (!user.roles.includes("admin")) throw new HttpError(403, "Requires admin");
  return json(200, { summary: audit.summary(), calls: audit.query({ tenantId: user.tenantId }) });
});

const apiListener = createListener(router);

// Minimal static file server for the built web console.
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

// Paths handled by the API (everything else is static / SPA fallback).
const API_PREFIXES = ["/auth", "/admin", "/agents", "/health", "/healthz", "/status", "/audit", "/compliance", "/profiles", "/dr"];
function isApiPath(path: string): boolean {
  return API_PREFIXES.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (isApiPath(url.pathname)) {
    return apiListener(req, res);
  }
  // Static asset or SPA fallback to index.html.
  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  rel = normalize(rel).replace(/^(\.\.[/\\])+/, ""); // prevent path traversal
  let filePath = join(WEB_DIST, rel);
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    filePath = join(WEB_DIST, "index.html"); // SPA fallback
  }
  try {
    const buf = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found. Build the web console: cd web && npm run build");
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`AgentFoundry listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`  web console : http://localhost:${PORT}/`);
  // eslint-disable-next-line no-console
  console.log(`  API health  : http://localhost:${PORT}/health`);
  // eslint-disable-next-line no-console
  console.log(`  persistence : ${DATA_DIR ? `durable (${DATA_DIR})` : "in-memory"}`);
});
