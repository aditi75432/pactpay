# Limitations and constraints

We would rather you hear these from us. Each item says what is true today.

## What is real, and what is not
- **Real:** the product catalog (Channel3), the PayPal Sandbox API calls (authorize, capture, void, read-back), the AI calls (Meta Muse models), and the re-check of the live catalog offer and live PayPal authorization at settlement.
- **Simulated:** the seller changing an offer after you approve it ("Demo control"). Real retailers won't change on cue, and a sandbox can't pay one. Every screen that shows a simulated change says so.
- **Fixed test values:** shipping is a flat $4.99 and tax is 8% of item plus shipping. The total shown on the shortlist is computed the same way the server computes the PayPal amount.
- **Not built:** retailer checkout. PactPay never places an order with a store. Money is PayPal Sandbox test money only, and every PayPal call refuses to run against any non-Sandbox host.

## Product limits
- **A person approves each hold on PayPal.** PactPay doesn't skip that step. Saved payment methods could remove it; that is future work and untested here.
- **USD only.** Test checkout supports US dollars. Rules written in another currency are flagged and need to be re-entered in USD.
- **One catalog provider.** Coverage, freshness and latency are Channel3's. Offers can be missing or delayed.
- **Total limits are checked in two steps.** On the shortlist, the total is an estimate (item plus the fixed test shipping and tax). The settlement gate re-checks the real total.
- **Seller-text facts are not verified.** They are labelled "seller-stated" and never change a payment decision.
- **AI can be wrong.** Rules are written by a model and reviewed by you before they take effect. If the AI service is unavailable, a basic parser is used and labelled.

## Security and accounts
- **Basic accounts.** Username and password only. No email verification, password reset, or multi-factor sign-in. A shared demo account exists for reviewers and shows shared activity.
- **Agent keys are not agent identities.** A key is a limited bearer credential bound to one set of approved rules. Anyone who can approve rules can create a key, so a key protects the shopper from the agent, not from their own account. A production system would authenticate agents separately.
- **Rate limits are per server process** (in memory). They protect a single-instance demo, not a scaled deployment.
- **The audit trail is tamper-evident, not tamper-proof.** An operator who rewrites the whole chain without an external checkpoint could change history undetected.
- **Not a regulated financial product.** No KYC, PCI-DSS or other compliance claims are made.

## Evidence limits
- **Catalog drift is not checkout drift.** The drift tooling measures what the catalog reports. It says nothing about what a retailer's checkout page charges.
- **Drift numbers are only as good as the collection window.** We publish a number only if we collected one, with its window and size.

## Operations
- **Free hosting sleeps.** Free Render web services spin down when idle and the free database expires after 30 days. For a judging window, use a paid database plan or recreate and test before judging.
- **Accessibility has not been audited.** The interface uses semantic markup and visible focus, but no formal review was done.
- **English only.**

## Meta layer limits

- The Checkout Inspector can't catch a model that misreads a page the same way twice. Two readings, cross-model agreement and arithmetic make that unlikely, not impossible.
- The Inspector reads screenshots you give it. It is not attached to a live retailer checkout.
- The Inspector's verdict affects settlement only when an inspection is attached to that order (open it from the order page). With none attached, the other gate checks decide, unchanged. The latest inspection for an order wins; if the lookup fails, the gate fails closed.
- A missing field, unreadable page, missing shipping/tax or total, or two readings that disagree all end in *Can't verify*. Missing data is never treated as agreement.
- Checkout pages are only as honest as the screenshot: a doctored screenshot proves nothing. A production version would capture the page itself.
- Inspections add two model calls per run (cost and latency). Runs with one provider configured use one model for both readings, which is weaker; the UI labels this.
- Voice input needs the Meta Model API key and a browser that allows the microphone. Recordings are capped at about 25 seconds.
- The Muse Agent run issues a fresh agent key for your approval, which replaces any earlier key for it.
- Live Meta API behavior was verified against a local mock that checks the documented request shape; run it with your own key before recording.
- Interactive timeouts: Muse Spark reasons before answering. Short structured calls use `reasoning_effort: "minimal"` and the timeout is clamped to 3-60 s (default generous); set `AI_TIMEOUT_MS` to a number or leave it unset.
- Demo video footage of PayPal approval is Sandbox only and should be labelled as such.
