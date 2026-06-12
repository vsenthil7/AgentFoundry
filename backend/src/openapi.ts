// S30 — OpenAPI spec generator.
// Produces an OpenAPI 3.1 document from a declarative route catalog so the HTTP
// API is self-describing (for client generation, docs, and contract testing).

import type { HttpMethod } from "./api.js";

export interface RouteSpec {
  method: HttpMethod;
  path: string; // express-style ":id" params
  summary: string;
  permission?: string;
  requestBody?: { description: string; required: boolean };
  responses: { status: number; description: string }[];
}

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

// Convert ":id" path params to OpenAPI "{id}" and collect param names.
function toOpenApiPath(path: string): { path: string; params: string[] } {
  const params: string[] = [];
  const converted = path
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        const name = seg.slice(1);
        params.push(name);
        return `{${name}}`;
      }
      return seg;
    })
    .join("/");
  return { path: converted, params };
}

export function generateOpenApi(
  info: OpenApiInfo,
  routes: RouteSpec[],
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  // Deterministic ordering: sort by path then method.
  const sorted = [...routes].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );

  for (const route of sorted) {
    const { path, params } = toOpenApiPath(route.path);
    const item = (paths[path] ??= {});
    const op: Record<string, unknown> = {
      summary: route.summary,
      responses: Object.fromEntries(
        route.responses.map((r) => [
          String(r.status),
          { description: r.description },
        ]),
      ),
    };
    if (params.length > 0) {
      op.parameters = params.map((name) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
      }));
    }
    if (route.requestBody) {
      op.requestBody = {
        description: route.requestBody.description,
        required: route.requestBody.required,
        content: { "application/json": { schema: { type: "object" } } },
      };
    }
    if (route.permission) {
      op["x-required-permission"] = route.permission;
      op.security = [{ bearerAuth: [] }];
    }
    item[route.method.toLowerCase()] = op;
  }

  return {
    openapi: "3.1.0",
    info: { title: info.title, version: info.version, ...(info.description ? { description: info.description } : {}) },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    paths,
  };
}

// The catalog for AgentFoundry's API (mirrors api_server endpoints).
export const AGENTFOUNDRY_ROUTES: RouteSpec[] = [
  { method: "GET", path: "/health", summary: "Health check", responses: [{ status: 200, description: "OK" }] },
  { method: "POST", path: "/agents", summary: "Register an agent", permission: "agent:create", requestBody: { description: "Agent design", required: true }, responses: [{ status: 201, description: "Created" }, { status: 400, description: "Invalid design" }] },
  { method: "GET", path: "/agents", summary: "List agents in tenant", permission: "agent:read", responses: [{ status: 200, description: "Agent list" }] },
  { method: "GET", path: "/agents/:id", summary: "Read an agent", permission: "agent:read", responses: [{ status: 200, description: "Agent" }, { status: 404, description: "Not found" }] },
  { method: "POST", path: "/agents/:id/promote", summary: "Request promotion", permission: "agent:promote_request", requestBody: { description: "Scorecard summary", required: false }, responses: [{ status: 202, description: "Review created" }] },
  { method: "POST", path: "/agents/:id/approve", summary: "Approve promotion (policy-gated)", permission: "agent:approve", requestBody: { description: "Approval record + policy context", required: true }, responses: [{ status: 200, description: "Approved" }, { status: 422, description: "Policy gate failed" }] },
  { method: "POST", path: "/agents/:id/deploy", summary: "Deploy an agent", permission: "agent:deploy", responses: [{ status: 200, description: "Deployed" }] },
  { method: "DELETE", path: "/agents/:id", summary: "Retire an agent", permission: "agent:retire", responses: [{ status: 200, description: "Retired" }] },
  { method: "GET", path: "/reviews", summary: "List pending reviews", permission: "agent:read", responses: [{ status: 200, description: "Review list" }] },
];
