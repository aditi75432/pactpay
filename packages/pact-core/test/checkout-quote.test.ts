import { describe, expect, it } from "vitest";
import { applyCheckoutQuote, type QuoteEvaluationLike } from "../src/checkout-quote";

const rules = [
  { id: "max-catalog-item-price", field: "attributes.itemPrice", comparator: "lte", expected: 50 },
  { id: "max-landed-total", field: "total", comparator: "lte", expected: 50 },
];

function evaluation(overrides: Partial<QuoteEvaluationLike["verification"]> = {}, totalStatus: "unknown" | "pass" = "unknown", itemStatus: "pass" | "unknown" = "pass"): QuoteEvaluationLike {
  return {
    verification: {
      securityClear: true, evidenceFresh: true, evidenceAttributable: true,
      results: [
        { constraintId: "max-catalog-item-price", severity: "hard", status: itemStatus, actual: 14.99, reason: "ok" },
        { constraintId: "max-landed-total", severity: "hard", status: totalStatus, reason: "The live catalog doesn't provide enough evidence." },
        { constraintId: "prefer-brand", severity: "soft", status: "pass", reason: "ok" },
      ],
      ...overrides,
    },
    summary: { decision: "block", hardPasses: 1, hardFailures: 0 },
    missingHardEvidence: [{ constraintId: "max-landed-total" }],
  };
}

describe("applyCheckoutQuote", () => {
  it("resolves an unknown total cap using the test quote so a compliant offer can be chosen", () => {
    const result = applyCheckoutQuote(evaluation(), { price: 14.99, currency: "USD" }, rules);
    const total = result.verification.results.find((item) => item.constraintId === "max-landed-total");
    expect(total).toMatchObject({ status: "pass", actual: 21.58 });
    expect(total?.reason).toMatch(/checks it again at checkout/);
    expect(result.summary).toMatchObject({ decision: "capture", hardFailures: 0, hardPasses: 2 });
    expect(result.missingHardEvidence).toEqual([]);
  });

  it("clears the freshness flags the total rule was holding down, but only when every other must-have passed", () => {
    const held = applyCheckoutQuote(evaluation({ evidenceFresh: false, evidenceAttributable: false }), { price: 14.99, currency: "USD" }, rules);
    expect(held.verification.evidenceFresh).toBe(true);
    expect(held.summary.decision).toBe("capture");
  });

  it("fails the total rule when the estimated total is over the limit", () => {
    const result = applyCheckoutQuote(evaluation(), { price: 49.5, currency: "USD" }, rules);
    const total = result.verification.results.find((item) => item.constraintId === "max-landed-total");
    expect(total?.status).toBe("fail");
    expect(result.summary.decision).toBe("block");
    expect(result.summary.hardFailures).toBe(1);
  });

  it("never rescues an offer that fails a safety or evidence check", () => {
    // Stale evidence on ANOTHER must-have rule: that rule is unknown, so the offer stays blocked.
    const stale = applyCheckoutQuote(evaluation({ evidenceFresh: false, evidenceAttributable: false }, "unknown", "unknown"), { price: 14.99, currency: "USD" }, rules);
    expect(stale.summary.decision).toBe("block");
    expect(stale.verification.evidenceFresh).toBe(false);
    const unsafe = applyCheckoutQuote(evaluation({ securityClear: false }), { price: 14.99, currency: "USD" }, rules);
    expect(unsafe.summary.decision).toBe("block");
  });

  it("leaves non-USD offers, offers without a total rule, and already-known totals untouched", () => {
    const base = evaluation();
    expect(applyCheckoutQuote(base, { price: 14.99, currency: "EUR" }, rules)).toBe(base);
    expect(applyCheckoutQuote(base, { price: 14.99, currency: "USD" }, [rules[0]!])).toBe(base);
    const known = evaluation({}, "pass");
    expect(applyCheckoutQuote(known, { price: 14.99, currency: "USD" }, rules)).toBe(known);
  });

  it("does not mutate its input", () => {
    const base = evaluation();
    const snapshot = JSON.stringify(base);
    applyCheckoutQuote(base, { price: 14.99, currency: "USD" }, rules);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
