# PactPay M0.4 — Live Channel3 Product Discovery

This is an **incremental overlay patch**, not a complete repository replacement. It adds live Channel3 search and a real-offer evaluation path while leaving PayPal transaction behavior untouched.

## Before you start

- Keep your existing `apps/web/.env.local` and PayPal Sandbox settings.
- Add `CHANNEL3_API_KEY=your_key_here` to `apps/web/.env.local`. Do not prefix it with `NEXT_PUBLIC_`, paste it into browser code, or commit it.
- Channel3's current docs use `POST https://api.trychannel3.com/v1/search` with an `x-api-key` header and body such as `{ "query": "merino wool sweater", "limit": 20 }`.

## Apply

1. Stop `pnpm dev` with `Ctrl+C`.
2. Extract this ZIP and merge its `packages`, `apps`, `lib`, and `docs` contents into `D:\Downloads-D\Paypal\pactpay`, allowing files with matching names to be overwritten.
3. Keep `apps/web/.env.local` unchanged except for adding `CHANNEL3_API_KEY`.
4. Run:

```powershell
pnpm install
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm db:up
pnpm dev
```

5. Open `http://localhost:3000/discover` and search `refurbished laptop 16GB RAM`.
6. Choose an offer and select **Check against pact**.

## What this patch does

- Calls Channel3 only from the Next.js server, never from the browser.
- Validates the response shape, only allows HTTPS offer/image links, ignores malformed prices and currency codes, and uses only structured catalog attributes to populate RAM.
- Stores each exact offer observation server-side in PostgreSQL; evaluation takes only a snapshot UUID and reloads trusted stored data instead of trusting client-submitted price/attributes.
- Applies a local 60-second evidence TTL from PactPay's receive timestamp. This is **our local policy**, not a claim that Channel3 or the merchant updated the source within 60 seconds.
- Runs deterministic checks and records the result in the existing policy-run history.
- Deliberately leaves `total`, `shippingFee`, `deliveryDate`, and `returnWindowDays` unknown when Channel3 Search doesn't provide them. Unknown hard evidence blocks the full purchase pact. Item price is not treated as the final transaction total.
- Adds no payment calls to the discovery/evaluation flow. There is no capture, void, or authorization endpoint in this patch.

## Verify

- Search returns `source: CHANNEL3_LIVE_SEARCH` and offer listings.
- Search snapshots are persisted in `pactpay_channel3_offer_snapshots`.
- Clicking **Check against pact** should normally show `BLOCKED — settlement evidence incomplete` while landed total, shipping, delivery, or returns remain unverified. That block is intentional and honest.
- A stale snapshot should fail freshness checks.
- Unit tests ensure RAM is not inferred from a product title and unsafe `javascript:` URLs are discarded.

## Known limitation

Channel3 checkout is currently labelled **coming soon** on its developer page. PactPay uses Channel3 for discovery only and PayPal Sandbox for its own separate authorize-only proof. We do not claim these are directly integrated into a merchant checkout. Before exposing this app publicly, add request rate limiting and abuse controls for the search endpoint.
