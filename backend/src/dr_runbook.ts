// S55 — DR runbook generator.
// Composes the platform's disaster-recovery posture into a one-page, operator-
// ready runbook: backup retention/freshness (S48), latest restore-drill outcome
// (S50), and replication status (S40). Pure assembly over injected snapshots so
// it stays deterministic.

export interface DrPosture {
  backups: {
    retained: number;
    maxRetained: number;
    latestAt: string | null;
  };
  restoreDrill: {
    lastRun: string | null;
    passed: boolean | null; // null = never run
    entriesVerified: number;
  };
  replication: {
    primaryUp: boolean;
    replicaCount: number;
    healthyReplicas: number;
    lag: number;
  };
}

export type DrReadiness = "ready" | "at_risk" | "not_ready";

export interface DrRunbook {
  readiness: DrReadiness;
  warnings: string[];
  markdown: string;
  generatedAt: string;
}

export class DrRunbookGenerator {
  private readonly now: () => string;

  constructor(now: () => string = () => new Date(0).toISOString()) {
    this.now = now;
  }

  assess(posture: DrPosture): { readiness: DrReadiness; warnings: string[] } {
    const warnings: string[] = [];

    if (posture.backups.retained === 0) {
      warnings.push("No backups retained — cannot recover from data loss.");
    }
    if (posture.restoreDrill.passed === null) {
      warnings.push("Restore drill never run — backup recoverability unverified.");
    } else if (posture.restoreDrill.passed === false) {
      warnings.push("Last restore drill FAILED — backups may be unrecoverable.");
    }
    if (!posture.replication.primaryUp) {
      warnings.push("Primary storage node is down.");
    }
    if (posture.replication.healthyReplicas === 0 && posture.replication.replicaCount > 0) {
      warnings.push("No healthy replicas — no failover target available.");
    }
    if (posture.replication.lag > 0) {
      warnings.push(`Replication lag: ${posture.replication.lag} pending write(s).`);
    }

    // Readiness: not_ready if recovery is impossible; at_risk if degraded.
    let readiness: DrReadiness = "ready";
    const fatal =
      posture.backups.retained === 0 ||
      posture.restoreDrill.passed === false ||
      !posture.replication.primaryUp;
    if (fatal) {
      readiness = "not_ready";
    } else if (warnings.length > 0) {
      readiness = "at_risk";
    }

    return { readiness, warnings };
  }

  generate(posture: DrPosture): DrRunbook {
    const { readiness, warnings } = this.assess(posture);
    const generatedAt = this.now();

    const lines: string[] = [];
    lines.push(`# Disaster Recovery Runbook`);
    lines.push("");
    lines.push(`**Readiness:** ${readiness.toUpperCase().replace("_", " ")}`);
    lines.push(`**Generated:** ${generatedAt}`);
    lines.push("");

    if (warnings.length > 0) {
      lines.push(`## ⚠ Warnings`);
      for (const w of warnings) lines.push(`- ${w}`);
      lines.push("");
    }

    lines.push(`## Backup posture`);
    lines.push(`- Retained snapshots: ${posture.backups.retained} / ${posture.backups.maxRetained}`);
    lines.push(`- Latest snapshot: ${posture.backups.latestAt ?? "none"}`);
    lines.push("");

    lines.push(`## Restore verification`);
    lines.push(
      `- Last drill: ${posture.restoreDrill.lastRun ?? "never"}` +
        (posture.restoreDrill.passed === null
          ? " (not run)"
          : posture.restoreDrill.passed
            ? ` (passed, ${posture.restoreDrill.entriesVerified} entries)`
            : " (FAILED)"),
    );
    lines.push("");

    lines.push(`## Replication`);
    lines.push(`- Primary: ${posture.replication.primaryUp ? "up" : "DOWN"}`);
    lines.push(`- Healthy replicas: ${posture.replication.healthyReplicas} / ${posture.replication.replicaCount}`);
    lines.push(`- Replication lag: ${posture.replication.lag}`);
    lines.push("");

    lines.push(`## Recovery procedure`);
    lines.push(`1. If the primary is down, promote a healthy replica to primary.`);
    lines.push(`2. If data is lost, restore the latest verified backup into a fresh primary.`);
    lines.push(`3. Re-point replicas at the new primary and run sync to clear lag.`);
    lines.push(`4. Run a restore drill to confirm recoverability before resuming writes.`);

    return { readiness, warnings, markdown: lines.join("\n"), generatedAt };
  }
}
