# PactPay M0.10 — Offer Decision Workspace

## Purpose

This patch turns the Channel3 results area into a decision workspace that makes the result of PactPay's deterministic policy check visible per offer. It also supports a sequential bulk check for the currently displayed offer snapshots.

## Files

- `apps/web/app/discover/page.tsx`

## UX changes

- Adds a “Check all offers” action that evaluates stored snapshots sequentially and reports progress.
- Adds filters for all offers, rules pass, needs evidence, and blocked/safety hold.
- Adds a visible verdict banner and decisive reason to every listing after evaluation.
- Distinguishes a hard-rule failure from missing required evidence and a safety hold.
- Adds a “View decision details” action for any offer that has already been evaluated.
- Increases the readability of key offer metadata, buttons, status labels and decision details.
- Removes an offer's cached evaluation when its catalog snapshot is refreshed so old evidence cannot be presented as a decision about a new snapshot.

## Safety boundary

- Bulk evaluation sends sequential requests to PactPay's existing `/api/discovery/evaluate` route.
- The route evaluates persisted offer snapshots and records policy runs; this patch does not call PayPal, create an order, authorize, capture, or void a payment.
- “Rules pass” means the evaluated policy prerequisites passed on the available evidence. It is not proof of a merchant checkout total, merchant checkout completion, or payment success.
- Missing or stale hard-constraint evidence should be shown as “Needs evidence” or “Safety hold”; it must not be represented as a verified pass.

## Apply

Extract the ZIP directly into the PactPay repository root. The ZIP contains repository-relative paths and no enclosing project directory. Allow `apps/web/app/discover/page.tsx` to overwrite the current file.

From the repository root, run one command at a time:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm test
pnpm dev
```

## Manual QA

1. Start from the approved Pact and let `/discover?query=...` load results.
2. Confirm results show “Not checked against Pact” before evaluation.
3. Click “Check all N offers”; confirm progress updates and per-offer statuses appear.
4. Confirm listings with unknown hard fields show “Needs evidence”, a known hard failure shows “Blocked”, and a genuine all-pass result is labelled “Rules pass · no payment action”.
5. Filter by each status and restore “All offers”.
6. Open “View decision details” for an evaluated offer and confirm the per-constraint trace appears.
7. Click “Collect merchant evidence” on one offer; verify its exact snapshot is selected in the Evidence Desk.
8. Refresh a catalog snapshot and confirm the old evaluation badge is cleared for that offer until it is checked again.
9. Confirm no PayPal order/capture/void occurs from discovery evaluation.

## Validation note

The modified TSX was syntax-transpiled locally. This isolated environment did not include the project's installed workspace dependencies, so a full workspace typecheck and runtime/browser test were not run here. Run the commands above locally and stop if typechecking or tests fail.
