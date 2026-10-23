# PactPay M0.9.4 — Intent Comparator Normalization

## Problem
Groq generated a `returnWindowDays` rule that contradicted the user's minimum-return wording. PactPay correctly rejected it because this field currently supports minimum-day semantics (`gte`) only, then showed the explicit local rule-based fallback.

## Changes
- Adds safe aliases for common comparator spellings (`at_least`/`at least` -> `gte`, `at_most` -> `lte`, `equals` -> `eq`, and explicit mathematical equivalents).
- Passes the original user intent into the Groq-output validation boundary.
- Repairs a contradictory `lte`/`eq` comparator for `returnWindowDays` only when the user's original intent explicitly states a minimum return period and the model's expected number exactly matches that user-stated threshold.
- Does not convert a maximum-return requirement into a minimum; unsupported semantics still fail closed.
- Updates the Groq system prompt with field-specific comparator mappings and passes the original intent into the normalizer.
- Adds regression tests for valid minimum repair, comparator aliases and unsafe inversion rejection.
- Preserves M0.9.2 Groq JSON-schema/JSON-object compatibility retry and the M0.9.3 TypeScript fixes.

## Apply
Extract the ZIP directly into the repository root, overwriting included files. No extra enclosing directory is included.

Then run:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm dev
```

The regression tests are run through the existing pact-core Vitest workspace. Full application typecheck/tests should be confirmed in the user's environment.
