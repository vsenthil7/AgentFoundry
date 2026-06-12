import { describe, it, expect } from "vitest";
import {
  exportProfile,
  importProfile,
  serializeProfileExport,
  deserializeProfileExport,
  verifyProfileExport,
  ProfileImportError,
} from "../src/profile_transfer.js";
import { TenantProfileStore } from "../src/tenant_profile.js";

function sourceProfile() {
  const store = new TenantProfileStore();
  store.set("staging-t1", {
    policyId: "baseline",
    quotaLimits: { limits: { agents: 10 } },
    retention: { retentionDays: { runtime_trace: 30 }, allowedRegions: ["eu"] },
    slaTarget: 0.99,
  });
  return store.set("staging-t1", {
    policyId: "high-risk",
    quotaLimits: { limits: { agents: 20 } },
    retention: { retentionDays: { runtime_trace: 90 }, allowedRegions: ["eu", "uk"] },
    slaTarget: 0.999,
  });
}

describe("exportProfile", () => {
  it("produces a checksummed envelope", () => {
    const exp = exportProfile(sourceProfile());
    expect(exp.version).toBe(1);
    expect(exp.sourceTenantId).toBe("staging-t1");
    expect(exp.sourceVersion).toBe(2);
    expect(exp.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses an injected clock", () => {
    const exp = exportProfile(sourceProfile(), () => "2026-06-09T13:00:00.000Z");
    expect(exp.exportedAt).toBe("2026-06-09T13:00:00.000Z");
  });
});

describe("verifyProfileExport", () => {
  it("validates an intact export", () => {
    expect(verifyProfileExport(exportProfile(sourceProfile()))).toBe(true);
  });

  it("detects tampering", () => {
    const exp = exportProfile(sourceProfile());
    exp.profile.slaTarget = 0.5;
    expect(verifyProfileExport(exp)).toBe(false);
  });
});

describe("serialization", () => {
  it("round-trips through serialize/deserialize", () => {
    const exp = exportProfile(sourceProfile());
    const restored = deserializeProfileExport(serializeProfileExport(exp));
    expect(verifyProfileExport(restored)).toBe(true);
    expect(restored.sourceVersion).toBe(2);
  });

  it("rejects an unrecognized envelope", () => {
    expect(() => deserializeProfileExport('{"version":2}')).toThrow(ProfileImportError);
  });
});

describe("importProfile", () => {
  it("imports into a target store as a new version", () => {
    const exp = exportProfile(sourceProfile());
    const target = new TenantProfileStore();
    const imported = importProfile(exp, "prod-t1", target);
    expect(imported.tenantId).toBe("prod-t1");
    expect(imported.version).toBe(1);
    expect(imported.policyId).toBe("high-risk");
    expect(imported.slaTarget).toBe(0.999);
  });

  it("appends a new version if the target tenant already has profiles", () => {
    const exp = exportProfile(sourceProfile());
    const target = new TenantProfileStore();
    target.set("prod-t1", { policyId: "baseline", quotaLimits: { limits: {} }, retention: { retentionDays: {}, allowedRegions: ["us"] }, slaTarget: 0.9 });
    expect(importProfile(exp, "prod-t1", target).version).toBe(2);
  });

  it("rejects a corrupted export", () => {
    const exp = exportProfile(sourceProfile());
    exp.profile.policyId = "TAMPERED";
    expect(() => importProfile(exp, "prod-t1", new TenantProfileStore())).toThrow(ProfileImportError);
  });

  it("rejects an export with invalid config", () => {
    // Build a valid export, then craft one whose profile is invalid but whose
    // checksum matches (so it passes integrity and reaches validation).
    const invalidProfile = { ...sourceProfile(), slaTarget: 2 } as never;
    const reExported = exportProfile(invalidProfile);
    expect(verifyProfileExport(reExported)).toBe(true); // integrity ok
    expect(() => importProfile(reExported, "prod-t1", new TenantProfileStore())).toThrow(ProfileImportError);
  });
});
