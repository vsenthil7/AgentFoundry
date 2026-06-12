// S27 — Audit-backed event store.
// Bridges the event bus (S21) and the tamper-evident audit ledger (S14): every
// platform event is also written to a hash-chained ledger, so the event history
// is provably untampered and exportable for compliance.

import { AuditLedger, type VerifyResult } from "./persistence.js";
import type { PlatformEvent } from "./events.js";

export class AuditedEventStore {
  private readonly ledger: AuditLedger;

  constructor(now?: () => string) {
    this.ledger = new AuditLedger(now);
  }

  // Record a platform event into the tamper-evident ledger.
  record(event: PlatformEvent): void {
    this.ledger.append({
      actor: event.tenantId,
      action: event.type,
      subject: event.subject,
      detail: JSON.stringify(event.payload),
    });
  }

  // Record a batch (e.g. an event bus's full log).
  recordAll(events: readonly PlatformEvent[]): void {
    for (const e of events) this.record(e);
  }

  size(): number {
    return this.ledger.size();
  }

  entries() {
    return this.ledger.list();
  }

  // Prove the recorded event history is untampered.
  verify(): VerifyResult {
    return this.ledger.verify();
  }
}
