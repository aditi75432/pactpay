import type { ConstraintResult, PurchasePact } from "./index";

/**
 * Plain-English settlement explanations.
 *
 * This module only DESCRIBES a decision that the deterministic policy engine and the
 * settlement gate already made. It never makes, changes or overrides that decision,
 * and nothing in it can move money.
 */

export interface OfferFacts {
  itemPrice: number | null;
  total: number | null;
  availability: string | null;
  currency: string;
}

export type ExplainOutcome = "CAPTURED" | "VOIDED" | "OPEN";

export interface ExplainInput {
  outcome: ExplainOutcome;
  currency: string;
  authorizedAmount: number;
  merchant: string;
  productTitle: string;
  baseline: OfferFacts;
  current: OfferFacts;
  pact: Pick<PurchasePact, "constraints">;
  results: ConstraintResult[];
  securityFinding: string | null;
  gateReasons: string[];
}

export interface ExplainedChange {
  label: string;
  before: string;
  after: string;
}

export interface Explanation {
  tone: "good" | "bad" | "waiting";
  headline: string;
  summary: string;
  /** One line per reason, written for a non-technical shopper. */
  reasons: string[];
  changes: ExplainedChange[];
  /** What a gate-less agent would have done. Null when it adds nothing honest to say. */
  counterfactual: string | null;
}

export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function describeAvailability(value: string | null): string {
  if (!value) return "unknown";
  const compact = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim().toLowerCase();
  return compact || "unknown";
}

const GATE_REASON_COPY: Record<string, string> = {
  PACT_NOT_APPROVED: "The approved Pact could not be matched to this order.",
  TRANSACTION_BINDING_INVALID: "The order no longer matches the offer you approved.",
  OFFER_SNAPSHOT_CHANGED_OR_UNCONFIRMED: "The seller's offer changed after you approved it.",
  AUTHORIZATION_ID_MISSING: "PayPal did not confirm the payment hold.",
  AUTHORIZATION_STATUS_NOT_CREATED: "The PayPal hold is no longer active.",
  AUTHORIZATION_EXPIRED_OR_NOT_REVALIDATED: "The PayPal hold expired or could not be re-checked.",
  AUTHORIZED_AMOUNT_DOES_NOT_MATCH_VERIFIED_TOTAL: "The seller's new total no longer matches the amount you authorized.",
  CURRENCY_MISMATCH: "The currency changed from the one you approved.",
  HARD_CONSTRAINTS_NOT_SATISFIED: "At least one of your must-have rules is no longer met.",
  EVIDENCE_STALE_OR_UNKNOWN: "The proof about this offer is too old to rely on.",
  EVIDENCE_NOT_ATTRIBUTABLE: "The proof could not be tied to this exact offer.",
  EVIDENCE_CONFLICT: "Two sources disagree about this offer.",
  SECURITY_GATE_BLOCKED: "The seller's content tried to give the agent instructions, so it was treated as untrusted.",
};

function gateReasonCopy(code: string): string {
  const known = GATE_REASON_COPY[code];
  if (known) return known;
  const words = code.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return words ? `Safety check: ${words}.` : "A safety check did not pass.";
}

function actualText(result: ConstraintResult, currency: string): string | null {
  if (result.actual === undefined) return null;
  if (typeof result.actual === "number") return formatMoney(result.actual, currency);
  return String(result.actual);
}

function ruleReason(result: ConstraintResult, pact: Pick<PurchasePact, "constraints">, currency: string): string | null {
  const rule = pact.constraints.find((constraint) => constraint.id === result.constraintId);
  if ((result.severity ?? "hard") !== "hard") return null;
  if (result.status === "pass") return null;
  const system = result.constraintId.startsWith("system.");
  if (system) return null; // System bindings are covered by gate reasons.
  const label = rule?.description ?? "One of your must-have rules";
  if (result.status === "fail") {
    const actual = actualText(result, currency);
    return actual ? `Your rule “${label}” is not met. It is now ${actual}.` : `Your rule “${label}” is not met.`;
  }
  return `Your rule “${label}” could not be verified, so PactPay treated it as not met.`;
}

