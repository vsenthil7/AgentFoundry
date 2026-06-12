import { describe, it, expect } from "vitest";
import {
  buildAuditExport,
  verifyAuditExport,
  summarizeAuditExport,
  signBundle,
} from "../src/audit_export.js";
import { AuditLedger } from "../src/persistence.js";
import type { PlatformEvent } from "../src/events.js";

function ledgerWith(n: number): AuditLedger {
  const l = new AuditLedger();
  for (let i = 0; i < n; i++) {
    l.append({ actor: "t1", action: "create", subject: `agent-${i}` });
  }
  return l;
}

function events(): PlatformEvent[] {
  return [
    { id: "e0", type: "agent.registered", tenantId: "t1", subject: "a", payload: {}, timestamp: new Date(0).toISOString() },
    { id: "e1", type: "agent.deployed", tenantId: "t1", subject: "a", payload: {}, timestamp: new Date(0).toISOString() },
    { id: "e2", type: "agent.deployed", tenantId: "t1", subject: "b", payload: {}, timestamp: new Date(0).toISOString() },
  ];
}

const SECRET = "compliance-secret";

describe("buildAuditExport", () => {
  it("bundles ledger entries and events with a signature", () => {
    const bundle = buildAuditExport(SECRET, {
      tenantId: "t1",
      ledgerEntries: ledgerWith(2).list(),
      events: events(),
    });
    expect(bundle.version).toBe(1);
    expect(bundle.ledgerEntries).toHaveLength(2);
    expect(bundle.events).toHaveLength(3);
    expect(bundle.signature.startsWith("sha256=")).toBe(true);
  });

  it("uses an injected clock", () => {
    const bundle = buildAuditExport(SECRET, { tenantId: "t1", ledgerEntries: [], events: [] }, () => "2026-06-09T11:00:00.000Z");
    expect(bundle.exportedAt).toBe("2026-06-09T11:00:00.000Z");
  });
});

describe("verifyAuditExport", () => {
  it("verifies an intact bundle", () => {
    const bundle = buildAuditExport(SECRET, { tenantId: "t1", ledgerEntries: ledgerWith(2).list(), events: events() });
    expect(verifyAuditExport(SECRET, bundle)).toBe(true);
  });

  it("rejects a tampered event", () => {
    const bundle = buildAuditExport(SECRET, { tenantId: "t1", ledgerEntries: [], events: events() });
    bundle.events[0].subject = "TAMPERED";
    expect(verifyAuditExport(SECRET, bundle)).toBe(false);
  });

  it("rejects a tampered ledger entry", () => {
    const bundle = buildAuditExport(SECRET, { tenantId: "t1", ledgerEntries: ledgerWith(1).list(), events: [] });
    // Ledger entries are frozen; a real tamper replaces the array element.
    bundle.ledgerEntries[0] = { ...bundle.ledgerEntries[0], action: "delete" };
    expect(verifyAuditExport(SECRET, bundle)).toBe(false);
  });

  it("rejects verification with the wrong secret", () => {
    const bundle = buildAuditExport(SECRET, { tenantId: "t1", ledgerEntries: [], events: events() });
    expect(verifyAuditExport("wrong-secret", bundle)).toBe(false);
  });

  it("detects a tampered tenantId", () => {
    const bundle = buildAuditExport(SECRET, { tenantId: "t1", ledgerEntries: [], events: [] });
    bundle.tenantId = "t2";
    expect(verifyAuditExport(SECRET, bundle)).toBe(false);
  });
});

describe("signBundle", () => {
  it("is deterministic for the same payload", () => {
    expect(signBundle(SECRET, "x")).toBe(signBundle(SECRET, "x"));
  });
});

describe("summarizeAuditExport", () => {
  it("summarizes counts and action breakdown", () => {
    const bundle = buildAuditExport(SECRET, { tenantId: "t1", ledgerEntries: ledgerWith(2).list(), events: events() });
    const summary = summarizeAuditExport(bundle);
    expect(summary.ledgerEntryCount).toBe(2);
    expect(summary.eventCount).toBe(3);
    expect(summary.actionsByType["agent.deployed"]).toBe(2);
    expect(summary.actionsByType["agent.registered"]).toBe(1);
  });
});
