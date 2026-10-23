# PactPay M0.13 — Offer-bound Sandbox settlement bridge

## Included changes

- Adds `POST /api/paypal/offer-demo/orders` to create a PayPal Sandbox `AUTHORIZE` order bound to the selected, server-stored Channel3 snapshot and sanitized Purchase Pact.
- Persists the exact selected snapshot ID on the transaction.
- Computes and labels a test quote from the live catalog item price plus fixed simulator-only shipping and tax terms; the quote is not represented as retailer checkout.
- Requires current snapshot validity, USD currency, recognized positive availability, explicit user acknowledgement, and a passing hard-constraint/evidence preflight before any PayPal order is created.
- Re-fetches Channel3 product detail immediately before the server-side settlement gate and requires the same product-plus-merchant offer to be uniquely matched. Currency drift or an unsupported/non-positive price range is recorded as a fail-closed finding instead of escaping as an unhandled quote-builder error.
- Stores the new immutable observation and comparison, then re-evaluates the current offer and bound Sandbox authorization.
- Adds bridge-specific controlled test scenarios for price increase, out-of-stock, currency mismatch and untrusted instruction finding; all are explicitly labelled as local test fixtures and do not alter the original Channel3 snapshot.
- Updates the protected page so the live offer and original/latest snapshot IDs are visible, simulated quote lines are clearly separated from catalog price, and the old fixed-laptop lab is secondary.
- Adds core regression tests for source binding, evidence provenance, quote labelling, availability guard and controlled mutations.

## Apply

Stop the Next.js dev server, extract this ZIP at the repository root and allow the included files to overwrite existing versions. The archive has repository-relative paths with no extra enclosing folder.

Run these commands one at a time:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm test
pnpm dev
```

## Scope and limitations

This is an offer-bound **PayPal Sandbox test checkout**, not a real Channel3 retailer order. The Channel3 item data are real source observations. Shipping, tax, authorization total and scenario drift are test fixtures. The payment action uses virtual Sandbox funds. Real retailer checkout requires a separately available/authorized merchant checkout integration.

## Validation performed in the patch workspace

- Strict TypeScript check passed for the changed Pact Core source modules.
- Core runtime smoke checks passed for the quote arithmetic, source-vs-simulator evidence, availability rule and drift scenarios.
- TypeScript syntax/transpile checks passed for the changed source/test files.
- The full workspace test suite and live browser/PayPal workflow have not been executed in this environment; run the commands above and verify the flow in your local app.
