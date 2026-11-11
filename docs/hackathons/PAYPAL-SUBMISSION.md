# Devpost submission text: PayPal AI Hackathon

**Project name:** PactPay

**Tagline (60 chars):** Let your AI agent shop. PayPal holds the money until it's right.

## Inspiration
AI agents can browse and check out, but nobody has solved what happens between "you said yes" and "the money moved": a price edit, a fee that wasn't itemized, or hidden text on the page telling the agent to ignore your budget. About half of consumers say the AI platform, not the retailer, should be responsible for unauthorized agent purchases. Fully autonomous payment isn't something people trust yet.

## What it does
You say what you want and approve rules once. An AI agent searches a live catalog and ranks offers against your locked rules. **PayPal authorizes (holds) the payment.** Right before release, PactPay re-checks the live offer and reads the real checkout page; fixed code (not a model) decides. If everything still matches, PayPal **captures** once. If anything slipped, PactPay **voids** the hold and $0 moves.

**PactPay Guard** extends this to any store, and works on its own with no account: a Manifest V3 browser extension where you say your rules in plain words and approve them in a pop-up on the page. It reads the real checkout page, finds hidden fees, charges drawn by CSS, and invisible instructions aimed at AI agents, and puts a speed bump on the pay button for people and agents alike. A code reader and a screenshot reader each catch what the other can't, and if they disagree about the money nothing is called safe.

## How we built it (PayPal + AI)
- **PayPal:** Orders v2 (`AUTHORIZE`), Payments v2 (capture, void, get), signed Webhooks verified against an audit chain. Idempotent requests, amount and currency reconciliation, tested without a network.
- **AI:** Meta Muse Spark 1.3 (tool-calling shopping agent, rule drafting with strict JSON schema, vision reading of checkout screenshots), Muse Spark Open as an independent second reader, Muse Voice Transcribe for voice input. Models only propose or read; they never decide.
- **Agentic commerce:** PactPay exposes its own MCP server and HTTP API so any agent can shop through the same gate, with a limited, expiring, revocable key. A red-team script proves a misbehaving agent can't change its rules, raise its limit or settle above it.
- **Guard:** MV3 extension (content script, background worker, popup), a deterministic page reader, and a pure `guardPage` engine with 23 unit tests, device identity + one-time account linking, and 31 extension tests that drive the real on-page UI.
- **Sponsor tools:** AG Grid (Activity: transactions, policy runs and Guard checks), Channel3 (live product catalog and offer refresh at settlement), Render (hosting blueprint).
- Next.js 16, React 19, TypeScript, PostgreSQL, Vitest (244 core tests, no network).

## Challenges
Making "unknown is never safe" real: missing shipping or tax is "can't verify", never zero. Making two heterogeneous readers (DOM code and screenshot) comparable without fragile label matching. Keeping every model out of the money path.

## Accomplishments
A working end-to-end Sandbox flow including a *blocked* capture, a browser extension judges can install in 30 seconds and try on a built-in demo store, and an honest limitations page.

## What we learned
PayPal's authorize-then-capture split is the right primitive for agent payments: the hold gives you time to verify, and void makes "no" free.

## What's next
Chrome Web Store release; PayPal Agent Toolkit / MCP guard wrapper; real user accounts and per-merchant mandates; Payouts for agent-to-agent settlement.

## Built with
paypal-sandbox, paypal-orders-v2, paypal-payments-v2, paypal-webhooks, mcp, meta-muse, typescript, next.js, react, postgresql, ag-grid, channel3, render, chrome-extension-mv3

## Required fields checklist
- [ ] Public GitHub repo with visible LICENSE (MIT is in the repo; check it shows in the About box)
- [ ] YouTube link, public, under 3:00, no third-party trademarks or music
- [ ] Hosted demo URL + judge login + **PayPal Sandbox buyer credentials** in README
- [ ] "Tools used" text above (AI services and how they're used)
- [ ] Sponsor tools ticked: AG Grid, Channel3, Render
- [ ] Explain what changed during the hackathon (see below)

## When it was built
Write what is true. If the whole project was built after Oct 1 (the Submission Period start), say so and you don't need any "significantly updated" explanation, for example: "PactPay was built from scratch during the Submission Period (Oct 2 to Nov 12)." If any part existed earlier, name it and say what you added. Judges can read the repo history, so keep this consistent with it.
