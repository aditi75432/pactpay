# ADR-008: Refresh catalog facts through Channel3 Product Detail



## Context

Channel3 search results are useful for discovery, but an offer snapshot can age or drift after discovery. The existing policy evaluator correctly blocks unknown fulfillment facts, yet we also need a reproducible way to re-check the catalog-facing facts without trusting browser-supplied prices or merchant substitutions.

## Decision

Use Channel3's documented `GET /v1/products/{product_id}` endpoint as a refresh source. Derive the product ID and original merchant identity from the server-stored snapshot. Match the same product+merchant, preferably by canonical offer URL path. Ambiguity fails closed. Each successful refresh creates a new snapshot and comparison row atomically; the previous snapshot stays immutable.

## Consequences

- Current catalog price/availability/condition/structured attributes can be observed again.
- Price and attribute drift become visible and testable.
- Unknown shipping, final checkout total, delivery, returns, and fulfillment remain unknown.
- This does not authorize or capture a payment.
- If product-detail response matching is ambiguous, the user must run a fresh search instead of allowing a merchant swap.

## Reference

Channel3 Product Detail guide: https://docs.trychannel3.com/guides/product-detail
Channel3 Product Detail API: https://docs.trychannel3.com/api-reference/v1/product-detail
