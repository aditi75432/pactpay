/** Server-side transaction lifecycle. UI input must never directly set one of these states. */
export type SettlementState =
  | "CREATING"
  | "ORDER_CREATED"
  | "AUTHORIZING"
  | "AUTHORIZED"
  | "AUTHORIZATION_REVIEW"
  | "VERIFYING"
  | "CAPTURE_ELIGIBLE"
  | "CAPTURING"
  | "CAPTURE_REVIEW"
  | "POLICY_BLOCKED"
  | "VOIDING"
  | "VOIDED"
  | "VOID_REVIEW"
  | "CAPTURED"
  | "CANCELLED"
  | "FAILED";

const transitions: Record<SettlementState, readonly SettlementState[]> = {
  CREATING: ["ORDER_CREATED", "CANCELLED", "FAILED"],
  ORDER_CREATED: ["AUTHORIZING", "CANCELLED", "FAILED"],
  AUTHORIZING: ["AUTHORIZED", "AUTHORIZATION_REVIEW", "ORDER_CREATED", "FAILED"],
  AUTHORIZED: ["VERIFYING", "AUTHORIZATION_REVIEW", "VOIDING"],
  AUTHORIZATION_REVIEW: ["VERIFYING", "VOIDING", "FAILED"],
  VERIFYING: ["CAPTURE_ELIGIBLE", "POLICY_BLOCKED", "VOIDING", "AUTHORIZATION_REVIEW"],
  CAPTURE_ELIGIBLE: ["CAPTURING", "VOIDING", "AUTHORIZATION_REVIEW"],
  CAPTURING: ["CAPTURED", "CAPTURE_REVIEW"],
  CAPTURE_REVIEW: ["CAPTURED", "VOID_REVIEW"],
  POLICY_BLOCKED: ["VOIDING", "VOID_REVIEW"],
  VOIDING: ["VOIDED", "VOID_REVIEW"],
  VOID_REVIEW: ["VOIDED", "AUTHORIZATION_REVIEW"],
  VOIDED: [],
  CAPTURED: [],
  CANCELLED: [],
  FAILED: [],
};

export function isSettlementTransitionAllowed(from: SettlementState, to: SettlementState): boolean {
  return transitions[from].includes(to);
}

export function assertSettlementTransition(from: SettlementState, to: SettlementState): void {
  if (!isSettlementTransitionAllowed(from, to)) {
    throw new Error(`Illegal PactPay settlement transition: ${from} -> ${to}`);
  }
}

export interface SettlementGateFacts {
  /** A user-approved, immutable pact is persisted server-side. */
  pactApproved: boolean;
  /** Transaction is bound server-side to the exact offer snapshot and policy run. */
  transactionBindingValid: boolean;
  currentSnapshotMatched: boolean;
  authorizationId: string | null;
  authorizationStatus: string | null;
  /** Must be revalidated against the current time and PayPal's latest authorization state. */
  authorizationNotExpired: boolean;
  authorizationAmount: string;
  authorizationCurrency: string;
  verifiedTotal: string;
  verifiedCurrency: string;
  hardConstraintsPass: boolean;
  evidenceFresh: boolean;
  evidenceAttributable: boolean;
  evidenceConflictFree: boolean;
  securityClear: boolean;
  /**
   * The Checkout Inspector's verdict on the merchant's checkout page for this order, when one was attached:
   * "safe" (SAFE_TO_PAY), "blocked" (DO_NOT_PAY), "unverified" (CANNOT_VERIFY, or the verdict couldn't be read).
   * "none" or omitted means no inspection was attached, which leaves the decision to the other checks.
   */
  checkoutInspection?: "none" | "safe" | "blocked" | "unverified";
}

export type SettlementGateDecision =
  | { decision: "CAPTURE_ELIGIBLE"; reasons: [] }
  | { decision: "BLOCK"; reasons: string[] };

function toCents(value: string): number | null {
  // Parse decimal text into integer minor units without floating-point currency math.
  // The final value must remain a safe integer so comparisons cannot silently round.
  if (!/^(?:0|[1-9]\d*)\.\d{2}$/.test(value)) return null;

  const [whole, fraction] = value.split(".");
  if (whole === undefined || fraction === undefined) return null;

  const wholeUnits = Number(whole);
  const fractionUnits = Number(fraction);
  if (!Number.isSafeInteger(wholeUnits) || !Number.isInteger(fractionUnits)) return null;

  const cents = wholeUnits * 100 + fractionUnits;
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Pure policy precondition check. It never calls PayPal and is safe to run in tests.
 * The gate requires an exact amount match for this MVP; partial capture is not used.
 */
export function evaluateSettlementGate(facts: SettlementGateFacts): SettlementGateDecision {
  const reasons: string[] = [];
  if (!facts.pactApproved) reasons.push("PACT_NOT_APPROVED");
  if (!facts.transactionBindingValid) reasons.push("TRANSACTION_BINDING_INVALID");
  if (!facts.currentSnapshotMatched) reasons.push("OFFER_SNAPSHOT_CHANGED_OR_UNCONFIRMED");
  if (!facts.authorizationId) reasons.push("AUTHORIZATION_ID_MISSING");
  if (facts.authorizationStatus !== "CREATED") reasons.push("AUTHORIZATION_STATUS_NOT_CREATED");
  if (!facts.authorizationNotExpired) reasons.push("AUTHORIZATION_EXPIRED_OR_NOT_REVALIDATED");
  const authorizedCents = toCents(facts.authorizationAmount);
  const verifiedCents = toCents(facts.verifiedTotal);
  if (authorizedCents === null || verifiedCents === null || authorizedCents !== verifiedCents) {
    reasons.push("AUTHORIZED_AMOUNT_DOES_NOT_MATCH_VERIFIED_TOTAL");
  }
  if (!/^[A-Z]{3}$/.test(facts.authorizationCurrency) || facts.authorizationCurrency !== facts.verifiedCurrency) {
    reasons.push("CURRENCY_MISMATCH");
  }
  if (!facts.hardConstraintsPass) reasons.push("HARD_CONSTRAINTS_NOT_SATISFIED");
  if (!facts.evidenceFresh) reasons.push("EVIDENCE_STALE_OR_UNKNOWN");
  if (!facts.evidenceAttributable) reasons.push("EVIDENCE_NOT_ATTRIBUTABLE");
  if (!facts.evidenceConflictFree) reasons.push("EVIDENCE_CONFLICT");
  if (!facts.securityClear) reasons.push("SECURITY_GATE_BLOCKED");
  if (facts.checkoutInspection === "blocked") reasons.push("CHECKOUT_INSPECTION_BLOCKED");
  if (facts.checkoutInspection === "unverified") reasons.push("CHECKOUT_INSPECTION_UNVERIFIED");
  return reasons.length === 0
    ? { decision: "CAPTURE_ELIGIBLE", reasons: [] }
    : { decision: "BLOCK", reasons };
}
