# PayPal hackathon submission template

Fill the placeholders. Check the official form for exact field names.

**Project name:** PactPay
**Tagline:** Let your AI agent shop. Keep the final say.

**Inspiration / problem**
AI agents can browse and check out, but nobody trusts them with money. Between "you said yes" and "the money moved", a price edit, a hidden fee or one line of small print aimed at the agent can change the deal. Fraud checks don't help: a legitimate offer that drifted isn't fraud.

**What it does**
PactPay adds the missing step between authorizing a payment and capturing it. You approve typed rules once; the agent finds live offers; PayPal Sandbox holds the payment (`intent=AUTHORIZE`); and right before capture a fixed gate re-fetches the live offer and live PayPal authorization and re-checks every rule. Anything changed, stale or unknown voids the hold and captures nothing. A Checkout Inspector reads the real checkout page twice, with two independent Meta models, and its verdict is read by the same gate.

**How we use PayPal**
Orders v2 (create with `intent=AUTHORIZE`), Payments v2 (authorize read-back, capture once, void), idempotent request IDs, verified webhooks, live state reconciliation, a capture-review state for uncertain outcomes. All against the Sandbox; every call refuses non-Sandbox hosts.

**How we use AI**
Meta Muse Spark drafts rules, runs the tool-calling agent and reads checkout screenshots; Muse Spark Open (via Baseten) is the second reader; Muse Voice Transcribe takes voice input. No model is in the settlement path.

**Challenges** [YOU]
**Accomplishments** Server-enforced autonomy; a gate that treats unknown as not allowed; 184 tests with no network.
**What we learned** [YOU]
**What's next** Browser extension that captures the live checkout page; saved payment methods; agent identity standards; real merchant attestations.

**Links:** Repo [YOU] · Video [YOU] · Live app [YOU] · Judge login `judge` / `PactPay-Judge-2026` · PayPal buyer test login [YOU]
**Honest limits:** Sandbox only; no retailer order is placed; shipping and tax are fixed test values; the Inspector reads an uploaded screenshot. See `docs/LIMITATIONS.md`.
