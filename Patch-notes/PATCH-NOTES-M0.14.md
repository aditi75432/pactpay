# PactPay M0.14 — Shopping Agent + AG Grid Control Center

## Included

- Adds `/agent`, a bounded Shopping Agent workflow that calls live Channel3 search, evaluates saved snapshots against the approved Purchase Pact, refreshes up to three leading candidates, re-evaluates the fresh snapshots and explains recommendation/block/evidence status.
- Makes the Pact Composer continue to the Shopping Agent after approval.
- Preserves the agent-selected exact snapshot and evaluation when the user continues to Discovery. It does not silently substitute the result with a fresh search response.
- Adds `/control-center`, a working AG Grid Community console for actual persisted PayPal transaction state and policy-run lineage.
- Adds a read-only `/api/control-center` endpoint and database read methods for transaction and detailed policy history.
- Adds AG Grid Community package dependencies: `ag-grid-community@36.2.0` and `ag-grid-react@36.2.0`.
- Adds navigation to the Shopping Agent and Control Center, including an AG Grid capability link on the home page.

## Apply

1. Stop Next.js with `Ctrl+C`.
2. Extract this archive directly into the PactPay repository root and allow the included files to overwrite the matching paths. There is no enclosing folder in the ZIP.
3. Because AG Grid is a new dependency, run `pnpm install` first and retain the resulting `pnpm-lock.yaml` changes.
4. Run these commands one at a time:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm test
pnpm dev
```

## Verify

- Open the Composer, approve the wireless mouse Pact, and run the Shopping Agent.
- Confirm it reports live search, per-offer policy evaluation, and revalidation of up to three candidates. Candidate counts and recommendations come from API results; they are not seeded result fixtures.
- Pick a refreshed candidate. Discovery should load the exact saved snapshots and evaluations from the agent run and scroll to the selected snapshot, without silently replacing the selection through another search.
- Open `/control-center`, switch between Transactions and Policy runs, filter the AG Grid, select a row, and inspect the stored detail panel.
- Confirm the Control Center response is read-only. Neither page creates a PayPal order/capture on initial load or agent run.

## Validation statement

The modified TS/TSX files were syntax/transpile-checked in the isolated workspace. The full workspace dependency install, semantic typecheck, unit tests and browser flow have not been run here. Run the verification commands above in the project’s Windows environment. The new AG Grid dependencies require a lockfile update via `pnpm install`.
