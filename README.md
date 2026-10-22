# PactPay

**Let your AI agent shop. Keep the final say.**

PactPay sits between an AI shopping agent and your money. You say what you want and approve a short list of rules. The agent finds real offers and PayPal puts your payment on hold. Right before release, PactPay checks the seller's *current* offer against your rules. If it still matches, the payment goes through. If the seller changed something (a higher price, a downgraded spec, a sneaky instruction aimed at the agent), the hold is cancelled and you aren't charged.

Built for the PayPal AI Hackathon. Everything runs in **test mode**: PayPal Sandbox money, no real store orders.

> The AI can recommend. It can't release your money.

## The problem

AI agents can already browse and check out. What they can't do reliably is notice that the deal changed between "you said yes" and "the money moved." A merchant can be perfectly legitimate and still not be offering what you approved. Fraud checks don't catch that, because nothing is fraudulent. PactPay checks the one thing that matters: *is this still what the user approved?*

## How it works

1. **Describe** what you want in plain language. An AI model turns it into rules (Groq, `openai/gpt-oss-20b`). You edit and approve them. They are stored on the server and bound to your browser session. Nobody, including the agent, can loosen them afterward.
2. **Shortlist.** The agent searches a live product catalog (Channel3), saves an immutable snapshot of each offer, checks it against your rules, then re-confirms the best ones.
3. **Hold.** PayPal authorizes the amount. Nothing is captured.
4. **Check and settle.** A deterministic gate re-fetches the live PayPal authorization, re-verifies the offer, the approved rules and the audit trail, and only then lets a capture happen. Otherwise the authorization is voided.
5. **Explain.** You get a plain-English result, a before/after of what changed, and a tamper-evident receipt.

The AI writes your rules and explains outcomes. It never makes the capture decision. A fixed, tested function does.

## Run it locally

You need Node 20+, pnpm 10, and Docker (for Postgres).

```bash
pnpm install
cp .env.example apps/web/.env.local     # then fill in your keys
pnpm db:up
pnpm dev                                 # http://localhost:3000
```

Check everything is healthy:

```bash
pnpm --filter @pactpay/pact-core typecheck
pnpm --filter @pactpay/pact-core test
pnpm --filter web typecheck
```

On Windows PowerShell use `copy .env.example apps\web\.env.local`.

### Keys you need

| Service | What for | Get it |
|---|---|---|
| PayPal Sandbox app + a sandbox *buyer* account | Authorize, capture, void | developer.paypal.com |
| Channel3 | Live product catalog | channel3.com |
| Groq (optional) | AI rules and explanations | console.groq.com |

Without a Groq key the app still works. It uses a basic rule parser and plain templates, and it says so on screen.

## What is real and what is simulated

| Part | Status |
|---|---|
| Product search and refresh | **Live** Channel3 data |
| PayPal orders, authorization, capture, void | **Live PayPal Sandbox** API calls, test money |
| AI rule writing and explanations | **Live** Groq call (with labelled fallback) |
| Policy decision and settlement gate | **Real**, deterministic, unit tested |
| Shipping and tax | **Simulated**: fixed $4.99 and 8%, labelled everywhere |
| The seller changing the deal | **Simulated** by the "Demo control" panel, because a sandbox can't pay a real store and real stores won't change on cue |
| Retailer checkout | **Not integrated.** No store order is ever placed |

## Security model (short version)

- Rules are approved once, stored server-side, hashed, and bound to an unguessable httpOnly session cookie. Order routes accept only an approval id, never a browser-supplied Pact. Tampering with the stored row makes the hash check fail and the order is refused.
- The capture route re-fetches the live PayPal authorization, checks amount, currency, status and expiry, and uses a persisted idempotency claim so a double click or retry can't double capture.
- Uncertain outcomes (timeouts, ambiguous responses) go to review states instead of being retried blindly.
- Every step is written to a SHA-256 hash-chained audit log. It's tamper-evident against ordinary edits, but not against an operator who rewrites the whole chain without an external checkpoint.
- Expensive and mutating endpoints are rate limited (in memory, per process).
- This is a prototype: there are no user accounts. The session cookie is a bearer token, not real authentication.

## Where this fits

Agent payment standards such as Google's AP2 (signed Intent and Cart mandates) and research such as TessPay cover how an agent's authority is expressed and how payment is conditioned on proof. PactPay focuses on the gap after authorization and before capture: the offer can drift, and something has to check that it still matches what the user approved. It's meant to sit alongside those, not replace them.

## Repo map

```
apps/web         Next.js app: shopper flow, order screen, Activity (AG Grid), API routes
packages/pact-core   Pure TypeScript: policy engine, settlement state machine, audit chain,
                     explanations, rate limiter, test fixtures (93 tests)
lib              Server modules: PostgreSQL, PayPal, Channel3, pact approvals, audit chain
docs             Architecture, threat model, judge guide, demo script, changelog
```

See [`docs/JUDGES.md`](docs/JUDGES.md) for a two-minute path through the product, and [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for what's covered and what isn't.

## License

MIT. See [`LICENSE`](LICENSE).
