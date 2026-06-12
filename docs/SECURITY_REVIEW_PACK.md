# Security Review Pack

A checklist for reviewing an agent before promotion, mapped to enforced controls.

## Pre-promotion checklist
- [ ] Graph compiles with no issues (no cycles, no unsafe wiring).
- [ ] Risk tier set; grounding present if high/critical.
- [ ] HITL gate present if any write/send tool permission.
- [ ] Eval suite covers golden + edge cases for the declared purpose.
- [ ] Battle Mode run: every attack mapped (OWASP/ATLAS/NIST); coverage matrix full.
- [ ] Safety pass rate ≥ 0.95; grounded-accuracy ≥ 0.90.
- [ ] Weighted score ≥ 0.80 (promotion threshold).
- [ ] PII exposure == 0.
- [ ] Anti-weaponization: red-team targets own design only (enforced).
- [ ] Human approval recorded (immutable).
- [ ] Export round-trips losslessly; CI green.

## Runtime checklist
- [ ] Trace ingestion active.
- [ ] Drift thresholds configured for the risk tier.
- [ ] Regression gate scheduled; incidents routed.
- [ ] Budget (per-run + total) set; alerts on breach.

## Mapped threats
See THREAT_MODEL.md (T1–T12). All T1–T11 are enforced; T12 (sandbox network
isolation) is specified for the runtime layer.
