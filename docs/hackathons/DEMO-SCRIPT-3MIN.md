# 2:45 demo video: script, shot list and recording rules

Target **2:40 to 2:50**. The rules say under 3:00 and judges aren't required to watch past it; your old cut was 2:59, too close. Judging criterion *Presentation* = "clearly demonstrates the project working end-to-end; pitch says what problem, who it's for, why it matters."

## Recording rules (these cost points if ignored)
- **Zoom the browser to 125–150%** and record 1080p. Your old video was hard to read at 40% size. Judges watch on a laptop.
- **No third-party trademarks or music** (explicit rule). Remove the Lenovo product page and any Meta/other logos. Use only: PactPay, PayPal (sponsor), and the fictional *Marlow & Finch* demo store. Use royalty-free or no music.
- Show the project **running on the device it was built for** (a browser, with the extension installed). Show the real URL bar.
- Record the voiceover yourself, calm and slightly slow. A human voice beats text-to-speech. Burn in captions.
- Upload to **YouTube, public (not unlisted)**, paste the link into Devpost and the README.
- Sign in and pre-warm the Render instance 2 minutes before recording. Do the full run once off-camera.

## Script

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:15 | Marlow & Finch checkout, total highlighted. Cursor hovers "Place order". | "AI agents can shop for you now. But what happens when the checkout hides a fee, or quietly talks to the agent?" |
| 0:15–0:30 | PactPay home hero. | "PactPay sits between an AI agent and PayPal. You approve rules once. PayPal holds the money. Fixed code decides if it moves." |
| 0:30–0:55 | Type "wireless mouse under $30, prefer Logitech". Rules appear, approve. Agent log streams tool calls. | "Say what you want. The agent searches a real catalog and ranks offers against your locked rules, and asks PayPal for an authorization hold. Nothing is charged." |
| 0:55–1:15 | PayPal Sandbox approval, back to the order page: "Payment on hold. Nothing has been charged." | "PayPal authorizes the payment. This is the safety mechanism: money is held, not spent." |
| 1:15–1:45 | Tick hostile checkout. Inspection result: Do not pay, fee not itemized, small print quoted. Activity row shows VOIDED, captured $0. | "Right before release, two AI readers read the checkout and fixed rules decide. A fee isn't itemized and the page whispers to the agent. The gate voids the hold. Zero dollars moved." |
| 1:45–1:55 | Re-run honest: Safe to pay, CAPTURED $21.58. | "Same flow, honest seller: every check passes, and PayPal captures once." |
| 1:55–2:25 | **Guard.** Demo store: honest → green card. Press **Set my rules**, say "total under $30", approve in the pop-up. Invisible-instruction checkout → red card quoting the hidden text and "off-screen". Click Place order → speed bump. | "But agents shop everywhere, not just here. PactPay Guard is a browser extension: you set your rules right on the page. It reads the real page. Here is text no human can see, telling an AI to ignore your budget. Guard quotes it, blocks it, and stops the pay button, even for an agent." |
| 2:25–2:38 | CSS-fee checkout with key connected: card says code and screenshot disagree / CSS-drawn charge. Activity → Guard checks grid (AG Grid). | "Eyes and code each catch what the other can't. If they disagree about the money, nothing is called safe. Every check lands in Activity." |
| 2:38–2:48 | End card: logo, tagline, "PayPal Orders · Payments · Webhooks · MCP" and repo URL. | "PactPay. Let your agent shop. PayPal holds the money until it's right." |

## Shots to capture separately
1. Extension popup (connected state), 3 seconds.
2. The Activity AG Grid with the Guard tab, filtered.
3. A PayPal Sandbox dashboard transaction showing the authorization and void (proof it's real PayPal).

## Pitch lines for the Devpost "Presentation" box
- Problem: agents browse and click; pages can hide fees and whisper instructions to them.
- Who: shoppers using AI agents, and the platforms that let agents pay.
- Why PayPal: authorize-then-capture turns "the agent can't overspend" into a guarantee.
