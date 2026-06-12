import type { FoundryManifest } from "./export.js";
import type { EvalCase } from "./eval.js";
import type { AttackCase } from "./redteam.js";
import type { CertificationTier } from "./certification.js";

// S10 — Marketplace.
// Three pack kinds are publishable and consumable: a full agent template
// (manifest), an eval pack, and a red-team pack. Packs carry provenance and a
// certification tier as a trust signal. Consuming a pack returns its payload so
// it runs end-to-end (interoperability), not a cosmetic listing.

export type PackKind = "agent_template" | "eval_pack" | "redteam_pack";

export interface PackMeta {
  readonly id: string;
  readonly kind: PackKind;
  readonly name: string;
  readonly publisher: string;
  readonly version: string;
  readonly certificationTier: CertificationTier;
  readonly publishedAt: string;
}

export interface AgentTemplatePack extends PackMeta {
  readonly kind: "agent_template";
  readonly manifest: FoundryManifest;
}

export interface EvalPack extends PackMeta {
  readonly kind: "eval_pack";
  readonly cases: readonly EvalCase[];
}

export interface RedTeamPack extends PackMeta {
  readonly kind: "redteam_pack";
  readonly attacks: readonly AttackCase[];
}

export type Pack = AgentTemplatePack | EvalPack | RedTeamPack;

export class PackValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PackValidationError";
  }
}

export class PackNotFoundError extends Error {
  constructor(id: string) {
    super(`Pack not found: ${id}`);
    this.name = "PackNotFoundError";
  }
}

export class DuplicatePackError extends Error {
  constructor(id: string) {
    super(`Pack already published: ${id}`);
    this.name = "DuplicatePackError";
  }
}

// Validate a pack's payload is non-empty and well-formed before publishing.
function validatePack(pack: Pack): void {
  if (!pack.id || !pack.name || !pack.publisher) {
    throw new PackValidationError("Pack requires id, name, and publisher.");
  }
  if (pack.kind === "agent_template") {
    if (!pack.manifest || !pack.manifest.agent) {
      throw new PackValidationError("Agent template pack requires a manifest.");
    }
  } else if (pack.kind === "eval_pack") {
    if (pack.cases.length === 0) {
      throw new PackValidationError("Eval pack must contain at least one case.");
    }
  } else {
    if (pack.attacks.length === 0) {
      throw new PackValidationError("Red-team pack must contain at least one attack.");
    }
  }
}

export interface CatalogFilter {
  kind?: PackKind;
  publisher?: string;
  minTier?: CertificationTier;
}

const TIER_RANK: Record<CertificationTier, number> = {
  none: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
};

export class Marketplace {
  private readonly catalog = new Map<string, Pack>();
  // Consumption counter per pack — network-effect signal.
  private readonly installs = new Map<string, number>();

  publish(pack: Pack): Pack {
    if (this.catalog.has(pack.id)) throw new DuplicatePackError(pack.id);
    validatePack(pack);
    this.catalog.set(pack.id, pack);
    this.installs.set(pack.id, 0);
    return pack;
  }

  has(id: string): boolean {
    return this.catalog.has(id);
  }

  // Browse the catalog with optional filters. Deterministic order by id.
  browse(filter: CatalogFilter = {}): Pack[] {
    let packs = [...this.catalog.values()];
    if (filter.kind) packs = packs.filter((p) => p.kind === filter.kind);
    if (filter.publisher)
      packs = packs.filter((p) => p.publisher === filter.publisher);
    if (filter.minTier) {
      const min = TIER_RANK[filter.minTier];
      packs = packs.filter((p) => TIER_RANK[p.certificationTier] >= min);
    }
    return packs.sort((a, b) => a.id.localeCompare(b.id));
  }

  // Consume a pack: increments install count and returns the full payload so
  // the consumer can run it (interoperability), not just view metadata.
  consume(id: string): Pack {
    const pack = this.catalog.get(id);
    if (!pack) throw new PackNotFoundError(id);
    // installs is set in lockstep with catalog in publish(), so it is present here.
    this.installs.set(id, this.installs.get(id)! + 1);
    return pack;
  }

  installCount(id: string): number {
    if (!this.catalog.has(id)) throw new PackNotFoundError(id);
    return this.installs.get(id)!;
  }

  // Trending: most-installed first, ties broken by id for determinism.
  trending(limit = 10): Pack[] {
    return [...this.catalog.values()]
      .sort((a, b) => {
        const d = this.installs.get(b.id)! - this.installs.get(a.id)!;
        return d !== 0 ? d : a.id.localeCompare(b.id);
      })
      .slice(0, limit);
  }

  size(): number {
    return this.catalog.size;
  }
}
