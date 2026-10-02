# PactPay Architecture

## Logical flow

```text
User Intent
   |
   v
Intent Compiler (LLM)
   |
   v
Structured Purchase Pact
   |
   +----------------------+
   |                      |
   v                      v
Shopping Agent       Policy Engine
   |                      |
   +----------+-----------+
              v
       Offer Selection
              |
              v
       PayPal Order
        intent=AUTHORIZE
              |
              v
       PayPal Authorization
              |
             HOLD
              |
              v
      Evidence Collector
              |
              v
       Semantic Verifier
              |
              v
      Deterministic Gate
          /        \
       BLOCK       PASS
         |           |
       VOID       CAPTURE
         \           /
          v         v
          Audit Event Ledger
                |
                v
         AG Grid Control Center
```

## Trust boundaries

### Trusted
- PactPay server
- deterministic policy engine
- PayPal API responses after TLS/authentication
- verified PayPal webhooks

### Untrusted
- LLM output before schema validation
- product descriptions
- merchant messages
- external webpages
- user-provided evidence
- browser/client input

## Settlement state machine

`DRAFT -> OFFER_SELECTED -> ORDER_CREATED -> AUTHORIZED -> VERIFYING -> BLOCKED | CAPTURE_ELIGIBLE -> CAPTURED -> COMPLETED`

Failure states are explicit and terminal where appropriate. Any retry must be idempotent.
