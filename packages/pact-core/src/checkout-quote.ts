import { formatMoney } from "./explain";
import { previewChannel3TestQuote } from "./settlement-demo";

/**
 * A live catalog only knows the item price. A rule such as "final total at most $50" therefore
 * cannot be proven at shortlist time and would leave every offer stuck at "can't confirm".
 *
 * In test checkout the total is item price + fixed test shipping + fixed test tax, and the server
 * recomputes and re-checks that total at settlement. This helper lets the shortlist show an honest
 * ESTIMATE against such a rule so the shopper can choose an offer. It never creates a pass out of
 * nothing: it only resolves "unknown" total-cap results, only for USD offers, and the settlement
 * gate still decides independently at the end.
 */
export interface QuoteConstraintResult {
  constraintId: string;
  severity?: "hard" | "soft";
  status: "pass" | "fail" | "unknown";
  actual?: string | number | boolean;
  reason: string;
}

export interface QuoteEvaluationLike {
  verification: { securityClear: boolean; evidenceFresh: boolean; evidenceAttributable: boolean; results: QuoteConstraintResult[] };
  summary: { decision: "capture" | "block"; hardPasses: number; hardFailures: number };
  missingHardEvidence: Array<{ constraintId: string }>;
}

export interface QuoteRule {
  id: string;
  field: string;
  comparator: string;
  expected: unknown;
}

export function applyCheckoutQuote<T extends QuoteEvaluationLike>(
  evaluation: T,
  offer: { price: number; currency: string },
  rules: readonly QuoteRule[],
): T {
  if (offer.currency !== "USD" || !Number.isFinite(offer.price) || offer.price <= 0) return evaluation;
  const totalRules = rules.filter((rule) => rule.field === "total" && rule.comparator === "lte" && typeof rule.expected === "number");
  if (totalRules.length === 0) return evaluation;

  const quote = previewChannel3TestQuote(offer.price);
  let changed = false;
  const results: QuoteConstraintResult[] = evaluation.verification.results.map((item) => {
    const rule = totalRules.find((candidate) => candidate.id === item.constraintId);
    if (!rule || item.status !== "unknown") return item;
    changed = true;
    const limit = rule.expected as number;
    const within = quote.total <= limit + 1e-9;
    return {
      ...item,
      status: within ? "pass" : "fail",
      actual: quote.total,
      reason: within
        ? `Estimated total ${formatMoney(quote.total, "USD")} (item plus test shipping and tax) is within your ${formatMoney(limit, "USD")} limit. PactPay checks it again at checkout.`
        : `Estimated total ${formatMoney(quote.total, "USD")} (item plus test shipping and tax) is over your ${formatMoney(limit, "USD")} limit.`,
    };
  });
  if (!changed) return evaluation;

  const hard = results.filter((item) => (item.severity ?? "hard") === "hard");
  const hardFailures = hard.filter((item) => item.status === "fail").length;
  const hardUnknown = hard.filter((item) => item.status === "unknown").length;
  const hardPasses = hard.filter((item) => item.status === "pass").length;
  // The engine marks evidence as not fresh / not attributable whenever ANY must-have rule lacks evidence, and the
  // total rule had none. A rule only passes on fresh, attributable evidence, so if every OTHER must-have rule
  // passed, the total rule was the only thing holding those flags down. If any other rule is unknown, the flags
  // stay as the engine set them and the offer stays blocked.
  const resolvedIds = new Set(totalRules.map((rule) => rule.id));
  const othersAllPass = hard.filter((item) => !resolvedIds.has(item.constraintId)).every((item) => item.status === "pass");
  const evidenceFresh = evaluation.verification.evidenceFresh || othersAllPass;
  const evidenceAttributable = evaluation.verification.evidenceAttributable || othersAllPass;
  const clear = evaluation.verification.securityClear && evidenceFresh && evidenceAttributable;
  const decision: "capture" | "block" = hardFailures === 0 && hardUnknown === 0 && clear ? "capture" : "block";
  return {
    ...evaluation,
    verification: { ...evaluation.verification, evidenceFresh, evidenceAttributable, results },
    summary: { ...evaluation.summary, decision, hardPasses, hardFailures },
    missingHardEvidence: evaluation.missingHardEvidence.filter((item) => !totalRules.some((rule) => rule.id === item.constraintId)),
  };
}
