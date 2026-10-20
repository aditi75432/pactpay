# PactPay M0.11 — Catalog-Friendly Demo Intent and Explicit Price Semantics

## Goal

Replace the refurbished-laptop example with a broader, catalog-friendly wireless-mouse example and make the Purchase Pact accurately distinguish a Channel3 listing price from a final landed total.

## Default example

`Find a wireless mouse with a catalog item price at most $50 USD, in stock. Prefer Logitech.`

Other example chips:

- USB-C charger: catalog item price at most $40 USD, in stock, prefer Anker.
- Wireless headphones: catalog item price at most $100 USD, in stock, prefer Sony.

Channel3 documents live item prices and availability as core catalog-search data. No particular offer is guaranteed to meet a cap before the user's actual live search; PactPay must evaluate the current snapshot and show its verdict.

## Correctness changes

- Added separate review controls for `Catalog item price cap (for discovery)` and `Final landed total (if specified)`.
- Catalog item price caps compile to `attributes.itemPrice` with comparator `lte`.
- A landed-total cap compiles separately to `total` with comparator `lte`.
- The API normalizer receives the original user intent and re-derives numeric caps from that text, rather than trusting a model-supplied amount or letting a catalog item-price cap become an all-in total.
- Explicitly asked item-price amounts are normalized into `attributes.itemPrice`, even if the LLM returns a conflicting landed-total cap.
- The transparent local fallback recognizes catalog item-price language and searches cleanly for wireless mouse, USB-C charger and related product terms.
- If the user explicitly asks for both a catalog item-price cap and a landed-total cap, the two remain separate constraints.
- No shipping, tax, delivery, return or product-spec facts are invented. Unknown required evidence still remains unknown and cannot satisfy a hard settlement rule.

## Files in this patch

- `apps/web/app/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/app/api/intent/compile/route.ts`
- `lib/intent-pact.ts`
- `packages/pact-core/test/intent-pact.test.ts`

## Apply

Stop Next.js, extract the ZIP into the repository root (it contains repository-relative paths, no outer project directory), then run each command separately:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm test
pnpm dev
```

## Expected result

The default compiled Pact uses:

- Hard: `attributes.itemPrice <= 50`
- Hard: `attributes.availability == InStock`
- Hard: currency USD
- Soft: prefer Logitech
- No final landed-total cap unless the user explicitly supplies one

Discovery can pass the item-price and in-stock checks only when the selected current Channel3 snapshot actually supports them. This is a discovery screen, not a proof of final checkout total; payment settlement stays disabled in the live-catalog flow.

## Validation performed here

- TypeScript transpile/syntax checks passed for modified TS/TSX files.
- Focused runtime assertions passed for the local fallback, model-output normalization, explicit catalog price cap, in-stock rule, soft brand preference, both-cap scenarios, and the existing laptop prompt.
- Full workspace typecheck/test suite must still be run locally because this environment could not download pnpm/workspace dependencies.
