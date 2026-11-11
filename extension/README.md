# PactPay Guard (browser extension)

Checks the **real** checkout page before you, or your AI agent, pays. Works on any store, and on its own: no web app and no account needed.

## Install (30 seconds)
1. On your PactPay deployment open **/extension** and press **Download extension**. The zip already points at that site. Unzip it.
   (Loading this repo folder instead? Set `baseUrl` in `config.js` to your deployment first, or change it later in the popup under Advanced.)
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the folder.
3. Open `<your PactPay URL>/store`, choose a checkout, and watch Guard check it.

## Set your rules (on the page, no account)
Press **Set my rules** on the Guard card or in the toolbar popup. Say it in plain words ("mug set, total under $40 including shipping, free returns"), review the drafted rules (MUST / NICE, and whether Guard can check each on a checkout page), then **Approve**. That creates the approval and a 24-hour key. When it expires, **Renew my rules** re-approves the same rules in one click.

Until you set rules, **Quick Guard** checks against a budget from the popup (default $40) with the code reader only. No model is called.

## Optional: link to your PactPay account
On the PactPay **/extension** page press **Link my extension** (or enter its code in the popup). Rules approved afterwards and every check appear in the web app's **Activity → Guard checks**.

## What it catches
| Trick | Who can see it | How Guard catches it |
|---|---|---|
| Fee not itemized (total > its lines) | code and pixels | arithmetic on the itemized rows |
| Fee drawn by CSS (`::after`) | pixels only | reads CSS pseudo-content + screenshot cross-check |
| Invisible text telling an AI to ignore your budget | code only | hidden-text scan (opacity 0, off-screen, 0px font, same colour, clipped, comments, alt text) |
| Total over your budget | both | your approved rules |

The verdict (`SAFE_TO_PAY`, `DO_NOT_PAY`, `CANNOT_VERIFY`) is produced by fixed code on the PactPay server. A model only ever reads pixels, and its reading must agree with the page's code. Unknown is never safe.

## Privacy
Nothing leaves the browser until a page is detected as a checkout. Then only the order summary, hidden text and (with rules set) one screenshot are sent. Screenshots and page text are never stored; Guard stores only host, path, verdict, amounts and findings, and only for checks made with your rules.

## Limits
Reads the top frame only (a checkout inside a cross-origin iframe is reported as unreadable, never guessed). Verified on the demo store; real retailers vary, so Guard says "can't verify" rather than guessing when it can't find a clear order summary.

## Develop
```bash
npm install
npm test        # 31 tests
npm run pack    # copy the runtime files to apps/web/public/guard-extension/ (served at /api/guard/extension)
PACTPAY_URL=https://your-app.onrender.com npm run pack   # also sets config.js
```
