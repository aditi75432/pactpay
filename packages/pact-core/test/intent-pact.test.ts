import { describe, expect, it } from "vitest";
import { normalizeIntentCompilation, ruleBasedIntentCompilation, sanitizePurchasePact } from "../../../lib/intent-pact";

const baseDraft = {
  title: "Purchase pact · Laptop",
  searchQuery: "refurbished laptop",
  currency: "USD",
  maxTotalAmount: "900",
  assumptions: [],
  unverifiedRequirements: [],
};

describe("intent compilation comparator normalization", () => {
  it("repairs an LLM comparator contradiction only when the user explicitly asks for a matching minimum return window", () => {
    const compilation = normalizeIntentCompilation({
      ...baseDraft,
      constraints: [
        {
          id: "returns-minimum",
          description: "Return window must be at least 14 days.",
          field: "returnWindowDays",
          comparator: "lte",
          expected: "14",
          severity: "hard",
        },
      ],
    }, "GROQ", "test-model", "Find a refurbished laptop with a return window of at least 14 days under $900.");

    const returns = compilation.pact.constraints.find((constraint) => constraint.field === "returnWindowDays");
    expect(returns?.comparator).toBe("gte");
    expect(returns?.expected).toBe(14);
    expect(sanitizePurchasePact(compilation.pact).constraints.find((constraint) => constraint.field === "returnWindowDays")?.comparator).toBe("gte");
  });

  it("normalizes common comparator aliases without changing their direction", () => {
    const compilation = normalizeIntentCompilation({
      ...baseDraft,
      maxTotalAmount: "",
      constraints: [
        {
          id: "returns-minimum",
          description: "At least 14 days of returns.",
          field: "returnWindowDays",
          comparator: "at_least",
          expected: "14",
          severity: "hard",
        },
      ],
    }, "GROQ", "test-model", "At least 14 days of returns.");

    expect(compilation.pact.constraints.find((constraint) => constraint.field === "returnWindowDays")?.comparator).toBe("gte");
  });

  it("does not silently convert an unsupported maximum-return requirement into a minimum", () => {
    expect(() => normalizeIntentCompilation({
      ...baseDraft,
      maxTotalAmount: "",
      constraints: [
        {
          id: "returns-maximum",
          description: "Return window must be no more than 14 days.",
          field: "returnWindowDays",
          comparator: "lte",
          expected: "14",
          severity: "hard",
        },
      ],
    }, "GROQ", "test-model", "Return window must be no more than 14 days.")).toThrow(/unsupported comparator/);
  });
});


describe("rule-based fallback regex capture handling", () => {
  it("extracts present capture groups into typed rules without relying on unchecked indices", () => {
    const compilation = ruleBasedIntentCompilation(
      "Find a refurbished laptop with at least 16 GB RAM, deliver by 2026-10-23, return window of at least 14 days, shipping fee at most $25, prefer Lenovo, with a final total under $900.",
    );

    const rules = compilation.pact.constraints;
    expect(rules.find((rule) => rule.field === "attributes.ramGb")?.expected).toBe(16);
    expect(rules.find((rule) => rule.field === "deliveryDate")?.expected).toBe("2026-10-23");
    expect(rules.find((rule) => rule.field === "returnWindowDays")?.expected).toBe(14);
    expect(rules.find((rule) => rule.field === "shippingFee")?.expected).toBe(25);
    expect(rules.find((rule) => rule.field === "attributes.itemPrice")).toBeUndefined();
    expect(rules.find((rule) => rule.field === "attributes.brand")?.expected).toBe("Lenovo");
    expect(compilation.pact.maxTotalAmount).toBe(900);
  });
});


