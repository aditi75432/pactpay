# PactPay M0.8.3 — Verified capture reconciliation

## What this patch does

Adds a dedicated `POST /api/paypal/transactions/{transactionId}/reconcile-capture` endpoint for a protected Sandbox transaction that is already in `CAPTURE_REVIEW` because the original PayPal capture response did not include enough verifiable fields.

The endpoint only calls PayPal GET resources: order, authorization, and capture. It verifies the exact transaction custom ID, expected protected-demo reference, pact binding, audit-chain validity, prior gate-pass/capture-request/reconciliation events, authorization association, one capture, completion status, exact amount, and currency before it changes the local record. It never captures, voids, or retries a payment.

On success it records the capture ID/status, changes the local transaction to `CAPTURED`, clears the reconciliation error, and adds a `PAYPAL_CAPTURE_RECONCILED` audit event with the verified order/authorization IDs. The generic transaction GET response now reports capture origin from persisted state rather than hard-coding `false`.

## Apply

Extract this ZIP directly into the PactPay repository root and allow the included files to overwrite existing files. The ZIP contains repository-relative paths, with no enclosing project folder.

Then run these commands separately:

```powershell
pnpm typecheck
pnpm test
```

If both pass, restart the app with `pnpm dev`. In a second PowerShell window, run the reconciliation POST shown in the delivery instructions.

## Safety

- The endpoint refuses non-Sandbox configuration.
- It only accepts a transaction in `CAPTURE_REVIEW` that has the expected protected simulator context and valid prior audit history.
- If any remote fact is unavailable or inconsistent, it returns an error without changing the transaction.
- Do not call the settlement endpoint again for the affected transaction.
