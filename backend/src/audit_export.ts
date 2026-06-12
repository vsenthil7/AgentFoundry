// S52 — Consolidated audit export.
// Bundles the tamper-evident audit ledger (S14) and platform events (S21) into a
// single, signed, verifiable export for a compliance reviewer. The bundle is
// HMAC-signed so a reviewer can confirm it wasn't altered after export.

import { createHmac } from "node:crypto";
import type { AuditEntry } from "./persistence.js";
import type { PlatformEvent } from "./events.js";

export interface AuditExportBundle {
  version: 1;
  exportedAt: string;
  tenantId: string;
  ledgerEntries: AuditEntry[];
  events: PlatformEvent[];
  // SHA-256 HMAC over the canonical payload.
  signature: string;
}

export interface AuditExportInput {
  tenantId: string;
  ledgerEntries: readonly AuditEntry[];
  events: readonly PlatformEvent[];
}

function canonical(input: {
  tenantId: string;
  exportedAt: string;
  ledgerEntries: readonly AuditEntry[];
  events: readonly PlatformEvent[];
}): string {
  return JSON.stringify({
    tenantId: input.tenantId,
    exportedAt: input.exportedAt,
    ledgerEntries: input.ledgerEntries,
    events: input.events,
  });
}

export function signBundle(secret: string, payload: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

// Build a signed audit export bundle.
export function buildAuditExport(
  secret: string,
  input: AuditExportInput,
  now: () => string = () => new Date(0).toISOString(),
): AuditExportBundle {
  const exportedAt = now();
  const ledgerEntries = [...input.ledgerEntries];
  const events = [...input.events];
  const payload = canonical({ tenantId: input.tenantId, exportedAt, ledgerEntries, events });
  return {
    version: 1,
    exportedAt,
    tenantId: input.tenantId,
    ledgerEntries,
    events,
    signature: signBundle(secret, payload),
  };
}

// Verify a bundle's signature (and thus that it wasn't altered after export).
export function verifyAuditExport(secret: string, bundle: AuditExportBundle): boolean {
  const payload = canonical({
    tenantId: bundle.tenantId,
    exportedAt: bundle.exportedAt,
    ledgerEntries: bundle.ledgerEntries,
    events: bundle.events,
  });
  return signBundle(secret, payload) === bundle.signature;
}

// Summarize a bundle for a reviewer (counts + action breakdown).
export interface AuditExportSummary {
  tenantId: string;
  ledgerEntryCount: number;
  eventCount: number;
  actionsByType: Record<string, number>;
}

export function summarizeAuditExport(bundle: AuditExportBundle): AuditExportSummary {
  const actionsByType: Record<string, number> = {};
  for (const e of bundle.events) {
    actionsByType[e.type] = (actionsByType[e.type] ?? 0) + 1;
  }
  return {
    tenantId: bundle.tenantId,
    ledgerEntryCount: bundle.ledgerEntries.length,
    eventCount: bundle.events.length,
    actionsByType,
  };
}
