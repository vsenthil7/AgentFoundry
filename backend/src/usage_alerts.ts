// S36 — Usage alerts & anomaly detection.
// Flags tenants approaching their quota and detects abnormal usage spikes against
// a rolling baseline. Deterministic; consumes the same QuotaResource model used
// by quotas (S24) and billing (S34).

import type { QuotaResource } from "./ratelimit.js";

export type AlertSeverity = "info" | "warning" | "critical";

export interface UsageAlert {
  tenantId: string;
  resource: QuotaResource;
  severity: AlertSeverity;
  kind: "quota_threshold" | "usage_spike";
  message: string;
  value: number;
}

export interface QuotaAlertConfig {
  // Fraction of the limit at which a warning fires (e.g. 0.8 = 80%).
  warnAt: number;
  // Fraction at which a critical alert fires (e.g. 0.95).
  criticalAt: number;
}

export const DEFAULT_QUOTA_ALERTS: QuotaAlertConfig = { warnAt: 0.8, criticalAt: 0.95 };

export class UsageAlertEngine {
  private readonly config: QuotaAlertConfig;
  // Rolling history of per-period usage values per tenant+resource.
  private readonly history = new Map<string, number[]>();

  constructor(config: QuotaAlertConfig = DEFAULT_QUOTA_ALERTS) {
    this.config = config;
  }

  private key(tenantId: string, resource: QuotaResource): string {
    return `${tenantId}:${resource}`;
  }

  // Evaluate current usage against a quota limit; returns an alert or null.
  checkQuota(
    tenantId: string,
    resource: QuotaResource,
    used: number,
    limit: number,
  ): UsageAlert | null {
    if (limit <= 0) return null;
    const fraction = used / limit;
    if (fraction >= this.config.criticalAt) {
      return {
        tenantId,
        resource,
        severity: "critical",
        kind: "quota_threshold",
        message: `Usage at ${Math.round(fraction * 100)}% of quota.`,
        value: fraction,
      };
    }
    if (fraction >= this.config.warnAt) {
      return {
        tenantId,
        resource,
        severity: "warning",
        kind: "quota_threshold",
        message: `Usage at ${Math.round(fraction * 100)}% of quota.`,
        value: fraction,
      };
    }
    return null;
  }

  // Record a period's usage into the rolling baseline.
  recordPeriod(tenantId: string, resource: QuotaResource, value: number): void {
    const k = this.key(tenantId, resource);
    const arr = this.history.get(k) ?? [];
    arr.push(value);
    this.history.set(k, arr);
  }

  // Detect a spike: current value exceeds (mean * factor) of the prior baseline.
  // Requires at least `minSamples` prior periods to avoid false positives.
  detectSpike(
    tenantId: string,
    resource: QuotaResource,
    current: number,
    factor = 2,
    minSamples = 3,
  ): UsageAlert | null {
    const arr = this.history.get(this.key(tenantId, resource)) ?? [];
    if (arr.length < minSamples) return null;
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    if (mean <= 0) return null;
    if (current > mean * factor) {
      return {
        tenantId,
        resource,
        severity: "critical",
        kind: "usage_spike",
        message: `Usage ${current} is ${(current / mean).toFixed(1)}x the ${arr.length}-period baseline (${mean.toFixed(1)}).`,
        value: current / mean,
      };
    }
    return null;
  }

  // Convenience: run both checks, returning all fired alerts (deterministic order).
  evaluate(input: {
    tenantId: string;
    resource: QuotaResource;
    used: number;
    limit: number;
  }): UsageAlert[] {
    const alerts: UsageAlert[] = [];
    const quota = this.checkQuota(input.tenantId, input.resource, input.used, input.limit);
    if (quota) alerts.push(quota);
    const spike = this.detectSpike(input.tenantId, input.resource, input.used);
    if (spike) alerts.push(spike);
    return alerts;
  }

  baseline(tenantId: string, resource: QuotaResource): number[] {
    return [...(this.history.get(this.key(tenantId, resource)) ?? [])];
  }
}
