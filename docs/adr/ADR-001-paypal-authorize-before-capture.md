# ADR-001: Authorize Before Capture

## Decision

PactPay will create PayPal orders with `intent=AUTHORIZE` for the flagship flow and will capture only after verification passes.

## Rationale

PayPal's Orders v2 supports separate authorization and capture. Authorization places a hold, allowing later settlement after conditions are checked. This maps naturally to PactPay's verification gate.

## Consequences

- The demo can visibly distinguish funds reserved from funds captured.
- A failed verification must not reach capture.
- The implementation must handle authorization expiry and idempotent retries correctly.
