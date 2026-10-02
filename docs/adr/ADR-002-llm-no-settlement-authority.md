# ADR-002: LLM Has No Settlement Authority

## Decision

LLM output is advisory. Settlement authority belongs to a deterministic policy engine plus PayPal adapter state machine.

## Rationale

LLM behavior is probabilistic and external commerce content is untrusted. Financial mutations require deterministic preconditions.
