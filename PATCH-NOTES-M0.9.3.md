# PactPay M0.9.3 — Web TypeScript Fix

This patch addresses two TypeScript errors found after applying the M0.9 unified product experience and Groq compiler changes.

## Changes

1. `apps/web/app/api/discovery/evaluate/route.ts`: adds `pactSnapshot` to the `recordPolicyRun` call. The exact Purchase Pact evaluated is now stored with the policy run, allowing the run's persisted hash to cover the Pact, offer snapshot, and verification result.
2. `lib/intent-pact.ts`: passes index `0` when `fieldConstraint` calls `normalizeConstraint`. This helper normalizes one standalone constraint and already provides an explicit ID, so the fallback row index is only used if a generated ID/description is needed.

No PayPal settlement logic, policy decisions, or provider settings are changed.

## Apply

Extract the ZIP directly into the repository root, `D:\Downloads-D\Paypal\pactpay`, allowing the two source files to overwrite their existing versions. The ZIP has repository-relative paths and no enclosing project folder.

Run commands one at a time from the repository root:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm test
```

Only proceed to record a demo after the web typecheck is clean. The focused core suite previously reported 66 passing tests; rerun it after applying this patch.
