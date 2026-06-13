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
//       AF_PG=postgres://user:pass@host:5432/db npx tsx src/bin-serve.ts
//
// Persistence backend, in priority order:
//   1. AF_PG set  -> PostgreSQL (durable, multi-instance scale)   [requires `pg`]
//   2. AF_DATA set-> file-backed durable store (survives restart)
//   3. neither    -> in-memory (offline/dev)

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
import { PostgresStore, type PgClient } from "./postgres_store.js";
import { ApiAuditLog } from "./api_audit.js";
import { CircuitBreakerManager } from "./circuit_breaker.js";
import { rateLimitMiddleware } from "./rate_limit_middleware.js";
import { createListener } from "./http_server.js";
import { HttpError, json, type Router } from "./api.js";
import type { KeyValueStore } from "./persistence.js";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.AF_DATA ?? "";
const PG_URL = process.env.AF_PG ?? "";
const WEB_DIST = process.env.AF_WEB_DIST ?? join(process.cwd(), "..", "web", "dist");

// Build a store for a logical namespace. Postgres uses one table per namespace;
// file uses one file per namespace; in-memory returns null (modules fall back).
async function makeStore(name: string): Promise<KeyValueStore | null> {
  if (PG_URL) {
    // Lazy-load pg only when configured, so the engine stays dependency-free.
    // The specifier is held in a variable so the type-checker does not require
    // the optional `pg` package to be installed for non-Postgres builds.
    const pgModule = "pg";
    const pg = (await import(pgModule)) as unknown as {
      Pool: new (cfg: { connectionString: string }) => PgClient;
    };
    const pool = new pg.Pool({ connectionString: PG_URL });
    const store = new PostgresStore(pool, `agentfoundry_${name}`);
    await store.init();
    return store;
  }
  if (DATA_DIR) {
    return new FileStore(join(DATA_DIR, `${name}.json`));
  }
  return null;
}

function backendLabel(): string {
  if (PG_URL) return "postgres (durable, scale)";
  if (DATA_DIR) return `file (${DATA_DIR})`;
  return "in-memory";
}

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

const API_PREFIXES = ["/auth", "/admin", "/agents", "/health", "/healthz", "/status", "/audit", "/breakers", "/compliance", "/profiles", "/dr"];
function isApiPath(path: string): boolean {
  return API_PREFIXES.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p));
}

function buildServer(router: Router) {
  const apiListener = createListener(router);
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (isApiPath(url.pathname)) {
      return apiListener(req, res);
    }
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
}

async function main(): Promise<void> {
  const identity = new IdentityStore();
  const auth = new AuthService(identity, await makeStore("auth"));
  const audit = new ApiAuditLog(() => Date.now(), await makeStore("apicall"));

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

  // Rate-limit middleware (S84): enforce a per-principal token bucket on all API
  // traffic. Registered after audit so throttled (429) calls are still audited.
  // Health checks are exempt so liveness probes are never throttled. Tunable via
  // AF_RATE_CAPACITY / AF_RATE_REFILL env (sensible defaults otherwise).
  const rateCapacity = Number(process.env.AF_RATE_CAPACITY ?? 120);
  const rateRefill = Number(process.env.AF_RATE_REFILL ?? 2);
  router.use(
    rateLimitMiddleware({
      config: { capacity: rateCapacity, refillPerSecond: rateRefill },
      exemptPrefixes: ["/health", "/healthz"],
    }),
  );

  // Admin-scoped audit read endpoint.
  router.get("/audit/api", (req) => {
    const user = deps.identity.getUser(req.userId!);
    if (!user.roles.includes("admin")) throw new HttpError(403, "Requires admin");
    return json(200, { summary: audit.summary(), calls: audit.query({ tenantId: user.tenantId }) });
  });

  // Runtime containment: a circuit breaker per agent. Admins can view tripped
  // agents and manually reset a breaker. (Observations are fed by the runtime;
  // exposed here so an operator dashboard can read containment state.)
  const breakers = new CircuitBreakerManager();
  router.get("/breakers", (req) => {
    const user = deps.identity.getUser(req.userId!);
    if (!user.roles.includes("admin")) throw new HttpError(403, "Requires admin");
    return json(200, { tripped: breakers.trippedAgents(), transitions: breakers.transitions() });
  });
  router.post("/breakers/:agent/reset", (req) => {
    const user = deps.identity.getUser(req.userId!);
    if (!user.roles.includes("admin")) throw new HttpError(403, "Requires admin");
    const t = breakers.reset(req.params.agent);
    if (!t) throw new HttpError(404, "No breaker for that agent");
    return json(200, t);
  });

  const server = buildServer(router);
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`AgentFoundry listening on http://localhost:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`  web console : http://localhost:${PORT}/`);
    // eslint-disable-next-line no-console
    console.log(`  API health  : http://localhost:${PORT}/health`);
    // eslint-disable-next-line no-console
    console.log(`  persistence : ${backendLabel()}`);
    // eslint-disable-next-line no-console
    console.log(`  rate limit  : ${rateCapacity} burst, ${rateRefill}/s refill per principal`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start AgentFoundry:", err);
  process.exit(1);
});
