import {
  decideSettlement,
  type Constraint,
  type ConstraintResult,
  type Evidence,
  type PurchasePact,
  type VerificationResult,
  type VerificationStatus,
} from "./index";

export interface OfferSnapshot {
  /** Stable identifier for this exact offer snapshot, not merely the product family. */
  id: string;
  /** Observed offer currency; can be outside the currencies PactPay currently authorizes. */
  currency: string;
  /** Final landed amount; null/undefined means not yet evidenced. Never substitute item price here. */
  total?: number | null;
  shippingFee?: number | null;
  deliveryDate?: string | null;
  returnWindowDays?: number | null;
  attributes: Record<string, string | number | boolean | null | undefined>;
  evidence: Evidence[];
}

export interface EvaluatePactOptions {
  /** Explicitly set by the caller after security checks; never infer from an LLM answer. */
  securityClear: boolean;
  /** Injectable clock for deterministic tests. Defaults to the current time. */
  now?: Date | string;
}

interface PolicyConstraint extends Constraint {
  severity: "hard" | "soft";
}

interface ConstraintEvaluation {
  result: ConstraintResult;
  fresh: boolean;
  attributable: boolean;
}

function parseTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeValue(value: string | number | boolean): string | number | boolean {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = parseTime(trimmed);
    if (parsed !== null && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(trimmed)) return parsed;
    return trimmed.toLocaleLowerCase("en-US");
  }
  return value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") {
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-8;
  }
  if (
    (typeof left === "string" || typeof left === "number" || typeof left === "boolean") &&
    (typeof right === "string" || typeof right === "number" || typeof right === "boolean")
  ) {
    const a = normalizeValue(left);
    const b = normalizeValue(right);
    if (typeof a === "number" && typeof b === "number") return a === b;
    return typeof a === typeof b && a === b;
  }
  return false;
}

/**
 * Availability arrives from catalogs in several equivalent spellings, e.g.
 * `InStock`, `in stock`, and `in_stock`. Normalize separators only for this
 * enum field; do not broaden the meaning of other product attributes.
 */
function normalizeAvailabilityToken(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/[\s_-]+/g, "");
}

function valuesEqualForField(left: unknown, right: unknown, field: string): boolean {
  if (field === "attributes.availability" && typeof left === "string" && typeof right === "string") {
    return normalizeAvailabilityToken(left) === normalizeAvailabilityToken(right);
  }
  return valuesEqual(left, right);
}

