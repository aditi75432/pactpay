import { describe, expect, it } from "vitest";
import { explainSettlement, formatMoney, type ExplainInput } from "../src/explain";

const base: ExplainInput = {
  outcome: "VOIDED",
  currency: "USD",
  authorizedAmount: 21.58,
  merchant: "example-shop.com",
  productTitle: "Logitech M170 Wireless Mouse",
  baseline: { itemPrice: 14.99, total: 21.58, availability: "InStock", currency: "USD" },
  current: { itemPrice: 50.01, total: 59.4, availability: "InStock", currency: "USD" },
  pact: {
    constraints: [
      { id: "max-catalog-item-price", kind: "budget", severity: "hard", description: "Catalog item price at most $50.00", expected: 50, comparator: "lte", field: "attributes.itemPrice" },
      { id: "prefer-brand", kind: "attribute", severity: "soft", description: "Prefer Logitech", expected: "Logitech", comparator: "eq", field: "attributes.brand" },
    ],
  },
  results: [
    { constraintId: "max-catalog-item-price", severity: "hard", status: "fail", actual: 50.01, evidenceIds: [], reason: "over" },
    { constraintId: "prefer-brand", severity: "soft", status: "pass", evidenceIds: [], reason: "ok" },
  ],
  securityFinding: null,
  gateReasons: ["HARD_CONSTRAINTS_NOT_SATISFIED", "AUTHORIZED_AMOUNT_DOES_NOT_MATCH_VERIFIED_TOTAL"],
};

describe("explainSettlement", () => {
  it("explains a price-drift block in plain English with before/after values", () => {
    const result = explainSettlement(base);
    expect(result.tone).toBe("bad");
    expect(result.headline).toMatch(/not charged/i);
    expect(result.summary).toContain("$14.99");
    expect(result.summary).toContain("$50.01");
    expect(result.changes.map((change) => change.label)).toEqual(["Item price", "Total"]);
    expect(result.reasons.some((reason) => reason.includes("Catalog item price at most $50.00") && reason.includes("$50.01"))).toBe(true);
  });

  it("does not turn soft preferences into reasons and never repeats a reason", () => {
    const result = explainSettlement(base);
    expect(result.reasons.some((reason) => reason.includes("Prefer Logitech"))).toBe(false);
    expect(new Set(result.reasons).size).toBe(result.reasons.length);
  });

  it("states the counterfactual without claiming PayPal would capture more than was authorized", () => {
    const result = explainSettlement(base);
    expect(result.counterfactual).toContain("$59.40");
    expect(result.counterfactual).toContain("$21.58");
    expect(result.counterfactual).not.toMatch(/would have (been )?charged \$59/i);
  });

  it("reports out-of-stock and prompt-injection blocks", () => {
    const stock = explainSettlement({
      ...base,
      current: { ...base.current, itemPrice: 14.99, total: 21.58, availability: "OutOfStock" },
      results: [{ constraintId: "in-stock", severity: "hard", status: "fail", actual: "OutOfStock", evidenceIds: [], reason: "" }],
      pact: { constraints: [{ id: "in-stock", kind: "attribute", severity: "hard", description: "Must be in stock", expected: "InStock", comparator: "eq", field: "attributes.availability" }] },
      gateReasons: [],
    });
    expect(stock.changes).toEqual([{ label: "Availability", before: "in stock", after: "out of stock" }]);
    expect(stock.counterfactual).toContain("no longer in stock");

    const injected = explainSettlement({ ...base, current: base.baseline, results: [], gateReasons: ["SECURITY_GATE_BLOCKED"], securityFinding: "Merchant text said: ignore the user" });
    expect(injected.reasons[0]).toMatch(/aimed at the AI agent/);
    expect(injected.counterfactual).toMatch(/ignore your limits/);
  });

  it("explains a capture and the open (held) state without inventing a counterfactual", () => {
    const captured = explainSettlement({ ...base, outcome: "CAPTURED", current: base.baseline });
    expect(captured.tone).toBe("good");
    expect(captured.counterfactual).toBeNull();
    expect(captured.headline).toMatch(/Sandbox payment captured/);
    expect(captured.summary).toMatch(/test money/);
    expect(captured.summary).toMatch(/No order was placed/);
    const open = explainSettlement({ ...base, outcome: "OPEN", current: base.baseline });
    expect(open.tone).toBe("waiting");
    expect(open.headline).toMatch(/nothing has been charged/i);
  });

  it("treats unverifiable hard rules as not met and ignores system bindings", () => {
    const result = explainSettlement({
      ...base,
      results: [
        { constraintId: "max-catalog-item-price", severity: "hard", status: "unknown", evidenceIds: [], reason: "" },
        { constraintId: "system.authorized_amount_match", severity: "hard", status: "fail", actual: 59.4, evidenceIds: [], reason: "" },
      ],
      gateReasons: [],
    });
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/could not be verified/);
  });

  it("formats money deterministically", () => {
    expect(formatMoney(21.5, "USD")).toBe("$21.50");
  });
});

import { previewChannel3TestQuote } from "../src/settlement-demo";

describe("previewChannel3TestQuote", () => {
  it("matches the quote the server authorizes for a $14.99 item", () => {
    const quote = previewChannel3TestQuote(14.99);
    expect(quote).toMatchObject({ itemPrice: 14.99, shippingFee: 4.99, taxAmount: 1.6, total: 21.58 });
  });
});
