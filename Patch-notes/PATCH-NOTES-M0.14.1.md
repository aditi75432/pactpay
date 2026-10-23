# PactPay M0.14.1 — Agent handoff, PayPal live refresh, and dependency setup

## What this patch fixes

### Shopping Agent → Discovery handoff
- Discovery now receives only the up-to-three refreshed/re-evaluated offers from the agent shortlist, rather than every raw search result.
- The selected snapshot is verified as part of the shortlist before navigation.
- Discovery visibly identifies agent-shortlist mode and keeps the session handoff for refresh/back navigation.
- If the browser can't restore the shortlist, it no longer silently launches another full catalog search. The user is told what happened and can explicitly choose a full search.

### “Refresh state” is now a real live check
- The protected transaction page now calls a read-only server endpoint that re-fetches the PayPal Sandbox order, authorization, and any existing capture resource.
- The page presents the live PayPal status beside PactPay's locally stored state.
- If a completed capture is remotely verified but PactPay still records CAPTURE_REVIEW, a reconciliation action is shown only when the live amount, currency, order/transaction binding, capture relationship, and audit-integrity prechecks pass. The existing reconciliation endpoint performs its own full checks before writing the local state.
- The refresh endpoint never captures, voids, or mutates a payment.

### Clearer user-facing payment result
- CAPTURED explains that only virtual PayPal Sandbox funds were captured and no retailer order was placed.
- VOIDED explains that the controlled test was blocked and no capture was performed.
- AUTHORIZED explains that test funds are authorized but not captured yet.
- CAPTURE_REVIEW tells the user not to retry settlement and guides them to live state verification.

## Important: resolve the AG Grid build error

M0.14 adds `ag-grid-community@36.2.0` and `ag-grid-react@36.2.0` to `apps/web/package.json`, but the earlier ZIP did not include a regenerated root pnpm lockfile. Next cannot resolve those imports until the workspace installs dependencies.

After extracting this patch into the repo root, run these commands from the project root, one at a time:

```powershell
pnpm install --no-frozen-lockfile
pnpm --filter web list ag-grid-community ag-grid-react
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm test
pnpm dev
```

Keep the generated `pnpm-lock.yaml` change in version control. The package install is essential; copying React source alone cannot install npm packages.

## How the Sandbox checkout is useful

The live catalog offer is real Channel3 data. For the checkout test, PactPay builds a clearly labelled test quote from the chosen listing plus simulated shipping/tax fixture terms, then creates a real PayPal Sandbox order/authorization using virtual test funds. On buyer approval, PactPay revalidates the exact saved product+merchant binding and evaluates the approved Pact. A passing gate may capture Sandbox funds; a blocked gate attempts to void the authorization. Neither outcome places an order with, or pays, the displayed retailer. This tests PactPay's integration and payment-control mechanics; it is not yet a production shopping checkout.

## Validation statement

The modified files were syntax-checked in this isolated environment. I could not install npm packages or run the whole workspace typecheck/tests here because registry access is unavailable. Please run the commands above in the Windows project. Browser-level behavior and direct PayPal Sandbox refresh need to be verified with the user's configured credentials.