function readField(offer: OfferSnapshot, field: string): string | number | boolean | undefined {
  const cleanField = field.trim();
  if (!cleanField) return undefined;
  const parts = cleanField.split(".");
  let current: unknown = offer;

  // Accept "ramGb" as a shorthand for offer.attributes.ramGb, while also
  // supporting explicit paths such as "attributes.ramGb".
  if (parts.length === 1 && !(cleanField in offer) && cleanField in offer.attributes) {
    current = offer.attributes[cleanField];
  } else {
    for (const part of parts) {
      if (current === null || typeof current !== "object" || !(part in current)) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
  }

  return typeof current === "string" || typeof current === "number" || typeof current === "boolean"
    ? current
    : undefined;
}

function compare(actual: string | number | boolean, expected: string | number | boolean, comparator: Constraint["comparator"], field: string): boolean | null {
  if (comparator === "eq") return valuesEqualForField(actual, expected, field);
  if (comparator === "contains") {
    if (typeof actual !== "string" || typeof expected !== "string") return null;
    return actual.toLocaleLowerCase("en-US").includes(expected.toLocaleLowerCase("en-US"));
  }
  if (comparator === "before") {
    if (typeof actual !== "string" || typeof expected !== "string") return null;
    const a = parseTime(actual);
    const b = parseTime(expected);
    if (a === null || b === null) return null;
    return a < b;
  }

  if (typeof actual === "number" && typeof expected === "number") {
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return null;
    return comparator === "lte" ? actual <= expected : actual >= expected;
  }

  // lte/gte also support ISO date strings, so “delivered by Friday” can be
  // represented as a deterministic date comparison without involving an LLM.
  if (typeof actual === "string" && typeof expected === "string") {
    const a = parseTime(actual);
    const b = parseTime(expected);
    if (a === null || b === null) return null;
    return comparator === "lte" ? a <= b : a >= b;
  }
  return null;
}

function resolveField(constraint: PolicyConstraint): string {
  if (constraint.field.trim()) return constraint.field.trim();
  switch (constraint.kind) {
    case "budget": return "total";
    case "delivery_deadline": return "deliveryDate";
    case "return_window": return "returnWindowDays";
    case "shipping_fee": return "shippingFee";
    case "attribute": return "";
  }
}

function evaluateConstraint(
  constraint: PolicyConstraint,
  offer: OfferSnapshot,
  nowMs: number,
): ConstraintEvaluation {
  const field = resolveField(constraint);
  const actual = field ? readField(offer, field) : undefined;
  const fieldEvidence = offer.evidence.filter((item) => item.field === field);
  const matchingSubjectEvidence = fieldEvidence.filter((item) => item.subjectRef === offer.id);
  const evidenceIds = matchingSubjectEvidence.map((item) => item.id);
  const attributable = matchingSubjectEvidence.length > 0 && matchingSubjectEvidence.every(
    (item) => typeof item.provenanceRef === "string" && item.provenanceRef.trim().length > 0,
  );

  const freshEvidence = matchingSubjectEvidence.filter((item) => {
    const collectedAt = parseTime(item.collectedAt);
    const validUntil = parseTime(item.validUntil);
    return collectedAt !== null && validUntil !== null && collectedAt <= nowMs && validUntil > nowMs;
  });
  const fresh = freshEvidence.length > 0;

  const base = {
    constraintId: constraint.id,
    severity: constraint.severity,
    ...(actual !== undefined ? { actual } : {}),
    evidenceIds,
  };

  if (actual === undefined) {
    return {
      result: { ...base, status: "unknown", reason: `Offer field '${field || "(missing field)"}' is unavailable.` },
      fresh,
      attributable,
    };
  }

  if (matchingSubjectEvidence.length === 0) {
    return {
      result: { ...base, status: "unknown", reason: `No evidence is bound to offer '${offer.id}' for field '${field}'.` },
      fresh: false,
      attributable: false,
    };
  }

  if (!attributable) {
    return {
      result: { ...base, status: "unknown", reason: `Evidence for '${field}' lacks an attributable source reference.` },
      fresh,
      attributable: false,
    };
  }

  if (!fresh) {
    return {
      result: { ...base, status: "unknown", reason: `Evidence for '${field}' is missing valid timestamps or has expired.` },
      fresh: false,
      attributable: true,
    };
  }

  // Conflicting fresh evidence is treated as unknown and must not be settled.
  const conflictingEvidence = freshEvidence.some((item) => !valuesEqualForField(item.value, actual, field));
  if (conflictingEvidence) {
    return {
      result: { ...base, status: "unknown", reason: `Fresh evidence conflicts with the current offer value for '${field}'.` },
      fresh: true,
      attributable: true,
    };
  }

  const comparison = compare(actual, constraint.expected, constraint.comparator, field);
  if (comparison === null) {
    return {
      result: { ...base, status: "unknown", reason: `Cannot safely apply '${constraint.comparator}' to field '${field}'.` },
      fresh: true,
      attributable: true,
    };
  }

  return {
    result: {
      ...base,
      status: comparison ? "pass" : "fail",
      reason: comparison
        ? constraint.description || `Constraint '${constraint.id}' satisfied.`
        : `Constraint '${constraint.id}' failed: actual value does not satisfy ${constraint.comparator} ${String(constraint.expected)}.`,
    },
    fresh: true,
    attributable: true,
  };
}

/**
 * Deterministically evaluate a structured pact against one specific offer snapshot.
 * This function does not call PayPal and cannot move money.
 */
export function evaluatePact(
  pact: PurchasePact,
  offer: OfferSnapshot,
  options: EvaluatePactOptions,
): VerificationResult {
  const nowMs = options.now instanceof Date
    ? options.now.getTime()
    : options.now !== undefined
      ? Date.parse(options.now)
      : Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("EvaluatePactOptions.now must be a valid date.");

  const constraints: PolicyConstraint[] = pact.constraints.map((constraint) => ({
    ...constraint,
    severity: constraint.severity,
  }));

  // Enforce maxTotalAmount independently even when a budget constraint exists;
  // two different limits must resolve to the stricter intersection, never the looser one.
  if (pact.maxTotalAmount !== undefined) {
    constraints.push({
      id: "system.budget_cap",
      kind: "budget",
      severity: "hard",
      description: "Total transaction amount must stay within the user's maximum budget.",
      expected: pact.maxTotalAmount,
      comparator: "lte",
      field: "total",
    });
  }

  constraints.push({
    id: "system.currency_match",
    kind: "attribute",
    severity: "hard",
    description: "Offer currency must match the currency authorized by the user.",
    expected: pact.currency,
    comparator: "eq",
    field: "currency",
  });

  const explicitHardConstraints = pact.constraints.some((constraint) => constraint.severity === "hard") ||
    (pact.maxTotalAmount !== undefined && Number.isFinite(pact.maxTotalAmount) && pact.maxTotalAmount >= 0);
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const constraint of pact.constraints) {
    if (seenIds.has(constraint.id)) duplicateIds.add(constraint.id);
    seenIds.add(constraint.id);
  }

  const evaluations = constraints.map((constraint) => evaluateConstraint(constraint, offer, nowMs));
  if (!explicitHardConstraints) {
    const failure: ConstraintResult = {
      constraintId: "system.no_hard_constraints",
      severity: "hard",
      status: "unknown",
      evidenceIds: [],
      reason: "The purchase pact must define at least one hard constraint or a valid maximum budget.",
    };
    evaluations.push({ result: failure, fresh: true, attributable: true });
  }
  if (duplicateIds.size > 0) {
    evaluations.push({
      result: {
        constraintId: "system.duplicate_constraint_ids",
        severity: "hard",
        status: "unknown",
        evidenceIds: [],
        reason: `Duplicate constraint IDs: ${Array.from(duplicateIds).join(", ")}.`,
      },
      fresh: true,
      attributable: true,
    });
  }
  if (pact.maxTotalAmount !== undefined && (!Number.isFinite(pact.maxTotalAmount) || pact.maxTotalAmount < 0)) {
    evaluations.push({
      result: {
        constraintId: "system.invalid_budget_cap",
        severity: "hard",
        status: "unknown",
        evidenceIds: [],
        reason: "The pact maximum budget must be a finite, non-negative amount.",
      },
      fresh: true,
      attributable: true,
    });
  }

  const hardEvaluations = evaluations.filter((evaluation) => (evaluation.result.severity ?? "hard") === "hard");
  const evidenceFresh = hardEvaluations.length > 0 && hardEvaluations.every((evaluation) => evaluation.fresh);
  const evidenceAttributable = hardEvaluations.length > 0 && hardEvaluations.every((evaluation) => evaluation.attributable);

  return {
    pactId: pact.id,
    verifiedAt: new Date(nowMs).toISOString(),
    evidenceFresh,
    evidenceAttributable,
    results: evaluations.map((evaluation) => evaluation.result),
    securityClear: options.securityClear,
  };
}

/** Explicitly named helper prevents callers confusing a policy decision with a PayPal API call. */
export function evaluateSettlementPolicy(result: VerificationResult) {
  return decideSettlement(result);
}

export function summarizeVerification(result: VerificationResult): {
  decision: "capture" | "block";
  reason: string;
  hardPasses: number;
  hardFailures: number;
  softFailures: number;
} {
  const decision = decideSettlement(result);
  const hard = result.results.filter((item) => (item.severity ?? "hard") === "hard");
  const soft = result.results.filter((item) => item.severity === "soft");
  return {
    ...decision,
    hardPasses: hard.filter((item) => item.status === "pass").length,
    hardFailures: hard.filter((item) => item.status !== "pass").length,
    softFailures: soft.filter((item) => item.status !== "pass").length,
  };
}

export function isVerificationStatus(value: unknown): value is VerificationStatus {
  return value === "pass" || value === "fail" || value === "unknown";
}
