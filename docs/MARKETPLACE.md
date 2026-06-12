# Marketplace (S10)

A catalog of publishable, consumable packs. The export manifest (S6) is the unit
of exchange; the certification tier (S9) is the trust signal that travels with a pack.

## Pack kinds
- **agent_template** — a full Foundry manifest (agent + eval suite + red-team suite)
- **eval_pack** — a reusable set of eval cases
- **redteam_pack** — a reusable attack battery

Every pack carries id, name, publisher, version, certification tier, and publish time.

## Publish
`publish(pack)` validates the payload (non-empty, well-formed for its kind) and rejects
duplicates. Validation throws `PackValidationError`; duplicates throw `DuplicatePackError`.

## Browse
`browse(filter)` supports filtering by kind, publisher, and minimum certification tier,
returned in deterministic id order. Tier gating lets an org expose only proven packs
(e.g. `minTier: "silver"` hides unproven `none`-tier packs).

## Consume — interoperability
`consume(id)` returns the **full payload**, not just metadata, so the consumer runs it
end-to-end. The interoperability test proves a consumed agent-template pack reproduces
the original's exact weighted score from the manifest alone — the pack is the real
artifact, not a cosmetic listing.

## Network effects
`consume` increments an install counter; `trending(limit)` ranks packs by installs with
id as a deterministic tiebreaker. This is the seed of the marketplace network effect
(S12): the most-trusted, most-used packs surface first.
