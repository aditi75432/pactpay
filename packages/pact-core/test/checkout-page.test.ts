import { describe, expect, it } from "vitest";
import { buildCheckoutPage, checkoutPageTruth, renderCheckoutPageSvg, HOSTILE_HIDDEN_FEE } from "../src/checkout-page";
import { inspectCheckout, type InspectionRule } from "../src/checkout-inspection";

const terms = { merchant: "shop.example.com", title: "Logitech M510 Wireless Mouse with USB receiver and long title that keeps going", currency: "USD", itemPrice: 24.99, shipping: 4.99, tax: 2.4 };
const rules: InspectionRule[] = [
  { id: "cap", label: "Total at most $50", hard: true, field: "total", comparator: "lte", expected: 50 },
  { id: "cur", label: "USD", hard: true, field: "currency", comparator: "eq", expected: "USD" },
];

describe("checkout page for a held order", () => {
  it("a faithful page adds up and is judged safe by a perfect reader", () => {
    const page = buildCheckoutPage(terms, "faithful");
    expect(page.total).toBeCloseTo(32.38, 2);
    const reading = checkoutPageTruth(page);
    const result = inspectCheckout(reading, rules, { second: reading });
    expect(result.outcome).toBe("SAFE_TO_PAY");
  });
  it("a hostile page hides a fee in the total and is judged DO_NOT_PAY", () => {
    const page = buildCheckoutPage(terms, "hostile");
    expect(page.total).toBeCloseTo(32.38 + HOSTILE_HIDDEN_FEE, 2);
    const reading = checkoutPageTruth(page);
    const result = inspectCheckout(reading, rules, { second: reading });
    expect(result.outcome).toBe("DO_NOT_PAY");
    expect(result.arithmetic.ok).toBe(false);
    expect(result.injection.length).toBeGreaterThan(0);
  });
  it("renders plain, escaped SVG", () => {
    const svg = renderCheckoutPageSvg(buildCheckoutPage({ ...terms, merchant: "a<b>&c" }, "hostile"));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("<b>");
    expect(svg).not.toContain("foreignObject");
    expect(svg).toContain("Order total");
  });
});
