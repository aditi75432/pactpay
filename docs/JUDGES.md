# Judge guide

PactPay runs in **test mode**: PayPal Sandbox money, no retailer order is ever placed. Sign in with `judge` / `PactPay-Judge-2026` or create an account.

## 2-minute path (Meta features, no PayPal needed)

1. Open **Checkout check**. Pick **A page that talks to the agent** and press **Inspect this checkout**. Muse reads it twice; the numbers are fine, but hidden small print is aimed at an AI. Verdict: **Do not pay**. The footer shows which Meta model(s) read it.
2. Press **Run the suite**. Five pages, five verdicts: one safe, three blocked (hidden fee, hidden instructions, over budget), one *Can't verify*.
3. On **Shop**, tap **Say it instead**, speak a request, then **Turn this into rules**. The badge shows which Muse model wrote them.

## Full path (agent + payment gate)

4. Approve the rules (keep **Ask me above a limit**). Open **Muse Agent**, press **Run the Muse agent**. Watch it read rules, search live stores, rank offers, and place a hold.
5. Approve the hold on PayPal Sandbox (buyer test login is in the submission notes), then press **I approved: let the agent settle**.
6. Run it again with **Try to tempt it**, or set autonomy to *Ask me every time*, and watch PactPay refuse.
7. Open **Activity** for decision receipts and the audit trail.

## The proof that the Inspector stops a real capture (3 minutes, needs PayPal Sandbox)

1. After step 5 above, open the order page and use **Inspect the real checkout page**. It opens the Inspector bound to that order (`/inspector?tx=…`).
2. Run **A page that talks to the agent** (or the hidden-fee page). Verdict: **Do not pay**, and the note says it was attached to the order.
3. Back on the order, press settle. The gate returns `CHECKOUT_INSPECTION_BLOCKED` and voids the hold. Nothing is captured.
4. Try again on a fresh hold with **An honest checkout**: verdict *Safe to pay*, and the other rules decide.
5. Without any inspection attached, settlement behaves as before. The Inspector only has a say when you ask it to look.

## What to look for

- Muse proposes; fixed code disposes. There is no model in the settlement path.
- Unknown is never treated as safe.
- Everything simulated is labeled. Limits are in `docs/LIMITATIONS.md`.

- The Inspector reads a screenshot you upload; it is not yet attached to a live retailer page.
- `pnpm --filter @pactpay/pact-core test` runs 184 tests with no network, including the settlement-inspection tests.
