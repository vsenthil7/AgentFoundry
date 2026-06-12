// S19 — Data retention & residency controls.
// Per-tenant policies define how long each data class is retained and which
// region its data may reside in. Records are placed with a region + creation
// time; placement is rejected if it violates residency, and expired records are
// purged deterministically against a supplied clock.

export type DataClass =
  | "agent_design"
  | "eval_result"
  | "audit_log"
  | "runtime_trace"
  | "incident";

export type Region = "us" | "eu" | "uk" | "apac";

export interface RetentionPolicy {
  readonly tenantId: string;
  // Retention in days per data class. 0 = retain indefinitely.
  readonly retentionDays: Partial<Record<DataClass, number>>;
  // Allowed residency regions for this tenant's data.
  readonly allowedRegions: readonly Region[];
}

export interface DataRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly dataClass: DataClass;
  readonly region: Region;
  readonly createdAt: string; // ISO timestamp
}

export class ResidencyViolationError extends Error {
  constructor(region: Region, allowed: readonly Region[]) {
    super(
      `Residency violation: region '${region}' not in allowed [${allowed.join(", ")}].`,
    );
    this.name = "ResidencyViolationError";
  }
}

export class PolicyNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`No retention policy for tenant: ${tenantId}`);
    this.name = "PolicyNotFoundError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class DataGovernance {
  private readonly policies = new Map<string, RetentionPolicy>();
  private readonly records = new Map<string, DataRecord>();
  private readonly now: () => number;

  constructor(now: () => number = () => 0) {
    this.now = now;
  }

  setPolicy(policy: RetentionPolicy): void {
    this.policies.set(policy.tenantId, {
      ...policy,
      allowedRegions: [...policy.allowedRegions],
      retentionDays: { ...policy.retentionDays },
    });
  }

  getPolicy(tenantId: string): RetentionPolicy {
    const p = this.policies.get(tenantId);
    if (!p) throw new PolicyNotFoundError(tenantId);
    return p;
  }

  // Place a record, enforcing residency. Throws on violation.
  place(record: DataRecord): DataRecord {
    const policy = this.getPolicy(record.tenantId);
    if (!policy.allowedRegions.includes(record.region)) {
      throw new ResidencyViolationError(record.region, policy.allowedRegions);
    }
    const frozen = Object.freeze({ ...record });
    this.records.set(record.id, frozen);
    return frozen;
  }

  get(id: string): DataRecord | null {
    return this.records.get(id) ?? null;
  }

  // A record is expired if its data class has a positive retention window and
  // age exceeds it. Indefinite (0/unset) retention never expires.
  isExpired(record: DataRecord): boolean {
    const policy = this.policies.get(record.tenantId);
    if (!policy) return false;
    const days = policy.retentionDays[record.dataClass];
    if (!days || days <= 0) return false;
    const ageMs = this.now() - Date.parse(record.createdAt);
    return ageMs > days * DAY_MS;
  }

  // Purge all expired records; returns the ids removed (sorted, deterministic).
  purgeExpired(): string[] {
    const removed: string[] = [];
    for (const [id, rec] of this.records) {
      if (this.isExpired(rec)) {
        this.records.delete(id);
        removed.push(id);
      }
    }
    return removed.sort();
  }

  // Records for a tenant, optionally filtered by class/region. Deterministic.
  list(filter: {
    tenantId: string;
    dataClass?: DataClass;
    region?: Region;
  }): DataRecord[] {
    return [...this.records.values()]
      .filter(
        (r) =>
          r.tenantId === filter.tenantId &&
          (filter.dataClass === undefined || r.dataClass === filter.dataClass) &&
          (filter.region === undefined || r.region === filter.region),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  // Residency report: count of records per region for a tenant.
  residencyReport(tenantId: string): Record<string, number> {
    const report: Record<string, number> = {};
    for (const r of this.records.values()) {
      if (r.tenantId !== tenantId) continue;
      report[r.region] = (report[r.region] ?? 0) + 1;
    }
    return report;
  }
}
