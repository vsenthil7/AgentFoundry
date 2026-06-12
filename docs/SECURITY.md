# Security Policy

## Reporting
Report vulnerabilities to the repository owner via a private security advisory.
Do not open public issues for security reports.

## Engine security properties
- Model outputs are never trusted to decide pass/fail (tamper-resistant scoring).
- Red-team is constrained to the user's own design (anti-weaponization, tested).
- Write/send capabilities require a human-in-the-loop gate (compile-time enforced).
- Exports are canonical and round-trip verified (no silent mutation).

## Sandbox (runtime, roadmap S8)
No real external side effects by default · mocked tools · network isolation ·
allowlisted connectors · synthetic data only · run-level timeout · token/cost cap ·
full trace capture · artifact quarantine.

## Supported frameworks for red-team mapping
OWASP LLM Top 10 · MITRE ATLAS · NIST AI RMF. Coverage gaps are reported, not hidden.
