# ADR-003: M0 stops after PayPal authorization

## Decision

The first PayPal integration phase will create `AUTHORIZE` orders and call PayPal's authorize endpoint after payer approval, but will not expose any capture endpoint.

## Rationale

This isolates the financial control primitive and prevents us from accidentally coupling a still-incomplete product flow to an irreversible settlement action. PayPal documents authorization as a hold that can later be captured; PactPay will introduce capture only after persistent pact binding, verification, and deterministic policy enforcement are implemented.
