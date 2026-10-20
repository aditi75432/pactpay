# PactPay M0.6 — Evidence Desk

This is an **overlay patch** for the existing PactPay workspace. The ZIP is intentionally flat: its first-level entries are `apps/`, `docs/`, `lib/`, and `packages/`. Extract the ZIP **directly into the existing `pactpay` project root** and allow matching files to be overwritten. Do not create a nested `pactpay-m06` directory.

## What changes

- Adds `/evidence?snapshotId=<server-stored-snapshot-uuid>` to submit manual merchant-page claims for a specific Channel3 offer snapshot.
- Adds GET/POST `/api/discovery/evidence` to validate and persist claims.
- Adds POST `/api/discovery/evidence/review` to append `HUMAN_REVIEWED` or `REJECTED` review events.
- Keeps original claims immutable; review decisions are separate rows, and the latest review event determines eligibility.
- Allows only reviewed claims into live pact evaluation; unreviewed/rejected claims never enter the evaluator.
- Shows per-offer catalog observation and expiry timestamps in Discovery.
- Extends the *local Channel3 snapshot freshness window* from 60 seconds to 10 minutes to make the short demo workflow usable. This is PactPay's local evaluation policy, not a statement that merchant data cannot change for 10 minutes. The explicit Refresh action still obtains a new Channel3 observation.
- Preserves the no-capture rule. This patch adds no PayPal order, authorize, capture, or void calls.

## Apply

1. Stop `pnpm dev` with `Ctrl+C`.
2. Extract the ZIP straight into the existing repository root.
3. Keep `.env.local` unchanged. Do not put any API key in client-side variables.
4. Run from the project root:

```powershell
pnpm install
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm db:up
pnpm dev
```

5. Open `http://localhost:3000/discover`, find an offer, and click `Refresh catalog facts` if the catalog snapshot is stale or close to expiring.
6. Click `Collect merchant evidence`, open the merchant offer in a separate tab, and submit observations for final total, shipping fee, delivery date, return window, current item price, RAM, condition, and/or availability as shown by the merchant.
7. For each claim, review the source page yourself and check the explicit attestation before clicking `Mark human-reviewed`. Use `Reject claim` for anything unsupported or inconsistent.
8. Return to Discovery and click `Check against pact` on the *same snapshot* to see how eligible evidence changes the deterministic result.

## Evidence fields and local TTLs

| Field | Local validity after server receipt |
|---|---:|
| Final total, shipping, delivery date, item price, availability | 5 minutes |
| RAM, condition, return window | 30 minutes |

These are local operational thresholds, not merchant guarantees. The timestamp is when PactPay received the submitted claim; it is not independently measured browser capture time. If there are multiple fresh human-reviewed claims for the same field and they conflict, the evaluator fails closed.

## Important trust boundary

This is a local single-user prototype. The server checks input shape, HTTPS, exact merchant-domain/subdomain binding, numeric/date bounds, strips query strings/fragments before storage, and hashes the submitted record. It **does not fetch the merchant page**, cryptographically authenticate its contents, or authenticate reviewer identity. `HUMAN_REVIEWED` means the local user attested they inspected the exact offer and value. Do not deploy this endpoint publicly without authenticated reviewer identities, authorization, stronger capture/provenance, rate limiting, and appropriate data-retention controls.

A policy PASS is only a policy result. **No PayPal payment operation happens in this flow.**
