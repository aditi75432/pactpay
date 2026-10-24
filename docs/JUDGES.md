# Judge guide: two minutes with PactPay

PactPay is in **test mode**. Payments use PayPal Sandbox money. No real store order is ever placed.

## Fastest path

1. Open the app and click **Turn this into rules** on the pre-filled request (a wireless mouse under $50).
2. Read the rules. Optionally change the price limit. Click **Approve these rules and find offers**.
3. The agent searches a live catalog and checks each real offer against your rules. Pick the best match and click **Choose this one**, tick the test-mode box, and click **Hold payment with PayPal**.
4. Sign in to PayPal Sandbox with the buyer test account (see below) and approve.
5. You land on the order screen with your payment **on hold**. Use **Demo control** to simulate what a seller might do (raise the price, sell out, add a sneaky instruction), then click **Check the offer and settle**.
6. Try both: "Nothing changes" (payment released) and "Seller raises the price" on a new order (hold cancelled, you're not charged, with a plain-English reason).
7. Open **Activity** in the top bar for the operator grid (AG Grid). It shows only your session's activity.

## See the agent work on its own

On the first screen keep **Ask me above a limit** selected (the default is $50). After you approve, you do very little:

1. The agent searches, checks every offer and picks the best match. A 6-second countdown shows it is about to place the PayPal hold (you can cancel).
2. Approve the hold on PayPal (the only tap PayPal Sandbox requires).
3. On the order screen a 12-second countdown shows the agent will re-check the live offer and settle by itself. While it counts down, use **Demo control** to make the seller raise the price.
4. The agent blocks it, cancels the hold, skips that offer and starts looking for the next one.
5. **Attempts in this run** shows both holds side by side: the first voided with $0 captured and why, the second a different offer verified on its own. **What your agent did** lists every step and how many were yours.
6. Open the **Decision receipt** for PASS / FAIL / UNKNOWN per rule, with the evidence source and times. Open **Activity** (AG Grid), filter by "Voided · nothing captured", and open a row for its event lineage.

If you repeat the demo with the same product, use **Reset the simulation and search again** on the shortlist first.

To see the limit work, choose **Ask me every time** and notice the agent waits for you.

## Try it with your own agent (optional)

On the shortlist screen open **Connect your own AI agent** and create a key. Then either add the shown MCP config to Claude Desktop or Cursor, or run `PACTPAY_AGENT_KEY=ppk_... pnpm agent:redteam` to watch a misbehaving agent get refused. The "For AI platforms" page explains who this is for.

## Sandbox buyer account

Put your sandbox buyer login in the hackathon's private testing instructions field. Don't commit credentials to this repo.

## What to look for

- **The AI can't spend your money.** Rules are approved and stored server-side. The capture decision is a fixed function, not a model.
- **Checks happen at the last moment.** The offer is re-verified and the live PayPal authorization is re-fetched right before any capture.
- **Honest labels.** Anything simulated (shipping, tax, the seller's change) is labelled as such.
- **Receipt and proof.** Expand "Receipt and proof" on the order screen to see the hash-chained audit trail and verify the state on PayPal.

## Run it yourself

See the README. About five minutes with Docker and three API keys.
