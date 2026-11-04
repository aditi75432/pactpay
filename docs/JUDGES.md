# Judge guide

PactPay runs in **test mode**: PayPal Sandbox money, no retailer order is ever placed. Sign in with `judge` / `PactPay-Judge-2026` or create an account. The workflow starts on the Shop page (`/`) and continues through the Agent and Order pages.

## The 3-minute path (the whole product, one workflow)

1. Press **Turn this into rules** (or tap **Say it instead** and speak). The badge shows which Muse model wrote the rules.
2. Tick **Demo control: make the seller's checkout page hostile** (a labelled simulation), keep **Ask me above a limit**, press **Approve and let the agent start**.
3. On the **Agent** page, watch the Muse agent call its tools live (read rules, search real stores, rank offers, place a PayPal hold). The offers table shows every offer with its verdict and reason.
4. Press **Approve on PayPal (Sandbox)** (or let the 6s countdown run) and approve with the Sandbox buyer login.
5. On the **Order** page the **checkout inspection starts by itself**: you see the checkout page, two Meta models read it (the footer names them), and fixed rules return **Do not pay**: a fee that isn't itemized and a sentence aimed at the agent. Autopilot waits for it, then the gate **blocks the capture and releases the hold**. You aren't charged, and the reason is on record.
6. Go back to **Shop**, leave the hostile box unticked, and run it again: the inspection says **Safe to pay** and the gate captures once.
7. Optional: tick **try to tempt the agent** and watch PactPay refuse. Open **Activity** for decision receipts and the audit trail; open **For AI platforms** for the agent-key marketplace flow.

## What to look for

- **Muse proposes; fixed code disposes.** There is no model in the settlement path.
- **Two independent Meta readers** (Muse Spark 1.3 and the open-weight Muse Spark Open) must agree; unknown is never treated as safe.
- **The inspection verdict is read by the settlement gate.** Even if you approve the hold, a Do not pay verdict blocks the capture.
- Everything simulated is labelled. Limits are in `docs/LIMITATIONS.md`.

## Be aware

- The checkout page is drawn from the order's sandbox merchant terms (there is no real retailer checkout in a sandbox) and sent to Muse like any screenshot. A real deployment would capture the merchant's own page.
- `pnpm --filter @pactpay/pact-core test` runs 206 tests with no network, including the gate and inspection tests.
