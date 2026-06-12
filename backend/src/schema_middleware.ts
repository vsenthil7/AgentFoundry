// S35 — Route-level schema enforcement.
// A middleware factory that validates a request body against a JSON schema
// (S33) for matching method+path routes, returning 400 with the path-specific
// errors before the handler runs. Schemas are declared alongside the route
// catalog so the API self-enforces its documented contract.

import type { Middleware } from "./api.js";
import { json } from "./api.js";
import { validateSchema, type JsonSchema } from "./schema.js";

export interface RouteSchema {
  method: string;
  // Express-style path with ":id" params; matched structurally.
  path: string;
  bodySchema: JsonSchema;
}

// Match a concrete request path against a route pattern (":id" matches a segment).
export function pathMatches(pattern: string, actual: string): boolean {
  const p = pattern.split("/").filter(Boolean);
  const a = actual.split("/").filter(Boolean);
  if (p.length !== a.length) return false;
  for (let i = 0; i < p.length; i++) {
    if (!p[i].startsWith(":") && p[i] !== a[i]) return false;
  }
  return true;
}

export function schemaValidationMiddleware(schemas: RouteSchema[]): Middleware {
  return async (req, next) => {
    const match = schemas.find(
      (s) => s.method.toUpperCase() === req.method && pathMatches(s.path, req.path),
    );
    if (match) {
      const result = validateSchema(match.bodySchema, req.body);
      if (!result.valid) {
        return json(400, {
          error: "Request body failed validation",
          details: result.errors,
        });
      }
    }
    return next();
  };
}

// The body schemas for AgentFoundry's mutating endpoints.
export const AGENTFOUNDRY_BODY_SCHEMAS: RouteSchema[] = [
  {
    method: "POST",
    path: "/agents",
    bodySchema: {
      type: "object",
      required: ["id", "name", "purpose"],
      properties: {
        id: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        purpose: { type: "string", minLength: 1 },
      },
    },
  },
  {
    method: "POST",
    path: "/agents/:id/approve",
    bodySchema: {
      type: "object",
      required: ["approval"],
      properties: {
        approval: {
          type: "object",
          required: ["reviewer", "decision"],
          properties: {
            reviewer: { type: "string", minLength: 1 },
            decision: { enum: ["approved", "rejected"] },
          },
        },
      },
    },
  },
];
