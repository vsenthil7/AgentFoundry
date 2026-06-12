# Architecture

## Overview

AgentFoundry is a TypeScript monorepo. The **engine** is the single source of truth;
the **web console** imports it directly so the UI can never drift from tested logic.

```
agentfoundry/
├── backend/          # the engine — pure, deterministic, fully tested
│   ├── src/
│   │   ├── types.ts        # domain model (AgentDesign, SDLC controls, results)
│   │   ├── model.ts        # ModelAdapter boundary + deterministic StubModel
│   │   ├── compiler.ts     # graph validation + topological compile
│   │   ├── eval.ts         # case generation + deterministic run harness
│   │   ├── redteam.ts      # attack battery, framework mapping, anti-weaponization
│   │   ├── scoring.ts      # weighted scoring, provenance, flake quarantine
│   │   ├── promotion.ts    # human gate + immutable approval record
│   │   ├── export.ts       # Foundry manifest + round-trip fidelity
│   │   ├── seed.ts         # Acme Support Bot Golden Thread fixture
│   │   └── demo.ts         # offline end-to-end runner
│   └── tests/              # unit / functional / negative (100% coverage)
└── web/              # React console (Vite)
    ├── src/App.tsx         # the safety console
    ├── src/engine/         # vendored engine source
    ├── tests/              # Playwright E2E (web + mobile)
    └── tests-component/    # jsdom component tests (run in CI here)
```

## Key design principle: the LLM/engine boundary

The model **never** decides pass/fail. Its only jobs are (1) producing agent outputs
and (2) *proposing* candidate eval cases. A **deterministic scoring engine** computes
every score from raw results. This is what the tamper test verifies: feed a stub model
with known outputs and the computed score matches hand math exactly.

```
purpose ──▶ [LLM proposes cases] ──▶ editable eval suite
                                          │
agent outputs ──▶ [deterministic run] ──▶ raw results
                                          │
                                  [deterministic scoring]
                                          │
                                   weighted score + provenance
                                          │
                            [threshold gate] + [human gate]
```

## Determinism

- Graph compile uses Kahn's algorithm with sorted processing → stable topo order.
- Case generation is reproducible from the declared purpose.
- The StubModel maps known inputs to known outputs.
- Manifest serialization is canonical (recursively sorted keys) → byte-stable.

This makes every result reproducible and CI-gateable, and makes flakiness a *surfaced
feature* (seed + band width + quarantine threshold) rather than a hidden hazard.

## Sandbox model (designed; partially enforced in engine)

The StubModel produces no real side effects. The designed-agent's own write/send
capabilities are gated behind a HITL node, enforced by the compiler
(`MISSING_HITL_FOR_WRITE`) and reflected in the HITL-coverage score. Full network
isolation, connector allowlisting, and artifact quarantine are specified in
`THREAT_MODEL.md` and on the roadmap for runtime (S8).
