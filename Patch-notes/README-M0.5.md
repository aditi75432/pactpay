# PactPay M0.5 — Fresh Catalog Evidence & Offer Drift

This is an overlay patch. **Extract the ZIP directly into your existing `pactpay` project root.** The archive intentionally has no enclosing project folder. Merge/overwrite the included files when prompted.

## Changes

- Adds `POST /api/discovery/refresh`, which refreshes a product using Channel3's official `GET /v1/products/{product_id}` endpoint.
- Resolves the product ID from the server-stored snapshot, never from a user-supplied external URL.
- Matches the same product and merchant offer; when matching remains ambiguous, the refresh fails closed and never substitutes another merchant.
- Saves a successful refresh as a new immutable offer snapshot and persists a refresh comparison event in PostgreSQL in one transaction.
- Compares catalog-supported fields: title, item price, currency, availability, condition, and structured RAM.
- Adds a “Refresh catalog facts” control to `/discover`.
- Does not change PayPal orders or add a capture/void action.

## Apply

1. Stop `pnpm dev` with `Ctrl+C`.
2. Extract all archive contents directly into `D:\Downloads-D\Paypal\pactpay`.
3. Keep `apps/web/.env.local` unchanged; the existing server-side `CHANNEL3_API_KEY` is used.
4. Run from the project root:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm db:up
pnpm dev
```

5. Open `http://localhost:3000/discover`, search for `laptop`, click **Refresh catalog facts** on one result, and inspect the refresh outcome.

## Expected behavior

- If the same product and merchant offer is identified, PactPay stores a new snapshot and reports which catalog fields changed.
- If the exact offer cannot be identified uniquely, the response says `OFFER_NOT_FOUND`; the old snapshot is not modified and no new one is substituted.
- Shipping, final landed total, delivery date, return window, and fulfillment claims remain unverified by this operation. A fresh Channel3 response is only a fresh catalog observation.
- Every response declares `paymentAction: NONE` and `capturePerformedByPactPay: false`.

## Notes

The current freshness TTL of 60 seconds is a PactPay local policy, not Channel3's own source-update timestamp. The full application/database integration and a live Channel3 refresh must be verified in the developer's environment after applying the overlay.
