# ADR-005: Deterministic Pact Evaluation


## Context

A language model may extract user intent or explain decisions, but model-generated prose cannot be the source of authority for an irreversible payment operation. The system needs a deterministic, unit-testable function that evaluates a typed purchase pact against a specific offer snapshot and evidence set.

## Decision

Implement `evaluatePact` in `@pactpay/pact-core`. The evaluator returns per-constraint `pass`, `fail`, or `unknown` outcomes and global evidence freshness, evidence attribution, and security flags. `decideSettlement` remains pure and returns only a policy recommendation; no payment adapter is imported by this package.

Hard constraints fail closed on `fail` or `unknown`. Soft preferences are reported but do not block when all hard preconditions pass. Missing severity on older results defaults to `hard`. Evidence must bind to the exact offer ID and field, have valid timestamps and a source reference, and agree with the offer snapshot.

## Consequences

- Payment and AI code can call the pure evaluator without granting it payment credentials.
- Evaluations are deterministic under a fixed `now` value and can be benchmarked.
- Source adapters must normalize product/offer fields and attach evidence metadata before evaluation.
- The policy decision is not itself settlement, and M0.2 does not add a capture endpoint.
