import { describe, expect, it } from "vitest";
import type { Evidence, PurchasePact } from "../src/index.js";
import { evaluatePact, summarizeVerification, type OfferSnapshot } from "../src/policy.js";
import { applyCheckoutQuote, type QuoteEvaluationLike } from "../src/checkout-quote.js";

/**
 * Regression for "a final-total limit leaves the agent unable to choose anything".
 * A live catalog only knows the item price, so a total limit is UNKNOWN at shortlist time. These tests run the
 * real policy engine on a catalog-style offer and check that the shortlist estimate resolves it correctly.
 */
const COLLECTED = "2026-10-22T10:00:00.000Z";
const VALID_UNTIL = "2026-10-22T10:10:00.000Z";
const NOW = new Date("2026-10-22T10:05:00.000Z");

function pact(totalLimit: number | null): PurchasePact {
  const constraints: PurchasePact["constraints"] = [
    { id: "max-catalog-item-price", kind: "budget", severity: "hard", description: "Item price at most 50", expected: 50, comparator: "lte", field: "attributes.itemPrice" },
    { id: "in-stock", kind: "attribute", severity: "hard", description: "Item must be in stock", expected: "InStock", comparator: "eq", field: "attributes.availability" },
    { id: "currency-match", kind: "attribute", severity: "hard", description: "Priced in USD", expected: "USD", comparator: "eq", field: "currency" },
  ];
  if (totalLimit !== null) constraints.push({ id: "max-landed-total", kind: "budget", severity: "hard", description: `Total at most ${totalLimit}`, expected: totalLimit, comparator: "lte", field: "total" });
  return { id: "p", version: 1, currency: "USD", constraints, authority: { canSearch: true, canCompare: true, canCreateOrder: true, canAuthorize: true, canCapture: false, canSubstitute: false, canChangeHardConstraints: false } };
}

function evidence(id: string, field: string, value: string | number): Evidence {
  return { id, source: "channel3", sourceType: "channel3", collectedAt: COLLECTED, validUntil: VALID_UNTIL, claim: field, value, field, subjectRef: "offer-1", provenanceRef: "https://shop.example/offer-1" };
}

function catalogOffer(price: number): OfferSnapshot {
  return {
    id: "offer-1", currency: "USD", total: null,
    attributes: { itemPrice: price, availability: "InStock" },
    evidence: [evidence("e1", "attributes.itemPrice", price), evidence("e2", "attributes.availability", "InStock"), evidence("e3", "currency", "USD")],
  };
}

function shortlistVerdict(price: number, totalLimit: number | null) {
  const p = pact(totalLimit);
  const verification = evaluatePact(p, catalogOffer(price), { securityClear: true, now: NOW });
  const base = { verification, summary: summarizeVerification(verification), missingHardEvidence: verification.results.filter((r) => r.status === "unknown").map((r) => ({ constraintId: r.constraintId })) } as unknown as QuoteEvaluationLike;
  return { before: base.summary.decision, after: applyCheckoutQuote(base, { price, currency: "USD" }, p.constraints) };
}

describe("a final-total limit on a catalog offer", () => {
  it("is unknown without the estimate, which is why nothing could be chosen", () => {
    const { before } = shortlistVerdict(11.99, 50);
    expect(before).toBe("block");
  });
  it("lets a compliant offer be chosen once the checkout estimate is applied", () => {
    const { after } = shortlistVerdict(11.99, 50);
    expect(after.summary.decision).toBe("capture");
    expect(after.verification.results.find((r) => r.constraintId === "max-landed-total")).toMatchObject({ status: "pass", actual: 18.34 });
  });
  it("blocks an offer whose estimated total is over the limit, with the real number", () => {
    const { after } = shortlistVerdict(45, 50); // 45 + 4.99 shipping + 8% tax on (45 + 4.99) = 53.99
    expect(after.summary.decision).toBe("block");
    expect(after.verification.results.find((r) => r.constraintId === "max-landed-total")?.actual).toBe(53.99);
  });
  it("without a total limit the same offer is chosen on its item price alone", () => {
    expect(shortlistVerdict(45, null).before).toBe("capture");
  });
  it("still blocks when another must-have rule fails, whatever the total", () => {
    const { after } = shortlistVerdict(60, 500); // item price 60 > 50 cap
    expect(after.summary.decision).toBe("block");
    expect(after.verification.results.find((r) => r.constraintId === "max-catalog-item-price")?.status).toBe("fail");
  });
});
