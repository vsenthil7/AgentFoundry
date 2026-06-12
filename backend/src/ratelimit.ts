// S24 — Rate limiting & quotas.
// A token-bucket rate limiter (per key, e.g. tenant or user) and a per-tenant
// quota tracker for billable resources (agents, eval runs, deployments). Both
// use an injectable clock so behaviour is deterministic in tests and offline.

export interface RateLimitConfig {
  capacity: number; // max tokens in the bucket
  refillPerSecond: number; // tokens added per second
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly config: RateLimitConfig;
  private readonly now: () => number;

  constructor(config: RateLimitConfig, now: () => number = () => Date.now()) {
    this.config = config;
    this.now = now;
  }

  private refill(bucket: Bucket): void {
    const nowMs = this.now();
    const elapsedMs = nowMs - bucket.lastRefillMs;
    if (elapsedMs > 0) {
      const refill = (elapsedMs / 1000) * this.config.refillPerSecond;
      bucket.tokens = Math.min(this.config.capacity, bucket.tokens + refill);
      bucket.lastRefillMs = nowMs;
    }
  }

  // Attempt to consume `cost` tokens for `key`. Returns allow/deny + remaining.
  consume(key: string, cost = 1): RateLimitResult {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.config.capacity, lastRefillMs: this.now() };
      this.buckets.set(key, bucket);
    }
    this.refill(bucket);

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }
    const deficit = cost - bucket.tokens;
    const retryAfterMs =
      this.config.refillPerSecond > 0
        ? Math.ceil((deficit / this.config.refillPerSecond) * 1000)
        : Infinity;
    return { allowed: false, remaining: Math.floor(bucket.tokens), retryAfterMs };
  }

  // Current token count for a key (after refill), for observability.
  peek(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return this.config.capacity;
    this.refill(bucket);
    return Math.floor(bucket.tokens);
  }
}

// ---- Quotas ----

export type QuotaResource = "agents" | "eval_runs" | "deployments" | "api_calls";

export interface QuotaLimits {
  // Per-resource monthly caps. Unset = unlimited.
  limits: Partial<Record<QuotaResource, number>>;
}

export interface QuotaStatus {
  resource: QuotaResource;
  used: number;
  limit: number | null; // null = unlimited
  remaining: number | null;
  exceeded: boolean;
}

export class QuotaExceededError extends Error {
  constructor(tenantId: string, resource: QuotaResource, limit: number) {
    super(`Quota exceeded for tenant '${tenantId}': ${resource} limit ${limit}.`);
    this.name = "QuotaExceededError";
  }
}

export class QuotaManager {
  private readonly limits = new Map<string, QuotaLimits>();
  // tenantId -> period -> resource -> used
  private readonly usage = new Map<string, Map<QuotaResource, number>>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  private period(): string {
    const d = new Date(this.now());
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
  }

  private key(tenantId: string): string {
    return `${tenantId}:${this.period()}`;
  }

  setLimits(tenantId: string, limits: QuotaLimits): void {
    this.limits.set(tenantId, { limits: { ...limits.limits } });
  }

  private usageMap(tenantId: string): Map<QuotaResource, number> {
    const k = this.key(tenantId);
    let m = this.usage.get(k);
    if (!m) {
      m = new Map();
      this.usage.set(k, m);
    }
    return m;
  }

  // Record usage, throwing if it would exceed the cap.
  record(tenantId: string, resource: QuotaResource, amount = 1): number {
    const limit = this.limits.get(tenantId)?.limits[resource];
    const map = this.usageMap(tenantId);
    const current = map.get(resource) ?? 0;
    const next = current + amount;
    if (limit !== undefined && next > limit) {
      throw new QuotaExceededError(tenantId, resource, limit);
    }
    map.set(resource, next);
    return next;
  }

  // Check without recording.
  status(tenantId: string, resource: QuotaResource): QuotaStatus {
    const limit = this.limits.get(tenantId)?.limits[resource] ?? null;
    const used = this.usageMap(tenantId).get(resource) ?? 0;
    return {
      resource,
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
      exceeded: limit !== null && used >= limit,
    };
  }

  // Full report across all known resources for a tenant.
  report(tenantId: string): QuotaStatus[] {
    const resources: QuotaResource[] = ["agents", "eval_runs", "deployments", "api_calls"];
    return resources.map((r) => this.status(tenantId, r));
  }
}
