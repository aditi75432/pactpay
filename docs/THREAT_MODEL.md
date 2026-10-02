# PactPay Threat Model

## Assets

- user monetary authorization
- pact constraints
- PayPal authorization/capture identifiers
- product/offer data
- evidence and audit trail

## Threats

| Threat | Example | Primary control |
|---|---|---|
| Prompt injection | merchant text tells agent to ignore budget | trust-boundary isolation + deterministic gate |
| Constraint drift | price increases after authorization | execution-time re-evaluation |
| Product substitution | 16GB becomes 8GB | item-level evidence comparison |
| Deadline drift | Friday becomes Monday | temporal constraint evaluator |
| Stale evidence | old price reused | evidence freshness TTL |
| Replay | duplicated PayPal webhook | signature + event-id deduplication |
| Duplicate mutation | capture request retried | PayPal-Request-Id idempotency |
| Model hallucination | invented merchant facts | structured external data + evidence requirement |
| Client tampering | browser says "capture" | server-side authorization and gate |

## Security principle

No single probabilistic model output is sufficient to authorize irreversible financial mutation.
