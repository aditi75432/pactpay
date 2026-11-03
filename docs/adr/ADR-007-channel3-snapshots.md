# ADR-007: Persist exact Channel3 offer snapshots before evaluation


## Context

A browser can alter any price, condition, currency, or structured attribute it sends back to the server. Evaluation must therefore operate on a server-stored snapshot, not the client-rendered object.

## Decision

The server fetches Channel3 results, validates and normalizes each offer, stores the exact normalized data plus the raw product/offer records in PostgreSQL, and returns an opaque snapshot UUID. Evaluation receives only that UUID and reloads the stored snapshot. Evidence is linked to that snapshot ID and to the source offer URL.

## Consequences

- Offers have an attributable persisted record.
- The app can reproduce what was evaluated.
- The UI cannot silently alter amount/attributes to influence policy decisions.
- Snapshot retention requires cleanup/privacy policy before production scale.
- The local evidence TTL is explicitly a PactPay policy, not the provider's data-age guarantee.
