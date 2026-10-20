# PactPay M0.7.1 — BigInt target compatibility fix

This is a focused hotfix for the TypeScript error `TS2737: BigInt literals are not available when targeting lower than ES2020` in `packages/pact-core/src/settlement-state.ts`.

## Apply

Extract this ZIP directly into `D:\Downloads-D\Paypal\pactpay` and allow the two included files to overwrite their matching files. The archive has **no enclosing project folder**. It contains only:

- `packages/pact-core/src/settlement-state.ts`
- `packages/pact-core/test/settlement-state.test.ts`

Do not change `.env.local`, package versions, or the web TypeScript target for this fix.

## Commands

From the project root run:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
```

The money comparison parses decimal currency strings into integer cents and rejects values that exceed JavaScript's safe-integer range. It no longer uses a BigInt literal, so the web app's current TS target can type-check the imported source. The settlement gate remains a pure predicate; this patch adds no PayPal capture endpoint and makes no payment action.

## M0.7 runtime acceptance checklist (after checks pass)

1. Run `pnpm db:up`, then `pnpm dev`.
2. Open `http://localhost:3000/pact-lab`. Run **Compliant offer**; expect a policy pass. Run **Budget overrun**, **Expired evidence**, **Conflicting evidence**, **Currency mismatch**, and **Untrusted merchant instruction**; expect each unsafe case to block. These are deterministic fixtures; the simulated instruction fixture is not proof of automatic prompt-injection detection.
3. Open `http://localhost:3000/discover`, search for `laptop`, refresh one offer, then use **Check against pact**. Confirm unknown shipping, delivery, returns, or final checkout total are not treated as verified. If evidence is missing or stale, expect a block/unknown result.
4. Open an existing transaction record, for example `http://localhost:3000/api/paypal/transactions/1ca0c221-db67-44ec-a325-9160cb9db678`. Confirm the response shows the existing order and authorization IDs, `capturePerformedByPactPay: false`, and `auditChain.valid: true` when that field is present after migration.
5. Stop and restart `pnpm dev`, then query the same transaction again. Confirm IDs and audit events persist and the audit chain still verifies.
6. Confirm Policy Lab/discovery/evidence actions create no PayPal captures. M0.7 does not wire the settlement gate to capture; do not attempt manual capture calls.

If any test fails, send the entire command output. Do not paste environment secrets.
