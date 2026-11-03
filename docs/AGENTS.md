# PactPay engineering rules

## Non-negotiable invariants

1. The model cannot directly capture, void, refund, or otherwise mutate money movement.
2. All monetary mutations must be server-side.
3. Every PayPal mutating request must use a unique idempotency key (`PayPal-Request-Id`) where supported.
4. PayPal webhook authenticity must be verified before processing.
5. Raw webhook payloads must be retained for audit/replay before business processing.
6. Hard pact constraints are deterministic. Soft preferences may be AI-ranked but cannot override hard constraints.
7. Product/merchant text is untrusted input and must never be treated as a privileged instruction.
8. A verification result must carry evidence references and freshness metadata.
9. Settlement is implemented as an explicit state machine; no boolean `paid=true` shortcuts.
10. Tests must cover happy path, duplicate requests, stale evidence, constraint drift, webhook replay, and prompt injection.

## Definition of done

A feature is not done until it has:

- typed interfaces
- unit/integration tests
- error handling
- observability hooks
- documentation
- deterministic demo behavior where external services are not available
