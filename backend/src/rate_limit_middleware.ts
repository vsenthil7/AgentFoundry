// S84 — Rate-limit middleware (live enforcement).
// The RateLimiter (S24) existed as an engine primitive but nothing enforced it on
// real HTTP traffic. This middleware wires it into the Router: each request consumes
// a token from a per-key bucket; when the bucket is empty the request is rejected
// with 429 and a Retry-After header, before the handler runs.
//
// Keying is pluggable. The default keys authenticated requests by principal
// (userId) and anonymous requests by a caller hint header, so one tenant or a login
// brute-forcer cannot exhaust everyone else's budget. Deterministic + offline-safe:
// the underlying RateLimiter uses an injectable clock.

import type { ApiRequest, ApiResponse, Middleware } from "./api.js";
import { RateLimiter, type RateLimitConfig } from "./ratelimit.js";

// Derive the bucket key for a request. Authenticated → principal; else a caller hint.
export function defaultKeyFor(req: ApiRequest): string {
  if (req.userId) return `user:${req.userId}`;
  const hint = req.headers["x-forwarded-for"] ?? req.headers["x-real-ip"] ?? "anon";
  return `anon:${hint}`;
}

export interface RateLimitMiddlewareOptions {
  config: RateLimitConfig;
  now?: () => number;
  keyFor?: (req: ApiRequest) => string;
  // Paths exempt from limiting (e.g. health checks). Matched by prefix.
  exemptPrefixes?: string[];
  cost?: number;
}

// Build a middleware that enforces a token-bucket limit. Exposes the underlying
// limiter on the returned function so callers can peek() for observability.
export function rateLimitMiddleware(opts: RateLimitMiddlewareOptions): Middleware & { limiter: RateLimiter } {
  const limiter = new RateLimiter(opts.config, opts.now);
  const keyFor = opts.keyFor ?? defaultKeyFor;
  const exempt = opts.exemptPrefixes ?? [];
  const cost = opts.cost ?? 1;

  const mw: Middleware = async (req, next) => {
    if (exempt.some((p) => req.path === p || req.path.startsWith(p + "/"))) {
      return next();
    }
    const result = limiter.consume(keyFor(req), cost);
    if (!result.allowed) {
      const retryAfterSec = result.retryAfterMs === Infinity ? 0 : Math.ceil(result.retryAfterMs / 1000);
      const res: ApiResponse = {
        status: 429,
        body: { error: "Rate limit exceeded. Slow down.", retryAfterMs: result.retryAfterMs },
        headers: {
          "content-type": "application/json",
          "retry-after": String(retryAfterSec),
          "x-ratelimit-remaining": String(result.remaining),
        },
      };
      return res;
    }
    const res = await next();
    return {
      ...res,
      headers: { ...res.headers, "x-ratelimit-remaining": String(result.remaining) },
    };
  };

  return Object.assign(mw, { limiter });
}
