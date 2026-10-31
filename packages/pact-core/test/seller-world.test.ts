import { describe, expect, it } from "vitest";
import { evaluatePact, summarizeVerification } from "../src/policy.js";
import { evaluateSettlementGate, type SettlementGateFacts } from "../src/settlement-state.js";
import {
  applyChannel3BoundTestScenario, buildChannel3BoundTestOffer, buildProtectedDemoPact, type Channel3BoundSource,
} from "../src/settlement-demo.js";
import { blockedBySellerWorld, isBlockingScenario, offerKey, sellerWorldReason } from "../src/seller-world.js";

const now = new Date("2026-10-22T12:00:00.000Z");
const tx = "00000000-0000-4000-8000-000000000042";
const source: Channel3BoundSource = {
  snapshotId: "00000000-0000-4000-8000-000000000014", productId: "charger-20w", title: "USB C Charger Block 20W", description: "A charger.",
  brand: "Nano", imageUrl: null, domain: "walmart.com", offerUrl: "https://walmart.example/charger", itemPrice: 11.99, currency: "USD",
  availability: "InStock", condition: "new", ramGb: null, structuredAttributes: {}, fetchedAt: now.toISOString(),
  validUntil: new Date(now.getTime() + 10 * 60_000).toISOString(),
};

function pactWithRules() {
  const base = buildProtectedDemoPact(tx, now);
  return {
    ...base,
    constraints: [
      { id: "in-stock", kind: "attribute" as const, severity: "hard" as const, description: "Item must be in stock", expected: "InStock", comparator: "eq" as const, field: "attributes.availability" },
      { id: "item-cap", kind: "attribute" as const, severity: "hard" as const, description: "Item price at most 50", expected: 50, comparator: "lte" as const, field: "attributes.itemPrice" },
      { id: "currency-match", kind: "attribute" as const, severity: "hard" as const, description: "Priced in USD", expected: "USD", comparator: "eq" as const, field: "currency" },
    ],
  };
}

function gateFacts(over: Partial<SettlementGateFacts>): SettlementGateFacts {
  return {
    pactApproved: true, transactionBindingValid: true, currentSnapshotMatched: true, authorizationId: "AUTH-1", authorizationStatus: "CREATED",
    authorizationNotExpired: true, authorizationAmount: "18.34", authorizationCurrency: "USD", verifiedTotal: "18.34", verifiedCurrency: "USD",
    hardConstraintsPass: true, evidenceFresh: true, evidenceAttributable: true, evidenceConflictFree: true, securityClear: true, ...over,
  };
}

describe("settlement safety invariant: a first authorization that no longer matches is never captured", () => {
  const pact = pactWithRules();
  const baseline = buildChannel3BoundTestOffer(tx, source, now);

  it("the unchanged offer is the only one the gate lets through", () => {
    const check = evaluatePact(pact, baseline, { securityClear: true, now: new Date(now.getTime() + 1000) });
    expect(summarizeVerification(check).decision).toBe("capture");
  });

  it.each(["OUT_OF_STOCK", "PRICE_INCREASE", "PROMPT_INJECTION", "CURRENCY_MISMATCH"] as const)("%s: policy blocks it and the gate never reaches CAPTURE_ELIGIBLE", (scenario) => {
    const changed = applyChannel3BoundTestScenario(scenario, baseline, pact, new Date(now.getTime() + 1000));
    const check = evaluatePact(pact, changed.offer, { securityClear: changed.securityFinding === null, now: new Date(now.getTime() + 2000) });
    const summary = summarizeVerification(check);
    expect(summary.decision).toBe("block");
    const gate = evaluateSettlementGate(gateFacts({
      hardConstraintsPass: summary.decision === "capture", securityClear: check.securityClear, evidenceFresh: check.evidenceFresh,
      evidenceAttributable: check.evidenceAttributable, verifiedCurrency: changed.offer.currency,
      verifiedTotal: changed.offer.total === null || changed.offer.total === undefined ? "0.00" : changed.offer.total.toFixed(2),
    }));
    expect(gate.decision).toBe("BLOCK");
    expect(gate.reasons.length).toBeGreaterThan(0);
  });

  it("a retry cannot launder the same offer: its identity is stable across new snapshots and stays blocked", () => {
    const firstSearch = offerKey("charger-20w", "walmart.com");
    const secondSearch = offerKey(" charger-20w ", "WWW.Walmart.com"); // new snapshot id, same offer
    expect(secondSearch).toBe(firstSearch);
    const effects = [{ offerKey: firstSearch, scenarioId: "OUT_OF_STOCK", appliedAt: now.toISOString() }];
    expect(blockedBySellerWorld(effects, secondSearch)).toMatch(/out of stock/);
    expect(blockedBySellerWorld(effects, offerKey("charger-20w", "bestbuy.com"))).toBeNull();
    expect(blockedBySellerWorld(effects, offerKey("other-product", "walmart.com"))).toBeNull();
  });
});

describe("seller-world scenarios", () => {
  it("only the changes that make an offer unusable persist, and each has a plain reason", () => {
    for (const id of ["OUT_OF_STOCK", "PRICE_INCREASE", "PROMPT_INJECTION", "CURRENCY_MISMATCH"]) {
      expect(isBlockingScenario(id)).toBe(true);
      expect(sellerWorldReason(id)).toMatch(/reset the simulation/);
    }
    expect(isBlockingScenario("BASELINE")).toBe(false);
    expect(isBlockingScenario("__proto__")).toBe(false);
    expect(sellerWorldReason("BASELINE")).toBeNull();
  });
});