function buildChanges(input: ExplainInput): ExplainedChange[] {
  const changes: ExplainedChange[] = [];
  const { baseline, current, currency } = input;
  if (baseline.itemPrice !== null && current.itemPrice !== null && Math.abs(baseline.itemPrice - current.itemPrice) >= 0.005) {
    changes.push({ label: "Item price", before: formatMoney(baseline.itemPrice, baseline.currency), after: formatMoney(current.itemPrice, current.currency) });
  }
  if (baseline.total !== null && current.total !== null && Math.abs(baseline.total - current.total) >= 0.005) {
    changes.push({ label: "Total", before: formatMoney(baseline.total, baseline.currency), after: formatMoney(current.total, current.currency) });
  }
  if (describeAvailability(baseline.availability) !== describeAvailability(current.availability)) {
    changes.push({ label: "Availability", before: describeAvailability(baseline.availability), after: describeAvailability(current.availability) });
  }
  if (baseline.currency !== current.currency) {
    changes.push({ label: "Currency", before: baseline.currency, after: current.currency });
  }
  // currency param keeps the signature symmetrical for future fields.
  void currency;
  return changes;
}

function buildCounterfactual(input: ExplainInput): string | null {
  if (input.outcome !== "VOIDED") return null;
  const { authorizedAmount, current, currency } = input;
  const parts: string[] = [];
  if (current.total !== null && current.total - authorizedAmount >= 0.005) {
    parts.push(`the seller now wants ${formatMoney(current.total, current.currency)} for what you approved at ${formatMoney(authorizedAmount, currency)}`);
  }
  if (describeAvailability(current.availability).includes("out of stock") || describeAvailability(current.availability).includes("sold out")) {
    parts.push("the item is no longer in stock");
  }
  if (input.securityFinding) parts.push("the seller's page tried to instruct the agent to ignore your limits");
  if (parts.length === 0) return null;
  return `Without a gate, an agent would have finished this purchase anyway, even though ${parts.join(" and ")}.`;
}

export function explainSettlement(input: ExplainInput): Explanation {
  const money = (value: number) => formatMoney(value, input.currency);
  const changes = buildChanges(input);
  const reasons: string[] = [];

  if (input.securityFinding) {
    reasons.push("The seller's page contained text aimed at the AI agent. PactPay ignored it and held the payment.");
  }
  for (const result of input.results) {
    const text = ruleReason(result, input.pact, input.currency);
    if (text) reasons.push(text);
  }
  for (const code of input.gateReasons) {
    const text = gateReasonCopy(code);
    if (!reasons.includes(text)) reasons.push(text);
  }

  if (input.outcome === "CAPTURED") {
    return {
      tone: "good",
      headline: "Checks passed. Sandbox payment captured.",
      summary: `The offer from ${input.merchant} still matched everything you approved, so PactPay captured ${money(input.authorizedAmount)} from the PayPal Sandbox authorization. This is test money. No order was placed with ${input.merchant}.`,
      reasons: [],
      changes,
      counterfactual: null,
    };
  }

  if (input.outcome === "VOIDED") {
    const lead = changes[0];
    const summary = lead
      ? `${input.merchant} changed this offer after you approved it (${lead.label.toLowerCase()}: ${lead.before} to ${lead.after}). PactPay voided the PayPal authorization, so nothing was captured and you were not charged.`
      : `The offer from ${input.merchant} no longer met your rules. PactPay voided the PayPal authorization, so nothing was captured and you were not charged.`;
    return {
      tone: "bad",
      headline: "Blocked. You were not charged.",
      summary,
      reasons,
      changes,
      counterfactual: buildCounterfactual(input),
    };
  }

  return {
    tone: "waiting",
    headline: "Payment on hold. Nothing has been charged.",
    summary: `${money(input.authorizedAmount)} is held on PayPal for ${input.productTitle}. PactPay will check the seller's current offer against your rules before anything is released.`,
    reasons: [],
    changes,
    counterfactual: null,
  };
}
