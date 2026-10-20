# PactPay M0.4.2 — TypeScript workspace fix

## Apply
Extract this ZIP directly into the existing PactPay repository root, for example:
`D:\Downloads-D\Paypal\pactpay`

**This archive intentionally has no wrapper directory.** Its `packages/` folder and this README are at the ZIP root. Merge/overwrite the listed files, then run the commands below.

## Files updated
- `packages/pact-core/tsconfig.json`: use TypeScript's `Bundler` resolution to match the Next.js/Turbopack workspace and support extensionless source imports.
- `packages/pact-core/src/demo-scenarios.ts`: do not generate evidence records for optional fields that are unknown.
- `packages/pact-core/test/policy.test.ts`: only create total evidence when the fixture has an observed total.
- `packages/pact-core/test/channel3.test.ts`: narrow the first array result before accessing it under `noUncheckedIndexedAccess`.

## Verify
From the repository root:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
```

This is a code/typecheck fix only. It does not change PayPal credentials, database data, Channel3 integration, or payment behavior. No capture endpoint is introduced.
