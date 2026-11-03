import { describe, expect, it } from "vitest";
import { inspectCheckout } from "../src/checkout-inspection";
import { INSPECTION_DEMO_RULES, INSPECTION_SAMPLES } from "../src/inspection-samples";

describe("built-in checkout samples", () => {
  for (const sample of INSPECTION_SAMPLES) {
    it(`${sample.id}: a perfect reading produces ${sample.expected}`, () => {
      const result = inspectCheckout(sample.truth, INSPECTION_DEMO_RULES, { second: sample.truth });
      expect(result.outcome).toBe(sample.expected);
    });
  }
  it("covers all three outcomes, so the demo shows the full range", () => {
    expect(new Set(INSPECTION_SAMPLES.map((sample) => sample.expected))).toEqual(new Set(["SAFE_TO_PAY", "DO_NOT_PAY", "CANNOT_VERIFY"]));
  });
  it("the over-budget sample is honest arithmetic, so only the approved budget rule stops it", () => {
    const sample = INSPECTION_SAMPLES.find((item) => item.id === "over-budget")!;
    const result = inspectCheckout(sample.truth, INSPECTION_DEMO_RULES);
    expect(result.arithmetic.ok).toBe(true);
    expect(result.injection).toHaveLength(0);
    expect(result.rows.find((row) => row.ruleId === "system.budget_cap")?.status).toBe("fail");
  });
});
