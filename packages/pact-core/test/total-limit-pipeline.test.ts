import { describe, expect, it } from "vitest";
import type { Evidence, PurchasePact } from "../src/index.js";
import { evaluatePact, summarizeVerification, type OfferSnapshot } from "../src/policy.js";
import { applyCheckoutQuote, quoteRulesFor, type QuoteEvaluationLike } from "../src/checkout-quote.js";

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
  // Exactly what the home page sends: the total limit is also stored as maxTotalAmount, which makes the engine add a hidden system.budget_cap rule.
  return { id: "p", version: 1, currency: "USD", ...(totalLimit !== null ? { maxTotalAmount: totalLimit } : {}), constraints, authority: { canSearch: true, canCompare: true, canCreateOrder: true, canAuthorize: true, canCapture: false, canSubstitute: false, canChangeHardConstraints: false } };
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
  return { before: base.summary.decision, after: applyCheckoutQuote(base, { price, currency: "USD" }, quoteRulesFor(p)) };
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
  it("also resolves the hidden system.budget_cap rule the engine adds for a total limit", () => {
    const { after } = shortlistVerdict(9.99, 50);
    expect(after.verification.results.find((r) => r.constraintId === "system.budget_cap")).toMatchObject({ status: "pass" });
    expect(after.summary.decision).toBe("capture");
  });
  it("would stay blocked if only the visible rule were resolved (the bug this test guards)", () => {
    const p = pact(50);
    const verification = evaluatePact(p, catalogOffer(9.99), { securityClear: true, now: NOW });
    const base = { verification, summary: summarizeVerification(verification), missingHardEvidence: [] } as unknown as QuoteEvaluationLike;
    expect(applyCheckoutQuote(base, { price: 9.99, currency: "USD" }, p.constraints).summary.decision).toBe("block");
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
