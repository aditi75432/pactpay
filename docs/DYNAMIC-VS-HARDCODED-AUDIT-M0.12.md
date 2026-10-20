# PactPay source audit: live data vs hardcoded behavior (M0.12)

## Scope and confidence

This review is based on the uploaded `pactpay-source-review.zip` source snapshot plus the M0.7–M0.11.1 patch files available in the conversation, reconstructed into one tree. It is a source-level static audit, not a live penetration test or a verification of unshared local modifications. Run the project tests after applying M0.12; re-upload the exact current repository ZIP if a definitive audit of the machine's current working tree is required.

## Executive conclusion

**PactPay is not “nothing hardcoded”—and it should not be.** Live discovery data is fetched from Channel3, but examples, supported rule schemas, policy limits, fallbacks, and the protected Sandbox simulator are deliberately defined in code. The biggest product boundary is that the live Channel3/Purchase Pact workflow and the fixed $849 PayPal Sandbox simulator are separate flows. The existing Sandbox demo is not a real retailer checkout and does not yet settle the exact offer selected in live discovery under the user's arbitrary Pact.

## Dynamic behavior verified in source

- `apps/web/app/api/discovery/search/route.ts` sends a server-side request to Channel3's `/v1/search`, normalizes the returned products and merchant offers, assigns fresh snapshot IDs/timestamps/expiry, persists them to PostgreSQL, and returns the stored observations. Listing title, product ID, image, merchant domain, offer URL, catalog price, currency, availability, condition, brand, and structured attributes come from the source response when supplied; the app does not include a fixed AirPods listing array in the discovery page.
- `packages/pact-core/src/channel3.ts` defensively normalizes Channel3 product/offer response fields and does not infer RAM from a title or description.
- `apps/web/app/api/discovery/refresh/route.ts` calls Channel3's product detail API and saves a new snapshot after matching a specific product+merchant offer.
- `apps/web/app/api/intent/compile/route.ts` calls Groq when configured. The model's output is normalized and checked against PactPay's allowed fields, comparators, currencies, and authority rules. If provider output cannot be used, a clearly labelled local rule-based draft can be returned; a fallback is deterministic rather than an AI response.
- `apps/web/app/api/discovery/evaluate/route.ts` loads the specified offer snapshot from PostgreSQL and evaluates it against a sanitized Purchase Pact; policy runs persist the pact/evidence/verification snapshot. M0.12 removes the previous implicit default laptop rules from this live evaluation route: evaluation now requires a supplied, validated Purchase Pact.
- The screenshot's 14 listing results and their merchant names/prices differ by query and snapshot. This is consistent with dynamic Channel3 response data, not a hardcoded product catalog.

## Intentional hardcoded configuration, examples, and fixtures

| Location | Hardcoded item | Assessment |
|---|---|---|
| `apps/web/app/page.tsx` | `DEMO_INTENT` and example chips for a wireless mouse, USB-C charger, and wireless headphones | Intentional starter examples, not live results. The user can replace the text. |
| `lib/intent-pact.ts` | `FIELD_RULES`, supported field names/comparators, comparator aliases, parser patterns, and USD/INR-only currency validation | Intentional deterministic trust-boundary/limited-prototype schema. It constrains what a model can propose; it is not an unlimited open-ended product ontology. |
| `apps/web/app/api/discovery/search/route.ts` | Channel3 endpoint, query length limit, upstream request limit and 10-minute snapshot TTL | Static integration/configuration values. The returned listing records are dynamic. Multiple offers can be returned per product, so the final offer count may exceed the product request limit. |
| `apps/web/app/api/discovery/evaluate/route.ts` | 60-second evaluation evidence TTL | Static local safety policy, not a merchant fact. M0.12 removes the hardcoded `$900`/laptop default pact from this route. |
| `packages/pact-core/src/settlement-demo.ts`, `apps/web/app/protected-demo/page.tsx` | Fixed `$849.00 USD` simulator amount, Lenovo/laptop, 16 GB RAM, refurbished condition, shipping and return facts, and deterministic mutation scenarios | **Intentionally hardcoded Sandbox fixture.** It is useful for repeatable pass/block/void tests but is separate from live Channel3 offers. Do not describe it as a real retailer checkout or claim a dynamic live offer was purchased. |
| `packages/pact-core/src/demo-scenarios.ts`, Policy Lab UI and policy unit tests | Fixed scenario fixtures / attack mutations | Intentional deterministic testing material, not live product data. |
| Evidence Desk | Field choices, validation policy and manually entered merchant observations | The user supplies the claim; the app does not independently fetch/authenticate the merchant page. Human-reviewed is a user's attestation, not cryptographic proof. This boundary is disclosed in the UI. |
| `apps/web/app/discover/page.tsx` | UI labels, status colors, static explanatory copy and an accessory-title term list | UI/configuration. M0.12 labels the accessory grouping as a title heuristic and does not allow it to change policy results. |

## Issues found and addressed in M0.12

1. The discovery card always showed `Structured RAM unknown`, including for AirPods. M0.12 only shows RAM when catalog data supplies RAM or the approved Pact requires it. This is a presentation correction; it does not infer RAM.
2. Failure details surfaced internal IDs such as `c2`. M0.12 translates known constraint IDs into the user's rule description and shows more direct item-price and brand explanations.
3. Broad Channel3 queries may include cases/covers alongside the requested device. M0.12 separates likely accessories using a title-only heuristic, labels it as a hint, lets users filter these listings, and explicitly does not use that heuristic in policy evaluation.
4. An empty discovery page prefilled `refurbished laptop 16GB RAM`. M0.12 makes direct discovery start with an empty query and useful placeholder text.
5. When no Pact was present, live evaluation silently applied a fixed laptop Pact with a `$900` screen and laptop-specific requirements. M0.12 removes that fallback and requires an approved, validated Purchase Pact before evaluation.
6. M0.12 adds an evaluated-result summary with computed counts and an explicit message when no listing meets all current hard rules.

## Remaining limitations / not yet implemented

- The protected PayPal Sandbox flow still uses its fixed $849 demo purchase and fixed simulated merchant evidence. It is not dynamically bound to the live offer selected in Channel3.
- Channel3 discovery can return semantically related accessories. M0.12's grouping is a title heuristic—not an AI classifier, merchant category API, or ground-truth product taxonomy.
- The Purchase Pact is saved in browser `sessionStorage` for this local prototype; the discovery evaluation route revalidates the supplied Pact and saves it with each policy run, but the current UI approval isn't yet a server-authenticated durable approval record for a real merchant checkout.
- `apps/web/package.json` does not include `ag-grid-react` or `ag-grid-community`; the current cards use CSS Grid and the decision trace uses an HTML table. The project is **not yet using AG Grid** for the AG Grid sponsor prize.
- Search/refresh returns catalog observations, not a verified checkout total. Shipping, tax, delivery promises and returns need separate evidence; programmatic retailer checkout is not integrated in this prototype.

## Recommended next milestones

1. Validate M0.12 and add regression tests for the title heuristic, human-readable reasons, and Pact-required evaluation.
2. Add a real AG Grid comparison table with dynamic columns and row-level policy/evidence statuses (while keeping each decision server-evaluated).
3. Introduce an explicit result relevance model/category source, but label uncertain relevance as a hint instead of silently hiding results.
4. If ever connecting a retailer checkout, persist/approve the exact Pact server-side and bind the selected offer/evidence/authorization before allowing settlement.
