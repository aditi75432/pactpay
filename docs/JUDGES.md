# Judge guide (4 minutes)

> The live app has the same guide, with copy buttons for the logins, at **`/judges`**.

PactPay runs in **test mode**: PayPal Sandbox money only, and no retailer order is ever placed.
Hosted app: https://YOUR-APP.onrender.com/ (first load can take ~30 s while the free instance wakes up).
Sign in with `judge` / `PactPay-Judge-2026`. When PayPal asks you to approve a hold, use the Sandbox buyer login in the README.

## Path A: the whole workflow (2 minutes)

1. **Shop** (`/`): press **Turn this into rules**, tick **Demo control: make the seller's checkout page hostile**, keep **Ask me above a limit**, press **Approve and let the agent start**.
2. **Agent**: watch the AI agent call its tools live (read rules, search a real catalog, rank offers, place a **PayPal authorization hold**).
3. Press **Approve on PayPal (Sandbox)** and approve as the Sandbox buyer. Nothing is charged yet.
4. **Order**: the checkout inspection starts by itself. Two AI readers read the page, fixed rules return **Do not pay** (a fee that isn't itemized, small print aimed at the agent), the gate **voids the hold** and **$0 moves**.
5. Run it again with the hostile box unticked: **Safe to pay**, and the gate **captures** once.

## Path B: PactPay Guard on a real page (2 minutes, independent of Path A)

1. Open `/extension`, press **Download extension**, unzip, then in Chrome open `chrome://extensions` → Developer mode → **Load unpacked**. (The zip already points at this site.)
2. Open `/store` (a fictional demo shop) and click each checkout:
   - **Honest checkout** → *Safe to pay*
   - **Hidden fee** → *Do not pay* (total is higher than its lines)
   - **Fee drawn by CSS** → *Do not pay* (a charge that is on screen but not in the page text)
   - **Invisible instruction to an AI** → *Do not pay* (hidden text tells an agent to ignore the budget; the card quotes it and says how it was hidden)
   - **Over your budget** → *Do not pay*
3. Click **Place order** on a blocked checkout: Guard puts a speed bump in front of it (this applies to an AI agent's click too).
4. Press **Set my rules** on the card. Type something like "mug set, total under $30 including shipping and tax", press **Draft my rules**, review (MUST / NICE, "Guard checks this"), then **Approve**. No web login needed. Re-check: Guard now holds the page to *your* rules.
5. Optional: on `/extension` press **Link my extension** (signed in). Guard checks now appear in **Activity → Guard checks** (an AG Grid).

## What to look for

- **PayPal is the safety mechanism, not a button.** Authorize first; capture only if the gate passes; void otherwise. Webhooks are verified against the gate's audit chain.
- **Models propose; fixed code disposes.** There is no model in the settlement path or in the Guard verdict.
- **Eyes and code each catch what the other can't.** Invisible text is only in the code; a CSS-drawn fee is only on screen. If the two readers disagree about the money, nothing is called safe.
- **Unknown is never safe.** Missing shipping or tax is "can't verify", not zero.
- Everything simulated is labelled. Limits are in `docs/LIMITATIONS.md`.

## Run it yourself

See the README (`pnpm install`, `cp .env.example apps/web/.env.local`, `pnpm db:up`, `pnpm dev`).
Verification, no network needed:

```bash
pnpm --filter @pactpay/pact-core test      # 244 tests, including the gate, inspection and Page Guard
cd extension && npm install && npm test    # 31 tests: reader, verdict, the on-page UI, zip builder
```

## Be aware

- A sandbox has no real retailer checkout, so the main flow draws the checkout from the order's sandbox terms. Guard is how the same inspection reaches real pages; the demo store exists so it can be shown without a third party's brand.
- Each new PayPal hold still needs the buyer's approval on PayPal. There are no user accounts beyond a demo login.
