# AgentFoundry

**Agent Design, Evaluation, Safety & Lifecycle Operating System.**
Building an agent and proving it safe are the *same* workflow.

Track: Creative Apps (GitHub Copilot) · IQ: Foundry IQ (grounding) + Fabric IQ.

## The wedge

Most tools help you *build* an agent. AgentFoundry treats build and safety as one
shift-left workflow on a real lifecycle/CI spine:

```
Design → Evaluate → Red Team → Approve → Export → Deploy → Monitor → Regress → Retire
```

## What runs today

- **Engine** (`backend/`): graph compiler, eval generation + run harness, Battle Mode
  red-team with OWASP/ATLAS/NIST mapping, deterministic weighted scoring with provenance,
  human promotion gate, Foundry manifest export, agent registry with lifecycle state
  machine + lineage, runtime monitoring with drift detection + regression gate.
- **Web console** (`web/`): an instrument-panel UI that drives the engine through the
  full Golden Thread, responsive to mobile.
- **Offline demo**: `make demo-offline` walks the seed agent end-to-end, zero network.

## Quick start

```bash
make install      # install backend + web deps
make test         # backend unit/functional/negative (100% coverage gate)
make test-web     # web component tests (jsdom)
make demo-offline # walk the Golden Thread with no network
make dev          # run the web console at http://localhost:5173
make e2e          # Playwright web + mobile (needs browser binaries; see docs/KNOWN_GAPS.md)
```

## The Golden Thread (definition of "submittable")

Seed agent **Acme Support Bot**, walked: compose → declare purpose → auto-generate evals
→ Battle Mode (injection + PII-exfil, each framework-tagged) → measured failures →
wire Foundry IQ + PII guardrail → re-measure (scores move) → toggle Foundry IQ off
(grounded-accuracy measurably falls) → reviewer approves → export → CI runs the suite
green → registry shows it with lineage.

## Differentiator tests

| Test | What it proves |
|------|----------------|
| Tamper test | Score is *computed* from known outputs, not theatrical |
| Remove-the-source | Grounding measurably lowers hallucination (1.000→0.000) |
| Round-trip fidelity | Export is the real artifact, not a lossy cosmetic dump |
| Anti-weaponization | Red-team refuses external / third-party targets |

## Docs

`docs/ARCHITECTURE.md` · `docs/THREAT_MODEL.md` · `docs/SCORING.md` · `docs/MARKETPLACE.md` ·
`docs/AGENT_SDLC.md` · `docs/REGISTRY_AND_MONITORING.md` · `docs/COST_AND_CERTIFICATION.md` · `docs/MARKETPLACE.md` ·
`docs/DEPLOYMENT_GUIDE.md` · `docs/ADMIN_GUIDE.md` · `docs/SECURITY.md` · `docs/SECURITY_REVIEW_PACK.md` ·
`docs/SAMPLE_GOVERNANCE_REPORT.md` · `docs/TESTING.md` · `docs/ROADMAP.md` · `docs/KNOWN_GAPS.md` · `docs/SEED_MANIFEST.md`

## License

See `LICENSE`.
