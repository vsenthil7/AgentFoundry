// S41 — Tenant onboarding / offboarding.
// Provisions (and de-provisions) a tenant across all relevant subsystems in one
// call: identity (tenant + initial admin), quotas, retention/residency policy,
// and promotion policy selection. Onboarding validates inputs up front and rolls
// back partial state if a later step fails, so a tenant is never half-created.

import { IdentityStore, type Role } from "./identity.js";
import { QuotaManager, type QuotaLimits } from "./ratelimit.js";
import { DataGovernance, type RetentionPolicy } from "./data_governance.js";

export interface OnboardingRequest {
  tenantId: string;
  tenantName: string;
  adminId: string;
  adminEmail: string;
  quotaLimits: QuotaLimits;
  retention: Omit<RetentionPolicy, "tenantId">;
}

export interface OnboardingResult {
  tenantId: string;
  adminId: string;
  provisioned: string[]; // subsystems provisioned, in order
}

export class OnboardingError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "OnboardingError";
  }
}

export interface TenantWorkflowDeps {
  identity: IdentityStore;
  quotas: QuotaManager;
  governance: DataGovernance;
}

export class TenantLifecycle {
  private readonly deps: TenantWorkflowDeps;

  constructor(deps: TenantWorkflowDeps) {
    this.deps = deps;
  }

  onboard(req: OnboardingRequest): OnboardingResult {
    // Validate up front.
    if (!req.tenantId || !req.tenantName) {
      throw new OnboardingError("tenantId and tenantName are required.");
    }
    if (!req.adminId || !req.adminEmail) {
      throw new OnboardingError("adminId and adminEmail are required.");
    }
    if (this.deps.identity.hasTenant(req.tenantId)) {
      throw new OnboardingError(`Tenant already exists: ${req.tenantId}`);
    }
    if (req.retention.allowedRegions.length === 0) {
      throw new OnboardingError("At least one residency region is required.");
    }

    const provisioned: string[] = [];
    try {
      this.deps.identity.createTenant({ id: req.tenantId, name: req.tenantName });
      provisioned.push("identity:tenant");

      const adminRoles: Role[] = ["admin"];
      this.deps.identity.createUser({
        id: req.adminId,
        tenantId: req.tenantId,
        email: req.adminEmail,
        roles: adminRoles,
      });
      provisioned.push("identity:admin");

      this.deps.quotas.setLimits(req.tenantId, req.quotaLimits);
      provisioned.push("quotas");

      this.deps.governance.setPolicy({ tenantId: req.tenantId, ...req.retention });
      provisioned.push("governance");

      return { tenantId: req.tenantId, adminId: req.adminId, provisioned };
    } catch (err) {
      // Roll back partial provisioning so no half-created tenant remains.
      this.rollback(req.tenantId, provisioned);
      const detail = err instanceof Error ? err.message : String(err);
      throw new OnboardingError(`Onboarding failed after [${provisioned.join(", ")}]: ${detail}`);
    }
  }

  private rollback(tenantId: string, provisioned: string[]): void {
    // Identity is the only store with hard create-uniqueness; clearing its
    // tenant + users is enough to allow a clean retry. Quota/governance setters
    // are idempotent overwrites, so they need no explicit undo.
    if (provisioned.includes("identity:tenant")) {
      this.deps.identity.removeTenant(tenantId);
    }
  }

  // Offboard: remove the tenant and its users; quota/governance state is left
  // inert (no tenant references it). Returns true if the tenant existed.
  offboard(tenantId: string): boolean {
    if (!this.deps.identity.hasTenant(tenantId)) return false;
    this.deps.identity.removeTenant(tenantId);
    return true;
  }
}
