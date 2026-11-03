import { describe, expect, it } from "vitest";
import { evaluateSettlementGate, type SettlementGateFacts } from "../src/settlement-state";

const facts: SettlementGateFacts = {
  pactApproved: true, transactionBindingValid: true, currentSnapshotMatched: true, authorizationId: "AUTH-1", authorizationStatus: "CREATED",
  authorizationNotExpired: true, authorizationAmount: "18.34", authorizationCurrency: "USD", verifiedTotal: "18.34", verifiedCurrency: "USD",
  hardConstraintsPass: true, evidenceFresh: true, evidenceAttributable: true, evidenceConflictFree: true, securityClear: true,
};

describe("settlement gate and the Checkout Inspector", () => {
  it("leaves the decision alone when no inspection is attached, or when it is safe", () => {
    expect(evaluateSettlementGate(facts).decision).toBe("CAPTURE_ELIGIBLE");
    expect(evaluateSettlementGate({ ...facts, checkoutInspection: "none" }).decision).toBe("CAPTURE_ELIGIBLE");
    expect(evaluateSettlementGate({ ...facts, checkoutInspection: "safe" }).decision).toBe("CAPTURE_ELIGIBLE");
  });
  it("blocks capture when the real checkout page was judged do-not-pay", () => {
    expect(evaluateSettlementGate({ ...facts, checkoutInspection: "blocked" })).toEqual({ decision: "BLOCK", reasons: ["CHECKOUT_INSPECTION_BLOCKED"] });
  });
  it("blocks capture when the real checkout page couldn't be verified", () => {
    expect(evaluateSettlementGate({ ...facts, checkoutInspection: "unverified" })).toEqual({ decision: "BLOCK", reasons: ["CHECKOUT_INSPECTION_UNVERIFIED"] });
  });
  it("can only add reasons to block, never remove one", () => {
    const result = evaluateSettlementGate({ ...facts, securityClear: false, checkoutInspection: "safe" });
    expect(result.decision).toBe("BLOCK");
  });
});
