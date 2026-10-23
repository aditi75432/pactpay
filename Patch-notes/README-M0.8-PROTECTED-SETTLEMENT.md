# PactPay M0.8 — Protected Sandbox Settlement

This is an incremental overlay for the existing PactPay project. The ZIP has no enclosing project folder: extract its contents directly into the current `pactpay` project root. It does not include `.env.local` or any credentials.

## What this milestone demonstrates

- A controlled **simulated** laptop Purchase Pact is written to PostgreSQL and hash-bound to a local transaction **before** a PayPal Sandbox order is created.
- Buyer approval authorizes the Sandbox amount; buyer approval by itself does not settle it.
- The user can apply a controlled scenario mutation after authorization. Scenario application calls no PayPal API.
- The settlement route is enabled only on recognized PayPal Sandbox hosts and only for a transaction with the server-stored `DEMO_SIMULATOR` context. A generic M0 PayPal order is not eligible.
- Immediately before the decision, the server re-fetches the PayPal authorization and checks status, amount, currency, expiry, order state, pact approval, transaction binding, offer hashes, audit chain, evidence freshness/attribution/conflicts, hard constraints, and security state.
- On a fully verified pass, the server claims the transaction with a persisted idempotency key, calls the PayPal authorization-capture endpoint, and reconciles the returned capture ID, amount, currency, and `COMPLETED` status.
- On a verified policy block, PactPay attempts to void the Sandbox authorization. If PayPal or the binding state is uncertain, it enters a review state and must not be manually retried.
- Every transition is written to the existing hash-chained audit event log. `capture_origin` is set to `PACTPAY_GATE` only after a successful capture response has been reconciled; a capture reported elsewhere is not labeled as a PactPay-gate capture.

**This is a Sandbox-only controlled simulator, not a purchase from a Channel3 retailer.** The $849.00 amount is not a real retail checkout total, and no physical laptop is purchased. The red-team instruction scenario provides a deterministic simulated security finding; it is not a claim that live prompt injection is automatically detected.

## Apply

1. Stop the dev server with `Ctrl+C`.
2. Extract this ZIP directly into the existing project root, e.g. `D:\Downloads-D\Paypal\pactpay`, allowing matching files to be overwritten.
3. Keep the existing `apps/web/.env.local` untouched. The protected route requires the existing Sandbox PayPal credentials and `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com` (or the recognized Sandbox hostname).
4. Run from the project root:

```powershell
pnpm install
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
pnpm --filter web build
pnpm db:up
pnpm dev
```

## Demonstration procedure

1. Visit `http://localhost:3000/protected-demo`.
2. Read and tick the explicit simulator-only consent checkbox, then choose **Approve terms & continue to PayPal**.
3. Complete buyer approval with the PayPal **Sandbox Personal** account.
4. After returning to PactPay, open the protected settlement console.
5. For a fresh baseline, choose **Compliant offer** and click **Apply** first. This refreshes the simulator evidence TTL. Then click **Run gate & settle Sandbox**. If the current PayPal authorization and all policy/evidence checks pass, PactPay captures the $849.00 Sandbox authorization and validates the response.
6. To demo a block, start a **new** protected demo transaction, approve it in Sandbox, apply e.g. **Product downgrade** or **Untrusted merchant instruction**, then run the gate. A policy block attempts to void the authorization; it must not capture.
7. Each protected demo transaction is terminal after capture/void. Use **Start another demo** for another scenario. Do not retry manually after a network-uncertain result; inspect the transaction and reconcile instead.
8. In the console, verify the audit-chain state, settlement outcome, and `captureOrigin`. The old generic $1 M0 transaction is deliberately not eligible for capture through the protected route.

## Expected automated test count

The core suite is expected to contain 9 files / 64 tests after this overlay (including the protected-demo policy scenario cases). Treat the local command output as the source of truth. The patch was checked with strict TypeScript compilation for the Pact core and runtime smoke assertions over baseline and all six red-team scenarios; the complete Next.js/PayPal/PostgreSQL end-to-end run must be verified locally.

## Security limitations to document

- A SHA-256 hash chain makes later edits detectable relative to stored hashes, but is not an external immutable checkpoint; a privileged operator able to rewrite the whole database could recompute it.
- The simulator is deterministic. Its prompt-injection case is a simulated finding, not a live detector.
- Capture and void requests are restricted to PayPal Sandbox by this route. This milestone is not production-ready financial infrastructure and does not implement production identity, authorization, dispute operations, or independent fulfillment attestation.
