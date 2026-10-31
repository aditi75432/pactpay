import { describe, expect, it } from "vitest";
import { validateMerchantEvidenceClaim } from "../src/merchant-evidence";

describe("merchant evidence intake validation", () => {
  it("normalizes a decimal checkout total and removes URL query/fragment values", () => {
    const result = validateMerchantEvidenceClaim({
      field: "total",
      value: "899.99",
      sourceUrl: "https://www.newegg.com/item/abc?session=secret&utm_source=test#checkout",
      note: "Total shown at checkout",
    }, "newegg.com");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claim.value).toBe(899.99);
      expect(result.claim.sourceUrl).toBe("https://www.newegg.com/item/abc");
      expect(result.claim.sourceUrl).not.toContain("secret");
      expect(result.claim.ttlMs).toBe(5 * 60 * 1000);
    }
  });

  it("rejects a source URL on a different merchant domain", () => {
    const result = validateMerchantEvidenceClaim({
      field: "shippingFee", value: "0", sourceUrl: "https://attacker.example/shipping",
    }, "newegg.com");
    expect(result.ok).toBe(false);
  });

  it("rejects non-HTTPS URLs and embedded credentials", () => {
    expect(validateMerchantEvidenceClaim({ field: "total", value: "1", sourceUrl: "http://newegg.com" }, "newegg.com").ok).toBe(false);
    expect(validateMerchantEvidenceClaim({ field: "total", value: "1", sourceUrl: "https://user:pass@newegg.com" }, "newegg.com").ok).toBe(false);
  });

  it("validates date values strictly", () => {
    expect(validateMerchantEvidenceClaim({ field: "deliveryDate", value: "2026-02-30", sourceUrl: "https://newegg.com/shipping" }, "newegg.com").ok).toBe(false);
    const valid = validateMerchantEvidenceClaim({ field: "deliveryDate", value: "2026-10-24", sourceUrl: "https://newegg.com/shipping" }, "newegg.com");
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.claim.value).toBe("2026-10-24");
  });

  it("normalizes condition, availability and numeric attributes", () => {
    const condition = validateMerchantEvidenceClaim({ field: "attributes.condition", value: "Refurbished", sourceUrl: "https://newegg.com/item" }, "newegg.com");
    const stock = validateMerchantEvidenceClaim({ field: "attributes.availability", value: "in stock", sourceUrl: "https://newegg.com/item" }, "newegg.com");
    const ram = validateMerchantEvidenceClaim({ field: "attributes.ramGb", value: "16", sourceUrl: "https://newegg.com/specs" }, "newegg.com");
    expect(condition.ok && condition.claim.value).toBe("refurbished");
    expect(stock.ok && stock.claim.value).toBe("InStock");
    expect(ram.ok && ram.claim.value).toBe(16);
  });

  it("rejects impossible bounds and unknown fields", () => {
    expect(validateMerchantEvidenceClaim({ field: "returnWindowDays", value: "99999", sourceUrl: "https://newegg.com/policy" }, "newegg.com").ok).toBe(false);
    expect(validateMerchantEvidenceClaim({ field: "attributes.ramGb", value: "0", sourceUrl: "https://newegg.com/specs" }, "newegg.com").ok).toBe(false);
    expect(validateMerchantEvidenceClaim({ field: "madeUpField", value: "x", sourceUrl: "https://newegg.com" }, "newegg.com").ok).toBe(false);
  });
});
