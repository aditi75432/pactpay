# ADR-010: Persist exact policy inputs and define a guarded settlement gate

## Context

The application had a deterministic policy evaluator and live offer/evidence records, but the live evaluator did not read human-reviewed evidence and policy runs did not persist their complete pact input. Transaction audit entries were stored but not hash-chained.

## Decision

1. Build live evaluations using server-stored Channel3 snapshots plus evidence rows whose latest decision is `HUMAN_REVIEWED` and whose source was attested as inspected.
2. Preserve timestamps, validity bounds, field identity, source URL/domain, and snapshot subject references so the existing evaluator can detect staleness and conflicts.
3. Store the exact pact specification and a deterministic hash with each policy run.
4. Hash-chain audit events per transaction and expose chain verification status.
5. Define a typed transition graph and a pure fail-closed settlement gate.
6. Do not add capture until the exact approved pact, offer snapshot, verified total, evidence and authorization are bound to a persisted transaction and re-evaluated by the server at the point of settlement.

## Consequences

- Live evidence becomes decision-relevant instead of merely stored.
- Policy inputs can be inspected/reproduced later.
- Audit alterations can be detected if the expected chain head is retained separately.
- Capture remains intentionally unavailable in this milestone; M0.8 must implement and test the transaction-bound gate before any financial mutation.
