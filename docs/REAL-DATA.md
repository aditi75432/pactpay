# Real data: what is real, what we measure, and what a browser extension would add

## Real today
- The product catalog (titles, merchants, prices, availability) is live data from Channel3.
- PayPal calls (authorize, capture, void, read-back) are real Sandbox API calls.
- The check at settlement re-reads the live catalog offer, so a real change would be caught.

## Simulated today
- The seller changing the deal after you approve. Real stores won't change on cue, and a sandbox can't pay one. This is labelled everywhere.

## How we get real drift numbers
Run the collector for a few days and publish what it measures:

```bash
pnpm drift:watch -- --url https://<your-app> --every 30    # leave it running
pnpm drift:report                                           # writes docs/DRIFT-REPORT.md
```

It records price and availability of the same offers over time and reports what share changed, and how soon. Quote only what the report says, including its limits: it measures what the catalog reports, not what a retailer's checkout charges, and a short window gives indicative numbers only.

## Could this be a browser extension on real marketplaces?
Technically, yes, and it's a credible future direction, but it is not something to build for this submission:
- An extension can read the product and cart pages a user is on and compare what the agent saw with what checkout shows. That is the real version of the drift this prototype simulates.
- It can't move money through PactPay. At a real retailer the merchant controls checkout and capture, so an extension could warn or block the click, not authorize and void a PayPal hold.
- Retail pages differ and change constantly, so selectors break, and automated reading of retail sites can run against their terms.
- Reading a page the user is viewing is lower risk than automated scraping, but it still needs per-retailer work and review.

What to say: "The settlement gate is built so its evidence can come from a live catalog today and from a checkout-page extension or a merchant API tomorrow. Measuring real drift is the first step."
