import { describe, it, expect } from "vitest";
import {
  generateOpenApi,
  AGENTFOUNDRY_ROUTES,
  type RouteSpec,
} from "../src/openapi.js";

const info = { title: "AgentFoundry API", version: "1.0.0" };

describe("generateOpenApi", () => {
  it("produces an OpenAPI 3.1 document", () => {
    const spec = generateOpenApi(info, AGENTFOUNDRY_ROUTES);
    expect(spec.openapi).toBe("3.1.0");
    expect((spec.info as { title: string }).title).toBe("AgentFoundry API");
  });

  it("includes a bearer security scheme", () => {
    const spec = generateOpenApi(info, AGENTFOUNDRY_ROUTES);
    const components = spec.components as { securitySchemes: { bearerAuth: { scheme: string } } };
    expect(components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });

  it("converts :id params to {id} and emits a path parameter", () => {
    const spec = generateOpenApi(info, [
      { method: "GET", path: "/agents/:id", summary: "Read", responses: [{ status: 200, description: "OK" }] },
    ]);
    const paths = spec.paths as Record<string, Record<string, { parameters?: { name: string }[] }>>;
    expect(paths["/agents/{id}"]).toBeDefined();
    expect(paths["/agents/{id}"].get.parameters?.[0].name).toBe("id");
  });

  it("attaches security + x-required-permission for permissioned routes", () => {
    const spec = generateOpenApi(info, [
      { method: "POST", path: "/agents", summary: "Create", permission: "agent:create", responses: [{ status: 201, description: "Created" }] },
    ]);
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(paths["/agents"].post["x-required-permission"]).toBe("agent:create");
    expect(paths["/agents"].post.security).toEqual([{ bearerAuth: [] }]);
  });

  it("omits security for unpermissioned routes", () => {
    const spec = generateOpenApi(info, [
      { method: "GET", path: "/health", summary: "Health", responses: [{ status: 200, description: "OK" }] },
    ]);
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(paths["/health"].get.security).toBeUndefined();
  });

  it("includes a request body when specified", () => {
    const spec = generateOpenApi(info, [
      { method: "POST", path: "/agents", summary: "Create", requestBody: { description: "Design", required: true }, responses: [{ status: 201, description: "Created" }] },
    ]);
    const paths = spec.paths as Record<string, Record<string, { requestBody?: { required: boolean } }>>;
    expect(paths["/agents"].post.requestBody?.required).toBe(true);
  });

  it("maps all declared responses", () => {
    const spec = generateOpenApi(info, [
      { method: "POST", path: "/x", summary: "X", responses: [{ status: 200, description: "OK" }, { status: 422, description: "Failed" }] },
    ]);
    const paths = spec.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>;
    expect(Object.keys(paths["/x"].post.responses)).toEqual(["200", "422"]);
  });

  it("groups multiple methods under one path", () => {
    const routes: RouteSpec[] = [
      { method: "GET", path: "/agents/:id", summary: "Read", responses: [{ status: 200, description: "OK" }] },
      { method: "DELETE", path: "/agents/:id", summary: "Retire", responses: [{ status: 200, description: "OK" }] },
    ];
    const spec = generateOpenApi(info, routes);
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    expect(Object.keys(paths["/agents/{id}"]).sort()).toEqual(["delete", "get"]);
  });

  it("is deterministic regardless of input order", () => {
    const a = generateOpenApi(info, AGENTFOUNDRY_ROUTES);
    const b = generateOpenApi(info, [...AGENTFOUNDRY_ROUTES].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("includes a description when provided", () => {
    const spec = generateOpenApi({ ...info, description: "Agent SDLC platform" }, AGENTFOUNDRY_ROUTES);
    expect((spec.info as { description: string }).description).toBe("Agent SDLC platform");
  });

  it("the AgentFoundry catalog covers the agent lifecycle", () => {
    const spec = generateOpenApi(info, AGENTFOUNDRY_ROUTES);
    const paths = Object.keys(spec.paths as Record<string, unknown>);
    expect(paths).toContain("/agents");
    expect(paths).toContain("/agents/{id}/approve");
    expect(paths).toContain("/reviews");
  });
});
