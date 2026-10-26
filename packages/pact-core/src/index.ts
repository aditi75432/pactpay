export type Currency = "USD" | "INR";
export type ConstraintKind = "budget" | "attribute" | "delivery_deadline" | "return_window" | "shipping_fee";
export type ConstraintSeverity = "hard" | "soft";
export type VerificationStatus = "pass" | "fail" | "unknown";

export interface PurchasePact {
  id: string;
  version: number;
  currency: Currency;
  maxTotalAmount?: number;
  constraints: Constraint[];
  authority: AuthorityEnvelope;
}

export interface Constraint {
  id: string;
  kind: ConstraintKind;
  severity: ConstraintSeverity;
  description: string;
  expected: string | number | boolean;
  comparator: "lte" | "gte" | "eq" | "before" | "contains";
  field: string;
}

export interface AuthorityEnvelope {
  canSearch: boolean;
  canCompare: boolean;
  canCreateOrder: boolean;
  canAuthorize: boolean;
  canCapture: false;
  canSubstitute: boolean;
  canChangeHardConstraints: false;
}

export interface Evidence {
  id: string;
  source: string;
  sourceType: "channel3" | "merchant" | "paypal" | "simulator" | "user";
  collectedAt: string;
  validUntil: string;
  claim: string;
  value: string | number | boolean;
  provenanceRef?: string;
  /** Field in the offer snapshot that this evidence supports, e.g. "total" or "attributes.ramGb". */
  field?: string;
  /** Stable offer/product reference this evidence belongs to. Must match the evaluated offer ID. */
  subjectRef?: string;
}

export interface ConstraintResult {
  constraintId: string;
  /** Missing severity is treated as hard for backwards-compatible fail-closed behavior. */
  severity?: ConstraintSeverity;
  status: VerificationStatus;
  actual?: string | number | boolean;
  evidenceIds: string[];
  reason: string;
}

export interface VerificationResult {
  pactId: string;
  verifiedAt: string;
  evidenceFresh: boolean;
  evidenceAttributable: boolean;
  results: ConstraintResult[];
  securityClear: boolean;
}

export type SettlementDecision =
  | { decision: "capture"; reason: "all_preconditions_satisfied" }
  | { decision: "block"; reason: string };

export function decideSettlement(input: VerificationResult): SettlementDecision {
  // This function returns a policy decision only. It never calls a payment API.
  if (!input.securityClear) {
    return { decision: "block", reason: "security_policy_block" };
  }

  if (!input.evidenceFresh) {
    return { decision: "block", reason: "evidence_not_fresh" };
  }

  if (!input.evidenceAttributable) {
    return { decision: "block", reason: "evidence_not_attributable" };
  }

  if (input.results.length === 0) {
    return { decision: "block", reason: "no_constraints_evaluated" };
  }

  // Fail closed: legacy results with no severity are treated as hard constraints.
  const hardResults = input.results.filter((r) => (r.severity ?? "hard") === "hard");
  if (hardResults.length === 0) {
    return { decision: "block", reason: "no_hard_constraints" };
  }

  const hardFailures = hardResults.filter((r) => r.status !== "pass");
  if (hardFailures.length > 0) {
    return {
      decision: "block",
      reason: `hard_constraints_not_satisfied:${hardFailures.map((r) => r.constraintId).join(",")}`,
    };
  }

  return { decision: "capture", reason: "all_preconditions_satisfied" };
}
