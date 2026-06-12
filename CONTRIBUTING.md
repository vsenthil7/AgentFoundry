# Contributing

## Workflow
1. Branch from `main`.
2. Make changes with tests. Coverage gate is 100% on the engine.
3. `make ci` must pass locally (engine + web + build + offline demo).
4. Open a PR. CI runs engine tests, component tests, build, and Playwright E2E.
5. Branch protection: all checks green before merge (mirrors the agent promotion gate).

## Code rules
- The engine stays pure and deterministic. No network in engine code.
- Model outputs never decide pass/fail — that's the scoring engine's job.
- New red-team attacks MUST carry an OWASP/ATLAS/NIST mapping (coverage matrix is gated).
- New validation paths need a negative test asserting the error code.
