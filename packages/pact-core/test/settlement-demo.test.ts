import { describe, expect, it } from "vitest";
import { evaluatePact, summarizeVerification } from "../src/policy.js";
import {
  applyChannel3BoundTestScenario,
  applyProtectedDemoScenario,
  buildAuthorizedAmountPact,
  buildChannel3BoundTestOffer,
  buildProtectedDemoOffer,
  buildProtectedDemoPact,
  isChannel3OfferPurchasable,
  type Channel3BoundSource,
  type ProtectedDemoScenarioId,
} from "../src/settlement-demo.js";

const now = new Date("2026-10-19T12:00:00.000Z");

function evaluate(scenario: ProtectedDemoScenarioId) {
  const tx = "00000000-0000-4000-8000-000000000001";
  const baseline = buildProtectedDemoOffer(tx, now);
  const pact = buildAuthorizedAmountPact(buildProtectedDemoPact(tx, now), "849.00", "USD");
  const mutation = applyProtectedDemoScenario(tx, scenario, new Date(now.getTime() + 1000), baseline);
  const verification = evaluatePact(pact, mutation.offer, { securityClear: mutation.securityFinding === null, now: new Date(now.getTime() + 2000) });
  return { verification, summary: summarizeVerification(verification), mutation, pact, baseline };
}

describe("protected settlement demo fixtures", () => {
  it("allows baseline only at the deterministic policy layer", () => {
    const result = evaluate("BASELINE");
    expect(result.summary.decision).toBe("capture");
    expect(result.verification.results.every((item) => item.status === "pass")).toBe(true);
    expect(result.pact.authority.canCapture).toBe(false);
  });

  it.each(["BUDGET_OVERRUN", "PRODUCT_DOWNGRADE", "DELIVERY_SLIP", "RETURNS_DOWNGRADE", "PROMPT_INJECTION", "CURRENCY_MISMATCH"] as const)("blocks %s", (scenario) => {
    expect(evaluate(scenario).summary.decision).toBe("block");
  });

  it("preserves the original delivery deadline when scenario facts drift", () => {
    const result = evaluate("DELIVERY_SLIP");
    const delivery = result.verification.results.find((item) => item.constraintId === "delivery");
    expect(delivery?.status).toBe("fail");
  });
});


describe("Channel3-bound Sandbox checkout adapter", () => {
  const tx = "00000000-0000-4000-8000-000000000013";
  const sourceSnapshotId = "00000000-0000-4000-8000-000000000014";
  const source: Channel3BoundSource = {
    snapshotId: sourceSnapshotId,
    currentObservationSnapshotId: sourceSnapshotId,
    productId: "mouse-123",
    title: "Wireless Mouse",
    description: "A catalog-sourced mouse listing.",
    brand: "Logitech",
    imageUrl: "https://example.test/mouse.png",
    domain: "store.example.test",
    offerUrl: "https://store.example.test/mouse-123",
    itemPrice: 49.99,
    currency: "USD",
    availability: "InStock",
    condition: "new",
    ramGb: null,
    structuredAttributes: { connection: "wireless" },
    fetchedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };

  it("binds the saved catalog snapshot while clearly labelling shipping, tax and total as test terms", () => {
    const offer = buildChannel3BoundTestOffer(tx, source, now);
    expect(offer.sourceSnapshotId).toBe(sourceSnapshotId);
    expect(offer.sourceProductId).toBe("mouse-123");
    expect(offer.sourceDomain).toBe("store.example.test");
    expect(offer.attributes.itemPrice).toBe(49.99);
    expect(offer.total).toBe(59.38);
    expect(offer.sandboxQuote.shippingFee).toBe(4.99);
    expect(offer.sandboxQuote.taxAmount).toBe(4.4);
    expect(offer.sandboxQuote.disclaimer).toMatch(/not merchant checkout terms/i);
    expect(offer.evidence.find((item) => item.field === "attributes.itemPrice")?.sourceType).toBe("channel3");
    expect(offer.evidence.find((item) => item.field === "total")?.sourceType).toBe("simulator");
  });

  it("treats missing or negative catalog availability as not purchasable", () => {
    expect(isChannel3OfferPurchasable("InStock")).toBe(true);
    expect(isChannel3OfferPurchasable("LimitedAvailability")).toBe(true);
    expect(isChannel3OfferPurchasable("OutOfStock")).toBe(false);
    expect(isChannel3OfferPurchasable(null)).toBe(false);
    expect(isChannel3OfferPurchasable("unknown")).toBe(false);
  });

  it("marks price increase as a simulator mutation and does not rewrite the source snapshot", () => {
    const basePact = buildProtectedDemoPact(tx, now);
    const pact = {
      ...basePact,
      constraints: [...basePact.constraints, {
        id: "item-price-cap",
        kind: "attribute" as const,
        severity: "hard" as const,
        description: "Catalog item price must be at most 50 USD.",
        expected: 50,
        comparator: "lte" as const,
        field: "attributes.itemPrice",
      }],
    };
    const baseline = buildChannel3BoundTestOffer(tx, source, now);
    const changed = applyChannel3BoundTestScenario("PRICE_INCREASE", baseline, pact, new Date(now.getTime() + 1000));
    expect(Number(changed.offer.attributes.itemPrice)).toBeGreaterThan(50);
    expect(changed.offer.sourceSnapshotId).toBe(sourceSnapshotId);
    expect(changed.offer.sourceItemPrice).toBe(49.99);
    expect(changed.offer.evidence.find((item) => item.field === "attributes.itemPrice")?.sourceType).toBe("simulator");
    expect(changed.offer.scenarioApplied?.note).toMatch(/live Channel3 snapshot is unchanged/i);
  });

  it("marks out-of-stock and prompt-injection scenarios as test fixtures, not live merchant changes", () => {
    const pact = buildProtectedDemoPact(tx, now);
    const baseline = buildChannel3BoundTestOffer(tx, source, now);
    const unavailable = applyChannel3BoundTestScenario("OUT_OF_STOCK", baseline, pact, new Date(now.getTime() + 1000));
    expect(unavailable.offer.attributes.availability).toBe("OutOfStock");
    expect(unavailable.offer.evidence.find((item) => item.field === "attributes.availability")?.sourceType).toBe("simulator");
    expect(unavailable.offer.scenarioApplied?.note).toMatch(/fixture only/i);

    const injected = applyChannel3BoundTestScenario("PROMPT_INJECTION", baseline, pact, new Date(now.getTime() + 2000));
    expect(injected.securityFinding).toMatch(/test-fixture merchant text/i);
    expect(injected.offer.scenarioApplied?.note).toMatch(/controlled untrusted-merchant instruction fixture/i);
  });
});
