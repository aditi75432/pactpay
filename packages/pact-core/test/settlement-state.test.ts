import { describe, expect, it } from "vitest";
import {
  assertSettlementTransition,
  evaluateSettlementGate,
  isSettlementTransitionAllowed,
  type SettlementGateFacts,
} from "../src/settlement-state.js";

const validFacts: SettlementGateFacts = {
  pactApproved: true,
  transactionBindingValid: true,
  currentSnapshotMatched: true,
  authorizationId: "AUTH-123",
  authorizationStatus: "CREATED",
  authorizationNotExpired: true,
  authorizationAmount: "849.00",
  authorizationCurrency: "USD",
  verifiedTotal: "849.00",
  verifiedCurrency: "USD",
  hardConstraintsPass: true,
  evidenceFresh: true,
  evidenceAttributable: true,
  evidenceConflictFree: true,
  securityClear: true,
};

describe("settlement state machine", () => {
  it("allows only documented state transitions", () => {
    expect(isSettlementTransitionAllowed("AUTHORIZED", "VERIFYING")).toBe(true);
    expect(isSettlementTransitionAllowed("CAPTURE_ELIGIBLE", "CAPTURING")).toBe(true);
    expect(isSettlementTransitionAllowed("ORDER_CREATED", "CAPTURED")).toBe(false);
    expect(isSettlementTransitionAllowed("AUTHORIZED", "CAPTURED")).toBe(false);
    expect(isSettlementTransitionAllowed("POLICY_BLOCKED", "VOIDED")).toBe(false);
    expect(isSettlementTransitionAllowed("VOIDED", "CAPTURING")).toBe(false);
    expect(() => assertSettlementTransition("ORDER_CREATED", "CAPTURED")).toThrow(/Illegal PactPay/);
  });

  it("allows capture eligibility only when every gate fact passes", () => {
    expect(evaluateSettlementGate(validFacts)).toEqual({ decision: "CAPTURE_ELIGIBLE", reasons: [] });
  });

  it("blocks independently for each failed mandatory fact", () => {
    const cases: Array<{ field: keyof SettlementGateFacts; value: boolean | string | null; reason: string }> = [
      { field: "pactApproved", value: false, reason: "PACT_NOT_APPROVED" },
      { field: "transactionBindingValid", value: false, reason: "TRANSACTION_BINDING_INVALID" },
      { field: "currentSnapshotMatched", value: false, reason: "OFFER_SNAPSHOT_CHANGED_OR_UNCONFIRMED" },
      { field: "authorizationId", value: null, reason: "AUTHORIZATION_ID_MISSING" },
      { field: "authorizationStatus", value: "VOIDED", reason: "AUTHORIZATION_STATUS_NOT_CREATED" },
      { field: "authorizationNotExpired", value: false, reason: "AUTHORIZATION_EXPIRED_OR_NOT_REVALIDATED" },
      { field: "hardConstraintsPass", value: false, reason: "HARD_CONSTRAINTS_NOT_SATISFIED" },
      { field: "evidenceFresh", value: false, reason: "EVIDENCE_STALE_OR_UNKNOWN" },
      { field: "evidenceAttributable", value: false, reason: "EVIDENCE_NOT_ATTRIBUTABLE" },
      { field: "evidenceConflictFree", value: false, reason: "EVIDENCE_CONFLICT" },
      { field: "securityClear", value: false, reason: "SECURITY_GATE_BLOCKED" },
    ];
    for (const testCase of cases) {
      const facts = { ...validFacts, [testCase.field]: testCase.value } as SettlementGateFacts;
      const result = evaluateSettlementGate(facts);
      expect(result.decision, testCase.field).toBe("BLOCK");
      expect(result.reasons, testCase.field).toContain(testCase.reason);
    }
  });

  it("blocks amount or currency mismatches", () => {
    expect(evaluateSettlementGate({ ...validFacts, verifiedTotal: "848.99" }).reasons)
      .toContain("AUTHORIZED_AMOUNT_DOES_NOT_MATCH_VERIFIED_TOTAL");
    expect(evaluateSettlementGate({ ...validFacts, verifiedCurrency: "EUR" }).reasons)
      .toContain("CURRENCY_MISMATCH");
    expect(evaluateSettlementGate({ ...validFacts, verifiedTotal: "849" }).reasons)
      .toContain("AUTHORIZED_AMOUNT_DOES_NOT_MATCH_VERIFIED_TOTAL");
  });

  it("uses safe integer cents without requiring BigInt literal syntax", () => {
    expect(evaluateSettlementGate({ ...validFacts, authorizationAmount: "849.00", verifiedTotal: "849.00" }).decision)
      .toBe("CAPTURE_ELIGIBLE");
    expect(evaluateSettlementGate({ ...validFacts, verifiedTotal: "849.01" }).reasons)
      .toContain("AUTHORIZED_AMOUNT_DOES_NOT_MATCH_VERIFIED_TOTAL");
    // Cents exceed Number.MAX_SAFE_INTEGER; fail closed rather than risk rounded comparisons.
    expect(evaluateSettlementGate({
      ...validFacts,
      authorizationAmount: "90071992547409.92",
      verifiedTotal: "90071992547409.92",
    }).reasons).toContain("AUTHORIZED_AMOUNT_DOES_NOT_MATCH_VERIFIED_TOTAL");
  });
});
