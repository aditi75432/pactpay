# ADR-004: Persisted payment state and verified webhooks


## Context

The initial M0 proof created an Orders v2 `AUTHORIZE` order and authorized it after buyer approval, but transaction context lived primarily in the request/response flow. The approval callback could be repeated, and the local system did not bind the PayPal order to a persisted PactPay transaction.

## Decision

1. Persist a local transaction in PostgreSQL before creating the PayPal order.
2. Bind the PayPal order to the local transaction and include the local transaction ID in PayPal order metadata and the return URL.
3. Require both the PayPal order ID and the local transaction ID at the authorization endpoint; reject unbound IDs.
4. Use a database conditional state transition to claim an authorization attempt and a stable `PayPal-Request-Id` for both create-order and authorize-order mutations.
5. Store the PayPal order ID and nested payment authorization ID separately.
6. Mark the local transaction `AUTHORIZED` only when the authorization resource exists, its status is `CREATED`, and amount/currency match the persisted transaction. Otherwise use `AUTHORIZATION_REVIEW`.
7. Verify webhook signatures with PayPal before storing or acting on events; deduplicate by webhook event ID.
8. Do not add a capture route in M0.1.

## Consequences

- Local state and audit history survive app restarts.
- Duplicate browser callbacks do not intentionally issue concurrent authorization operations.
- PayPal's order/authorization identifiers are not conflated.
- The webhook receiver can be safely configured only after it has a public HTTPS URL and the associated Sandbox webhook ID.
- PostgreSQL is required for local M0.1 testing. Session ownership/authentication and production-grade migrations remain prerequisites before treating this as production-ready.
