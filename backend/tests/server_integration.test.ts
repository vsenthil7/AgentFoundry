// S122 — Server integration tier (the missing test layer).
//
// This is the test that would have caught the S121 live login 500. The existing
// suite had a hole: unit tests (auth.test.ts) and router tests (auth_api.test.ts
// — which call router.handle(reqObject) directly, in-memory, no socket, no
// restart). Nothing booted the REAL server over a REAL socket against a DURABLE
// store and restarted it. That is exactly the production path:
//
//     browser  ->  real HTTP  ->  Node http.Server  ->  durable volume
//
// These tests assemble the server the same way `bin-serve` does (via the shared
// assembleRouter/createConfiguredServer factory — single source of wiring truth),
// bind it to an ephemeral port, and drive it with real `fetch`. The headline case
// boots server A over a temp dir, registers + logs in, closes it, boots server B
// over the SAME dir, and asserts login still returns 200 across the restart.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { createConfiguredServer } from "../src/bin-serve.js";
import { FileStore } from "../src/file_store.js";
import type { KeyValueStore } from "../src/persistence.js";

// A store factory bound to a directory, mirroring bin-serve's AF_DATA path:
// one JSON file per namespace ("auth.json", "apicall.json").
function fileStoreFactory(dir: string) {
  return async (name: string): Promise<KeyValueStore | null> => new FileStore(join(dir, `${name}.json`));
}

// Boot a real server over a socket and return its base URL + a close handle.
async function boot(opts: Parameters<typeof createConfiguredServer>[0]): Promise<{ url: string; server: Server }> {
  const server = await createConfiguredServer({ log: () => {}, ...opts });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { url: `http://localhost:${port}`, server };
}

function close(server: Server): Promise<void> {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("server integration — real socket, durable store (S122)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "af-srv-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves register, login, /auth/me, and a 401 (not 500) on bad password — over HTTP", async () => {
    const { url, server } = await boot({ makeStore: fileStoreFactory(dir), seed: true });
    try {
      // Register a brand-new tenant + admin. Use a tenant distinct from the demo
      // seed's "acme" so this user is the first in its tenant (admin).
      const reg = await fetch(`${url}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "initech", tenantName: "Initech", email: "owner@initech.com", password: "supersecret" }),
      });
      expect(reg.status).toBe(201);
      const regBody = await reg.json();
      expect(regBody.user.roles).toEqual(["admin"]);

      // Log in with the same credentials.
      const login = await fetch(`${url}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@initech.com", password: "supersecret" }),
      });
      expect(login.status).toBe(200);
      const { token } = await login.json();
      expect(typeof token).toBe("string");

      // The bearer token resolves /auth/me.
      const me = await fetch(`${url}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
      expect(me.status).toBe(200);
      expect((await me.json()).email).toBe("owner@initech.com");

      // /health is auth-gated in this build: 401 without a token, 200 with one.
      // (Documents the real behaviour so a deployment health-probe is configured
      //  with credentials, or /health is exempted, deliberately.)
      const healthAnon = await fetch(`${url}/health`);
      expect(healthAnon.status).toBe(401);
      const healthAuthed = await fetch(`${url}/health`, { headers: { authorization: `Bearer ${token}` } });
      expect(healthAuthed.status).toBe(200);

      // A wrong password is a clean 401 — NOT a 500 "Internal error".
      const bad = await fetch(`${url}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@initech.com", password: "wrong-password" }),
      });
      expect(bad.status).toBe(401);
      expect((await bad.json()).error).not.toBe("Internal error");
    } finally {
      await close(server);
    }
  });

  it("the demo seed admin can log in over HTTP (owner@acme.test / demo-password-123)", async () => {
    const { url, server } = await boot({ makeStore: fileStoreFactory(dir), seed: true });
    try {
      const login = await fetch(`${url}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@acme.test", password: "demo-password-123" }),
      });
      expect(login.status).toBe(200);
      expect((await login.json()).user.email).toBe("owner@acme.test");
    } finally {
      await close(server);
    }
  });

  // THE S121 REGRESSION: register + login on server A, then restart (server B over
  // the SAME durable dir) and assert login STILL returns 200. Before the S121 fix,
  // the rehydrated credential threw an unmapped error here -> 500 "Internal error".
  it("login still returns 200 across a server restart over the same durable store (S121 regression)", async () => {
    // Server A: register a real tenant admin, confirm login works.
    const a = await boot({ makeStore: fileStoreFactory(dir), seed: true });
    try {
      const reg = await fetch(`${a.url}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "globex", tenantName: "Globex", email: "boss@globex.com", password: "password-123" }),
      });
      expect(reg.status).toBe(201);
    } finally {
      await close(a.server);
    }

    // Server B: a brand-new process-equivalent over the SAME data dir. Its identity
    // store is empty and is rebuilt purely from the persisted credential on boot.
    const b = await boot({ makeStore: fileStoreFactory(dir), seed: true });
    try {
      const login = await fetch(`${b.url}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "boss@globex.com", password: "password-123" }),
      });
      // The headline assertion: 200, not 500.
      expect(login.status).toBe(200);
      const body = await login.json();
      expect(body.user.email).toBe("boss@globex.com");
      expect(body.user.roles).toEqual(["admin"]);
    } finally {
      await close(b.server);
    }
  });

  // A harsher variant of the same defect: the persisted auth.json is hand-mutated
  // to a drifted shape (user removed from the embedded record's tenant linkage)
  // BETWEEN restarts, and login must still self-heal to 200 rather than 500.
  it("login self-heals to 200 when the persisted record drifts across a restart", async () => {
    // Server A registers the admin, persisting auth.json.
    const a = await boot({ makeStore: fileStoreFactory(dir), seed: false });
    try {
      const reg = await fetch(`${a.url}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "drift", tenantName: "Drift Co", email: "admin@drift.com", password: "password-123" }),
      });
      expect(reg.status).toBe(201);
    } finally {
      await close(a.server);
    }

    // Simulate schema drift on disk: drop the tenantName from the credential record
    // (an older shape). The embedded user remains, so login must heal, not 500.
    const authFile = join(dir, "auth.json");
    const raw = JSON.parse(readFileSync(authFile, "utf8")) as Record<string, string>;
    const credKey = Object.keys(raw).find((k) => k.startsWith("auth:cred:"))!;
    const cred = JSON.parse(raw[credKey]);
    delete cred.tenantName;
    raw[credKey] = JSON.stringify(cred);
    writeFileSync(authFile, JSON.stringify(raw), "utf8");

    // Server B boots over the drifted store and login still succeeds.
    const b = await boot({ makeStore: fileStoreFactory(dir), seed: false });
    try {
      const login = await fetch(`${b.url}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@drift.com", password: "password-123" }),
      });
      expect(login.status).toBe(200);
      expect((await login.json()).user.email).toBe("admin@drift.com");
    } finally {
      await close(b.server);
    }
  });

  it("in-memory mode (no store) also serves a full register+login over HTTP", async () => {
    // makeStore omitted -> the factory default returns null -> in-memory engine.
    const { url, server } = await boot({ makeStore: async () => null, seed: false });
    try {
      const reg = await fetch(`${url}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "mem", tenantName: "Mem", email: "u@mem.com", password: "password-123" }),
      });
      expect(reg.status).toBe(201);
      const login = await fetch(`${url}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "u@mem.com", password: "password-123" }),
      });
      expect(login.status).toBe(200);
    } finally {
      await close(server);
    }
  });
});
