import { describe, it, expect } from "vitest";
import {
  pathMatches,
  schemaValidationMiddleware,
  AGENTFOUNDRY_BODY_SCHEMAS,
} from "../src/schema_middleware.js";
import { json, type ApiRequest, type ApiResponse } from "../src/api.js";

function req(over: Partial<ApiRequest> = {}): ApiRequest {
  return { method: "POST", path: "/agents", headers: {}, query: {}, params: {}, body: {}, ...over };
}

describe("pathMatches", () => {
  it("matches identical static paths", () => {
    expect(pathMatches("/agents", "/agents")).toBe(true);
  });
  it("matches param segments", () => {
    expect(pathMatches("/agents/:id/approve", "/agents/abc/approve")).toBe(true);
  });
  it("rejects different segment counts", () => {
    expect(pathMatches("/agents/:id", "/agents")).toBe(false);
  });
  it("rejects a different static segment", () => {
    expect(pathMatches("/agents/:id/approve", "/agents/abc/deploy")).toBe(false);
  });
});

describe("schemaValidationMiddleware", () => {
  const mw = schemaValidationMiddleware(AGENTFOUNDRY_BODY_SCHEMAS);
  const ok: ApiResponse = json(201, { ok: true });
  const next = async () => ok;

  it("passes a valid POST /agents body", async () => {
    const res = await mw(req({ body: { id: "a", name: "Acme", purpose: "support" } }), next);
    expect(res.status).toBe(201);
  });

  it("rejects an invalid POST /agents body with 400 + details", async () => {
    const res = await mw(req({ body: { id: "" } }), next);
    expect(res.status).toBe(400);
    expect((res.body as { details: unknown[] }).details.length).toBeGreaterThan(0);
  });

  it("validates the approve body schema", async () => {
    const res = await mw(
      req({ method: "POST", path: "/agents/x/approve", body: { approval: { reviewer: "r", decision: "approved" } } }),
      next,
    );
    expect(res.status).toBe(201);
  });

  it("rejects an approve body with a bad decision enum", async () => {
    const res = await mw(
      req({ method: "POST", path: "/agents/x/approve", body: { approval: { reviewer: "r", decision: "maybe" } } }),
      next,
    );
    expect(res.status).toBe(400);
  });

  it("skips routes with no declared schema", async () => {
    const res = await mw(req({ method: "GET", path: "/agents" }), next);
    expect(res.status).toBe(201); // passed through to next()
  });
});
