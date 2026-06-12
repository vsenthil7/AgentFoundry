# Deployment Guide

## Prerequisites
- Node.js 22+
- A Microsoft Foundry workspace + Foundry SDK credentials (for live deploy)
- A GitHub repository with Actions enabled (for the CI promotion gate)

## Local
```bash
make install     # backend + web deps
make ci          # engine tests (100% gate) + component tests + build + offline demo
make dev         # run the console at http://localhost:5173
```

## Promotion pipeline
1. Compose and validate the agent graph (compiler rejects unsafe wiring).
2. Auto-generate evals; run Battle Mode red-team.
3. Deterministic scoring → weighted threshold gate.
4. Human approval (immutable record). No agent self-promotes.
5. Export the Foundry manifest; CI runs the exported suite.
6. Branch protection requires CI green before merge (mirrors the promotion gate).

## Export to Foundry
The export manifest (`exportManifest`) is the deploy artifact. It round-trips
losslessly (verified in CI). Feed it to the Foundry SDK in your deploy job. Entra
agent identity + Foundry Control Plane observability attach at the runtime layer.

## Runtime
- Ingest runtime traces into the monitoring store.
- Drift detection + the regression gate run on a schedule; a regressed prior attack
  blocks re-promotion and raises an incident.
- Cost governance enforces per-run and total budgets; over-budget runs revoke the
  cost-efficient certification badge.
