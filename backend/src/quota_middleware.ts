// S88 — Quota enforcement middleware (live enforcement).
// The QuotaManager (S24) tracked per-tenant resource usage but nothing enforced it
// on real traffic. This middleware maps write endpoints to billable resources
// (agents, deployments, eval_runs), checks the tenant's cap *before* the handler
// runs (rejecting with 429 when exhausted), and records usage only when the handler
// actually succeeds (2xx) — so a failed create never burns quota.
//
// Deterministic and offline-safe: it drives the real QuotaManager, and the
// resource mapping is a pure function of method + path.

import type { ApiRequest, ApiResponse, Middleware } from "./api.js";
import { QuotaManager, QuotaExceededError, type QuotaResource } from "./ratelimit.js";

// Map a request to the billable resource it consumes, or null if not metered.
export function resourceForRequest(req: ApiRequest): QuotaResource | null {
  if (req.method === "POST" && req.path === "/agents") return "agents";
  if (req.method === "POST" && /^\/agents\/[^/]+\/deploy$/.test(req.path)) return "deployments";
  if (req.method === "POST" && /^\/agents\/[^/]+\/evaluate$/.test(req.path)) return "eval_runs";
  return null;
}

export interface QuotaMiddlewareOptions {
  manager: QuotaManager;
  // Override the resource mapping (testing / custom routes).
  resourceFor?: (req: ApiRequest) => QuotaResource | null;
}

// Build a middleware enforcing per-tenant quotas. Exposes the manager so callers
// can read a report for the /quota endpoint.
export function quotaMiddleware(opts: QuotaMiddlewareOptions): Middleware & { manager: QuotaManager } {
  const manager = opts.manager;
  const resourceFor = opts.resourceFor ?? resourceForRequest;

  const mw: Middleware = async (req, next) => {
    const resource = resourceFor(req);
    // Not a metered route, or no tenant context yet (unauthenticated) → pass through.
    if (resource === null || !req.tenantId) {
      return next();
    }
    // Pre-check: if already at/over cap, reject before doing the work.
    const status = manager.status(req.tenantId, resource);
    if (status.exceeded) {
      const res: ApiResponse = {
        status: 429,
        body: {
          error: `Quota exceeded for ${resource} (limit ${status.limit}).`,
          resource,
          used: status.used,
          limit: status.limit,
        },
        headers: { "content-type": "application/json" },
      };
      return res;
    }
    // Run the handler; only record usage if it actually created the resource.
    const response = await next();
    if (response.status >= 200 && response.status < 300) {
      try {
        manager.record(req.tenantId, resource, 1);
      } catch (err) {
        // A race could push us over between pre-check and record; surface as 429.
        if (err instanceof QuotaExceededError) {
          return {
            status: 429,
            body: { error: err.message, resource },
            headers: { "content-type": "application/json" },
          };
        }
        throw err;
      }
    }
    return response;
  };

  return Object.assign(mw, { manager });
}
