import type { AgentDesign, LifecycleState } from "./types.js";
import { AgentRegistry, type RegistryRecord } from "./registry.js";
import type { ApprovalRecord } from "./promotion.js";
import {
  type User,
  requirePermission,
  requireSameTenant,
} from "./identity.js";

// S13 — Governed registry: every action is gated by RBAC permission AND tenant
// isolation. The agent's tenant is taken from its cost-center-scoped tenant tag
// passed at registration; thereafter all access requires the same tenant.

export class GovernedRegistry {
  private readonly registry: AgentRegistry;
  // Map agentId -> owning tenantId for isolation checks.
  private readonly tenantOf = new Map<string, string>();

  constructor(now?: () => string) {
    this.registry = new AgentRegistry(now);
  }

  register(user: User, design: AgentDesign): RegistryRecord {
    requirePermission(user, "agent:create");
    const rec = this.registry.register(design, user.email);
    this.tenantOf.set(design.id, user.tenantId);
    return rec;
  }

  private guard(user: User, agentId: string): void {
    const tenant = this.tenantOf.get(agentId);
    if (tenant === undefined) {
      // Unknown agent: surface as a not-found via the underlying registry.
      this.registry.get(agentId);
    } else {
      requireSameTenant(user, tenant);
    }
  }

  read(user: User, agentId: string): RegistryRecord {
    requirePermission(user, "agent:read");
    this.guard(user, agentId);
    return this.registry.get(agentId);
  }

  requestPromotion(user: User, agentId: string): RegistryRecord {
    requirePermission(user, "agent:promote_request");
    this.guard(user, agentId);
    return this.registry.transition(agentId, "in_review", user.email, {
      note: "promotion requested",
    });
  }

  approve(
    user: User,
    agentId: string,
    approval: ApprovalRecord,
  ): RegistryRecord {
    requirePermission(user, "agent:approve");
    this.guard(user, agentId);
    return this.registry.transition(agentId, "approved", user.email, {
      approval,
      note: "approved",
    });
  }

  deploy(user: User, agentId: string, via: LifecycleState = "exported"): RegistryRecord {
    requirePermission(user, "agent:deploy");
    this.guard(user, agentId);
    // exported is a prerequisite of deployed; advance through it if needed.
    const current = this.registry.get(agentId);
    if (current.state === "approved" && via === "exported") {
      this.registry.transition(agentId, "exported", user.email);
    }
    return this.registry.transition(agentId, "deployed", user.email);
  }

  retire(user: User, agentId: string, note?: string): RegistryRecord {
    requirePermission(user, "agent:retire");
    this.guard(user, agentId);
    return this.registry.retire(agentId, user.email, note);
  }

  // List only agents within the user's tenant.
  list(user: User, filter?: Parameters<AgentRegistry["list"]>[0]): RegistryRecord[] {
    requirePermission(user, "agent:read");
    return this.registry
      .list(filter)
      .filter((r) => this.tenantOf.get(r.id) === user.tenantId);
  }

  // Escape hatch for governance reporting (still permission-gated).
  underlying(user: User): AgentRegistry {
    requirePermission(user, "governance:report");
    return this.registry;
  }
}
