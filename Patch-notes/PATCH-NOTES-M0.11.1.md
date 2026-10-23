# PactPay M0.11.1 — Natural Price-Cap Semantics

## Problem observed

For the prompt `Find airpods less than $100`, the AI-generated draft created a `total <= 100` rule. The user did not explicitly specify a final/landed/checkout total. Because the catalog response has item prices but no final total, all offers required evidence instead of checking the stated item-price limit.

## Fix

- An unqualified product price cap such as `AirPods under $100` or `Find a mouse less than $50` now means catalog item price (`attributes.itemPrice <= amount`).
- `total <= amount` is created only when the user explicitly refers to final/landed/checkout/all-in total or states an overall budget/spend limit.
- Shipping, delivery-fee and return constraints are excluded from budget extraction and stay as separate fields.
- When both an item-price cap and a total cap are stated, both are preserved as separate constraints.
- The Groq system prompt matches this semantic contract, while PactPay continues to normalize the original user intent at the server trust boundary.
- Regression tests cover the original AirPods request, model-invented totals, explicit landed-total requests, and mixed item-price/total caps.

## Expected behavior for the reported query

`Find airpods less than $100` should compile to: hard catalog item-price cap `attributes.itemPrice <= 100`; hard currency `USD`; no landed-total rule unless the user asks for one. Therefore a listing priced at $129 should be BLOCKED by item price; a relevant AirPods listing priced at $79.99 can pass the item-price check if its currency and availability checks also pass. Passing known catalog checks does not prove shipping/tax or the final checkout total.

Accessory listings such as cases may still appear in a broad Channel3 search for `airpods`; they must not be described as AirPods themselves. Search relevance/accessory filtering is a separate follow-up improvement.

## Files

- `lib/intent-pact.ts`
- `apps/web/app/api/intent/compile/route.ts`
- `packages/pact-core/test/intent-pact.test.ts`

## Apply

Stop Next.js, extract this ZIP into the repository root with overwrite enabled, then run:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm test
pnpm dev
```

## Validation limitation

This patch was reviewed for source-level correctness and includes focused regression tests. Run the workspace checks on the project machine before relying on the behavior; a full workspace test run was not available in this environment.
