# PactPay M0.12 — User-friendly discovery + hardcode transparency

## Changes

- Removes the prefilled laptop query from direct Discovery visits; a fresh visit now has an empty query with general examples in the placeholder.
- Makes live-offer evaluation require an approved, validated Purchase Pact. The server no longer silently invents a `$900` laptop Pact if one is absent.
- Removes irrelevant “Structured RAM unknown” card chips unless RAM is in the approved Pact or the Channel3 snapshot actually supplies RAM.
- Replaces opaque `c2`-style failure explanations with the human-readable Purchase Pact rule and concise price/brand explanations.
- Adds a computed results summary (`checked`, `pass`, `blocked`, `needs evidence`, price-cap failures and brand-rule failures).
- Groups likely accessories separately using a title-only heuristic and shows a visible `LIKELY ACCESSORY · TITLE HINT` label. This heuristic is UI-only and never affects policy evaluation or settlement eligibility.
- Adds a direct “Approve a Purchase Pact first” path when Discovery is opened without an approved Pact.
- Includes a static source audit document that identifies dynamic data paths, intentional hardcoded fixtures/configuration, known product boundaries, and remaining risks.

## Source audit findings in brief

- Live offer listings and merchant prices come from Channel3 search and are persisted as PostgreSQL snapshots; the AirPods listing data is not a hardcoded card array.
- Examples, supported fields/comparators, fallback parsing rules, currency support, TTLs and demo fixtures are hardcoded intentionally.
- The `$849.00` Lenovo/laptop flow remains a **deliberate Sandbox simulator fixture** and is separate from live Channel3 discovery. It is not a live retailer purchase.
- Evidence Desk user-entered claims are not independently fetched or cryptographically authenticated from the merchant.
- AG Grid is not yet a dependency; the current decision UI is a CSS Grid of cards and an HTML table.

See `docs/DYNAMIC-VS-HARDCODED-AUDIT-M0.12.md` for scope and details.

## Apply

Stop Next.js, extract this ZIP into the repository root with overwrite enabled, then run each command separately:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm test
pnpm dev
```

## Validation status

The changed TSX and API route passed TypeScript `transpileModule` syntax diagnostics in isolation. This is not a full workspace typecheck: the complete checks above must pass on the project machine before calling M0.12 verified.
