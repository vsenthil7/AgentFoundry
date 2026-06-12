// S70 — Scheduled compliance-pack snapshots.
// A scheduler job (S26) that periodically generates a compliance pack (S57) for a
// tenant and retains a bounded history of snapshots. Gives auditors a time series
// of the platform's compliance posture, not just a point-in-time view.

import type { CompliancePack } from "./compliance_pack.js";
import type { JobDefinition } from "./scheduler.js";

export interface CompliancePackRetention {
  maxSnapshots: number;
}

export class CompliancePackArchive {
  private readonly snapshots: CompliancePack[] = [];
  private readonly retention: CompliancePackRetention;

  constructor(retention: CompliancePackRetention = { maxSnapshots: 12 }) {
    if (retention.maxSnapshots <= 0) {
      throw new Error("maxSnapshots must be positive.");
    }
    this.retention = retention;
  }

  add(pack: CompliancePack): void {
    this.snapshots.push(pack);
    while (this.snapshots.length > this.retention.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  list(): readonly CompliancePack[] {
    return this.snapshots;
  }

  latest(): CompliancePack | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  count(): number {
    return this.snapshots.length;
  }
}

export interface CompliancePackSnapshotDeps {
  archive: CompliancePackArchive;
  generate: () => CompliancePack;
}

export function runCompliancePackSnapshot(deps: CompliancePackSnapshotDeps): CompliancePack {
  const pack = deps.generate();
  deps.archive.add(pack);
  return pack;
}

export function compliancePackSnapshotJob(
  id: string,
  intervalMs: number,
  deps: CompliancePackSnapshotDeps,
): JobDefinition {
  return {
    id,
    intervalMs,
    task: () => {
      const pack = runCompliancePackSnapshot(deps);
      return `compliance snapshot stored for ${pack.tenantId}; ${deps.archive.count()} retained`;
    },
  };
}