describe("catalog item-price caps stay distinct from landed totals", () => {
  const wirelessMouseIntent = "Find a wireless mouse with a catalog item price under $50 USD, in stock. Prefer Logitech.";

  it("rule-based fallback creates a catalog-price cap, in-stock rule, and soft brand preference", () => {
    const compilation = ruleBasedIntentCompilation(wirelessMouseIntent);
    expect(compilation.searchQuery.toLowerCase()).toBe("wireless mouse");
    expect(compilation.title).toBe("Purchase pact · Wireless Mouse");
    expect(compilation.pact.maxTotalAmount).toBeUndefined();
    expect(compilation.pact.constraints.find((rule) => rule.field === "total")).toBeUndefined();
    expect(compilation.pact.constraints.find((rule) => rule.field === "attributes.itemPrice")).toMatchObject({ expected: 50, comparator: "lte", severity: "hard" });
    expect(compilation.pact.constraints.find((rule) => rule.field === "attributes.availability")).toMatchObject({ expected: "InStock", comparator: "eq", severity: "hard" });
    expect(compilation.pact.constraints.find((rule) => rule.field === "attributes.brand")).toMatchObject({ expected: "Logitech", severity: "soft" });
  });

  it("trust-boundary normalization ignores a model-invented landed cap for an item-price-only request", () => {
    const compilation = normalizeIntentCompilation({
      title: "Purchase pact · Wireless mouse",
      searchQuery: "wireless mouse",
      currency: "USD",
      maxTotalAmount: "50",
      constraints: [
        { id: "model-total", description: "Total under $50", field: "total", comparator: "lte", expected: "50", severity: "hard" },
        { id: "model-item-price", description: "Item price under $999", field: "attributes.itemPrice", comparator: "lte", expected: "999", severity: "hard" },
        { id: "stock", description: "In stock", field: "attributes.availability", comparator: "eq", expected: "InStock", severity: "hard" },
        { id: "brand", description: "Prefer Logitech", field: "attributes.brand", comparator: "eq", expected: "Logitech", severity: "soft" },
      ],
      assumptions: [],
      unverifiedRequirements: [],
    }, "GROQ", "test-model", wirelessMouseIntent);

    expect(compilation.pact.maxTotalAmount).toBeUndefined();
    expect(compilation.pact.constraints.find((rule) => rule.field === "total")).toBeUndefined();
    expect(compilation.pact.constraints.find((rule) => rule.field === "attributes.itemPrice")).toMatchObject({ expected: 50, comparator: "lte", severity: "hard" });
  });

  it("preserves both caps when the user explicitly requests item price and final landed total", () => {
    const intent = "Find a wireless mouse with catalog item price under $50 USD and final landed total under $65 USD, in stock.";
    const compilation = ruleBasedIntentCompilation(intent);
    expect(compilation.pact.maxTotalAmount).toBe(65);
    expect(compilation.pact.constraints.find((rule) => rule.field === "attributes.itemPrice")?.expected).toBe(50);
    expect(compilation.pact.constraints.find((rule) => rule.field === "total")?.expected).toBe(65);
  });
});


describe("unqualified product price limits default to catalog item price", () => {
  it("treats AirPods less than $100 as an item-price cap, not a landed-total cap", () => {
    const compilation = ruleBasedIntentCompilation("Find airpods less than $100");
    expect(compilation.searchQuery.toLowerCase()).toBe("airpods");
    expect(compilation.pact.maxTotalAmount).toBeUndefined();
    expect(compilation.pact.constraints.find((rule) => rule.field === "total")).toBeUndefined();
    expect(compilation.pact.constraints.find((rule) => rule.field === "attributes.itemPrice")).toMatchObject({ expected: 100, comparator: "lte", severity: "hard" });
  });

  it("overrides a model-invented total cap when the original intent only states an unqualified product price cap", () => {
    const compilation = normalizeIntentCompilation({
      title: "Purchase pact · AirPods",
      searchQuery: "AirPods",
      currency: "USD",
      maxTotalAmount: "100",
      constraints: [
        { id: "model-total", description: "Final total under 100", field: "total", comparator: "lte", expected: "100", severity: "hard" },
        { id: "currency", description: "Currency USD", field: "currency", comparator: "eq", expected: "USD", severity: "hard" },
      ],
      assumptions: [],
      unverifiedRequirements: [],
    }, "GROQ", "test-model", "Find airpods less than $100");

    expect(compilation.pact.maxTotalAmount).toBeUndefined();
    expect(compilation.pact.constraints.find((rule) => rule.field === "total")).toBeUndefined();
    expect(compilation.pact.constraints.find((rule) => rule.field === "attributes.itemPrice")).toMatchObject({ expected: 100, comparator: "lte", severity: "hard" });
  });

  it("keeps an explicitly stated final landed total separate from the catalog item price", () => {
    const compilation = ruleBasedIntentCompilation("Find AirPods with a final total under $100 USD, including shipping and tax.");
    expect(compilation.pact.maxTotalAmount).toBe(100);
    expect(compilation.pact.constraints.find((rule) => rule.field === "total")?.expected).toBe(100);
    expect(compilation.pact.constraints.find((rule) => rule.field === "attributes.itemPrice")).toBeUndefined();
  });

  it("preserves separate item-price and final-total caps when both are specified", () => {
    const compilation = ruleBasedIntentCompilation("Find AirPods under $100 with a final total under $110 including shipping.");
    expect(compilation.pact.constraints.find((rule) => rule.field === "attributes.itemPrice")?.expected).toBe(100);
    expect(compilation.pact.constraints.find((rule) => rule.field === "total")?.expected).toBe(110);
  });
});
