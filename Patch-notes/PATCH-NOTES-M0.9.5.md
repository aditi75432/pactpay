# PactPay M0.9.5 — Strict TypeScript regex-capture fix

## Why

The M0.9.4 change exposed four strict TypeScript errors in `lib/intent-pact.ts` because `noUncheckedIndexedAccess` correctly treats regex capture groups such as `match[1]` as potentially undefined.

## Changes

- Guard optional capture groups before reading or parsing budget, delivery date, RAM, return-window, shipping, brand and product/title matches.
- Avoid constructing a constraint from a missing regex capture.
- Add a regression test for the local rule-based fallback parser covering RAM, delivery date, minimum return days, shipping ceiling, brand preference and budget extraction.
- No payment, authorization, capture, policy, or audit behavior is changed.

## Apply

Extract this ZIP directly into `D:\Downloads-D\Paypal\pactpay`, allowing the two included source/test files to overwrite their existing versions. The archive uses repository-relative paths and contains no enclosing project folder.

Run each command separately from the repository root:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm test
```

Then restart the app if needed:

```powershell
pnpm dev
```

## Verification note

The modified `lib/intent-pact.ts` passed a TypeScript transpilation syntax check, and a focused runtime check of the fallback parser correctly extracted all six expected values from a sample intent. The complete workspace typecheck/test suite still needs to be run in the user's local project.
