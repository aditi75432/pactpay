# PactPay M0.7 — Source audit and safety-core patch

This patch is based on the source ZIP you supplied. **Extract the ZIP contents directly into your existing project root** (`D:\Downloads-D\Paypal\pactpay`). The archive has no enclosing project folder. It contains only changed and new files; no `.env.local`, credentials, `node_modules`, `.next`, or Git internals are included.

## What changes

1. **Evidence now affects live offer decisions.** The live Channel3 evaluator reads claims for the exact snapshot. Only claims whose stored content hash verifies and whose latest review is `HUMAN_REVIEWED` with `source_inspected=true` are eligible. Expired or conflicting values still fail closed. A hash mismatch lowers the security gate and blocks the evaluation.
2. **Policy inputs are persisted.** Each new policy run stores the exact Purchase Pact JSON and a SHA-256 integrity hash over the pact, offer snapshot, and result. The hash is not a signature.
3. **Transaction audit events are hash-chained.** Legacy rows are backfilled on first migration only when all existing hash fields are absent. Partial hash migration is rejected rather than silently rewriting events. The transaction GET endpoint reports chain verification.
4. **Authorization persistence is stricter.** The database only records an authorization result from `AUTHORIZING`. A duplicate is treated as idempotent only if the authorization ID, order status, authorization status, amount, and currency exactly match the already-stored response.
5. **Settlement state/gate model is added.** It is a pure deterministic predicate. It has no PayPal side effects and is not yet wired into a capture operation. Its facts explicitly require the caller to revalidate that the PayPal authorization has not expired.

## Apply

1. Stop the dev server with `Ctrl+C`.
2. Extract this ZIP directly into the project root and allow files to merge/overwrite.
3. Keep `apps\web\.env.local` unchanged.
4. Run from PowerShell in the project root:

```powershell
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm db:up
pnpm dev
```

5. Open Product Discovery, refresh an offer, and run **Check against pact**. If you previously submitted evidence, open that snapshot's Evidence Desk and review the claims again only after inspecting the merchant page.
6. Open an existing PayPal transaction's API record (for example `/api/paypal/transactions/<local-transaction-uuid>`) and inspect `auditChain.valid`, `eventCount`, and `lastHash`.

## Acceptance criteria

- Core typecheck passes.
- Core tests pass, including the settlement-gate, audit-chain, and evidence-content-integrity cases.
- Web typecheck passes.
- Existing transaction history survives restart.
- `auditChain.valid` is true for an unmodified legacy transaction after one-time backfill.
- A live-offer evaluation includes valid human-reviewed evidence and blocks if any evidence row's content hash is invalid, or if required evidence is unknown/stale/conflicting.
- No PayPal capture is triggered by search, refresh, evidence submission/review, or policy evaluation.

## Important limits

- **No PayPal capture endpoint is included.** The transaction still does not persistently bind an approved pact, exact offer snapshot, current policy run, evidence set, and authorized amount into one settlement record. M0.8 must implement that binding and re-evaluate on the server immediately before any capture/void operation.
- Evidence review is a local human attestation. PactPay still does not fetch/authenticate retailer pages or authenticate reviewer identity. Do not expose these APIs publicly without authentication, authorization, SSRF-safe fetch controls, rate limits, and deployment hardening.
- Hash chains and SHA-256 content hashes detect some content changes but are not digital signatures; someone who can rewrite the entire database may be able to recompute them.
- I validated the updated core source with strict TypeScript, used a strict temporary type-check harness for the changed server routes, and ran runtime smoke assertions for audit-chain tamper detection, evidence-hash verification, and fail-closed settlement-gate behavior. I could not run your full local pnpm/Vitest/PostgreSQL/PayPal integration in this environment; the commands above must pass on your machine before considering M0.7 closed.
