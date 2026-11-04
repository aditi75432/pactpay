import { applyCheckoutQuote, quoteRulesFor, type QuoteEvaluationLike } from "@pactpay/pact-core/checkout-quote";
import { shouldAutoHold } from "@pactpay/pact-core/autonomy";
import { blockedBySellerWorld, offerKey } from "@pactpay/pact-core/seller-world";
import { previewChannel3TestQuote } from "@pactpay/pact-core/settlement-demo";
import { internalCall, isRecord, type AgentContext } from "./agent-gateway";
import { listSellerWorld } from "../../../lib/seller-world";

type LiveOffer = {
  snapshotId: string; productId: string; productTitle: string; description: string | null; brand: string | null;
  imageUrl: string | null; offerDomain: string; offerUrl: string; price: number; currency: string;
  availability: string | null; condition: string | null; ramGb: number | null; structuredAttributes: Record<string, unknown>;
  fetchedAt: string | null; validUntil: string | null;
};
type Verdict = "PASS" | "NEEDS_EVIDENCE" | "BLOCKED" | "SAFETY_HOLD" | "SKIPPED";
type Evaluated = {
  offer: LiveOffer; verdict: Verdict; reason: string; relevance: number; evaluation: QuoteEvaluationLike | null;
  refreshed: boolean; refreshStatus: string; estimatedTotalUsd: number | null;
};

function asOffer(value: unknown): LiveOffer | null {
  if (!isRecord(value)) return null;
  const { snapshotId, productId, productTitle, offerDomain, offerUrl, price, currency } = value;
  if (typeof snapshotId !== "string" || typeof productId !== "string" || typeof productTitle !== "string" ||
      typeof offerDomain !== "string" || typeof offerUrl !== "string" || typeof price !== "number" || typeof currency !== "string") return null;
  return {
    snapshotId, productId, productTitle, offerDomain, offerUrl, price, currency,
    description: typeof value.description === "string" ? value.description : null,
    brand: typeof value.brand === "string" ? value.brand : null,
    imageUrl: typeof value.imageUrl === "string" ? value.imageUrl : null,
    availability: typeof value.availability === "string" ? value.availability : null,
    condition: typeof value.condition === "string" ? value.condition : null,
    ramGb: typeof value.ramGb === "number" ? value.ramGb : null,
    structuredAttributes: isRecord(value.structuredAttributes) ? value.structuredAttributes : {},
    fetchedAt: typeof value.fetchedAt === "string" ? value.fetchedAt : null,
    validUntil: typeof value.validUntil === "string" ? value.validUntil : null,
  };
}

const STOP_WORDS = new Set(["find", "me", "a", "an", "the", "with", "under", "over", "less", "than", "at", "most", "least", "price", "catalog", "item", "in", "stock", "only", "brand", "prefer", "usd", "inr", "for", "of", "and", "or", "buy", "get", "want", "please", "looking", "search", "show"]);
function relevanceScore(offer: LiveOffer, query: string): number {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? [];
  const title = offer.productTitle.toLowerCase();
  const brand = (offer.brand ?? "").toLowerCase();
  const description = (offer.description ?? "").toLowerCase();
  let score = 0;
  for (const token of new Set(tokens)) {
    if (title.includes(token)) score += 5;
    else if (brand.includes(token)) score += 3;
    else if (description.includes(token)) score += 1;
  }
  return score;
}

function evaluateVerdict(evaluation: QuoteEvaluationLike): Verdict {
  const hard = evaluation.verification.results.filter((item) => (item.severity ?? "hard") === "hard");
  if (hard.some((item) => item.status === "fail")) return "BLOCKED";
  if (!evaluation.verification.securityClear) return "SAFETY_HOLD";
  if (hard.some((item) => item.status === "unknown") || !evaluation.verification.evidenceFresh || !evaluation.verification.evidenceAttributable) return "NEEDS_EVIDENCE";
  return evaluation.summary.decision === "capture" ? "PASS" : "BLOCKED";
}

function explain(evaluation: QuoteEvaluationLike | null, verdict: Verdict, refreshed: boolean): string {
  if (verdict === "SKIPPED") return "This exact offer was previously excluded by the shopper.";
  if (verdict === "SAFETY_HOLD") return "PactPay could not complete a required safety or source-attribution check. This offer cannot be held.";
  if (!evaluation) return "The offer could not be evaluated by the server-side policy engine.";
  const failed = evaluation.verification.results.find((item) => (item.severity ?? "hard") === "hard" && item.status === "fail");
  if (failed) return failed.reason;
  const unknown = evaluation.verification.results.find((item) => (item.severity ?? "hard") === "hard" && item.status === "unknown");
  if (unknown) return `${unknown.reason} The rule was not relaxed.`;
  if (verdict === "PASS") return refreshed
    ? "The same product and merchant were re-fetched and the fresh snapshot passes your approved hard rules. Checkout charges are checked separately."
    : "The initial catalog check passed; a fresh product check is still required before a hold.";
  return "The offer does not satisfy every approved hard rule.";
}

export type ShortlistResult = { status: number; body: Record<string, unknown> };

/** One deterministic discovery pipeline shared by Muse, the rule-based UI and remote agents. */
export async function runDeterministicShortlist(
  request: Request,
  ctx: AgentContext,
  query: string,
  options: { includeEvaluation?: boolean } = {},
): Promise<ShortlistResult> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2 || normalizedQuery.length > 180) {
    return { status: 400, body: { error: "Send a product search phrase between 2 and 180 characters." } };
  }

  const search = await internalCall(request, ctx, "POST", "/api/discovery/search", { query: normalizedQuery });
  if (search.status !== 200) {
    return { status: search.status === 429 ? 429 : search.status >= 500 ? 502 : search.status, body: { error: typeof search.json.error === "string" ? search.json.error : "The catalog search failed." } };
  }
  const offers = (Array.isArray(search.json.offers) ? search.json.offers : []).map(asOffer).filter((offer): offer is LiveOffer => offer !== null);
  if (offers.length === 0) {
    return { status: 200, body: { query: normalizedQuery, approvalId: ctx.approvalId, searchQueries: search.json.searchQueries ?? [normalizedQuery], catalogCount: 0, refreshedCount: 0, results: [], note: "The live catalog returned no usable offers. No Purchase Pact rule was changed." } };
  }

  const world = await listSellerWorld(ctx.sessionId);
  const pact = ctx.approval.pact_json;
  const pactRules = quoteRulesFor(pact);
  const evaluated: Evaluated[] = [];
  let cursor = 0;
  async function evaluateWorker() {
    while (cursor < offers.length) {
      const offer = offers[cursor++];
      if (!offer) continue;
      const estimatedTotal = offer.currency === "USD" ? previewChannel3TestQuote(offer.price).total : null;
      if (blockedBySellerWorld(world, offerKey(offer.productId, offer.offerDomain))) {
        evaluated.push({ offer, verdict: "SKIPPED", reason: explain(null, "SKIPPED", false), relevance: relevanceScore(offer, normalizedQuery), evaluation: null, refreshed: false, refreshStatus: "Previously excluded", estimatedTotalUsd: estimatedTotal });
        continue;
      }
      const response = await internalCall(request, ctx, "POST", "/api/discovery/evaluate", { snapshotId: offer.snapshotId, pact });
      if (response.status !== 200) {
        evaluated.push({ offer, verdict: "SAFETY_HOLD", reason: "The server-side policy evaluation failed. The offer is not eligible for a hold.", relevance: relevanceScore(offer, normalizedQuery), evaluation: null, refreshed: false, refreshStatus: "Evaluation failed", estimatedTotalUsd: estimatedTotal });
        continue;
      }
      const evaluation = applyCheckoutQuote(response.json as unknown as QuoteEvaluationLike, { price: offer.price, currency: offer.currency }, pactRules);
      const verdict = evaluateVerdict(evaluation);
      evaluated.push({ offer, verdict, reason: explain(evaluation, verdict, false), relevance: relevanceScore(offer, normalizedQuery), evaluation, refreshed: false, refreshStatus: "Not re-confirmed yet", estimatedTotalUsd: estimatedTotal });
    }
  }
  await Promise.all([evaluateWorker(), evaluateWorker(), evaluateWorker(), evaluateWorker()]);

  // Refresh more than a tiny top slice so a transient detail lookup cannot hide the next valid candidate.
  // This does not relax a rule: each refreshed snapshot is checked against the exact same server-bound Pact.
  const refreshTargets = [...evaluated]
    .filter((item) => item.verdict === "PASS" || item.verdict === "NEEDS_EVIDENCE")
    .sort((a, b) => (a.verdict === "PASS" ? 0 : 1) - (b.verdict === "PASS" ? 0 : 1) || b.relevance - a.relevance || a.offer.price - b.offer.price)
    .slice(0, 10);
  await Promise.all(refreshTargets.map(async (target) => {
    const index = evaluated.findIndex((item) => item.offer.snapshotId === target.offer.snapshotId);
    if (index < 0) return;
    try {
      const refreshed = await internalCall(request, ctx, "POST", "/api/discovery/refresh", { snapshotId: target.offer.snapshotId });
      const freshOffer = isRecord(refreshed.json.refreshedOffer) ? asOffer(refreshed.json.refreshedOffer) : null;
      if (refreshed.status !== 200 || !freshOffer) {
        evaluated[index] = { ...target, verdict: "SAFETY_HOLD", reason: "Channel3 could not re-confirm the same product and merchant. This offer cannot be held.", refreshed: false, refreshStatus: typeof refreshed.json.error === "string" ? `Refresh unavailable: ${refreshed.json.error}` : "Same offer not re-confirmed" };
        return;
      }
      const freshEvaluationResponse = await internalCall(request, ctx, "POST", "/api/discovery/evaluate", { snapshotId: freshOffer.snapshotId, pact });
      if (freshEvaluationResponse.status !== 200) {
        evaluated[index] = { ...target, offer: freshOffer, verdict: "SAFETY_HOLD", reason: "The refreshed offer could not be re-evaluated. This offer cannot be held.", refreshed: false, refreshStatus: "Fresh evaluation failed" };
        return;
      }
      const freshEvaluation = applyCheckoutQuote(freshEvaluationResponse.json as unknown as QuoteEvaluationLike, { price: freshOffer.price, currency: freshOffer.currency }, pactRules);
      const freshVerdict = evaluateVerdict(freshEvaluation);
      evaluated[index] = {
        ...target, offer: freshOffer, evaluation: freshEvaluation, verdict: freshVerdict,
        reason: explain(freshEvaluation, freshVerdict, true), refreshed: true,
        refreshStatus: refreshed.json.status === "MATCHED_WITH_CHANGES" ? "Same product and merchant re-confirmed; catalog details changed" : "Same product and merchant re-confirmed",
        estimatedTotalUsd: freshOffer.currency === "USD" ? previewChannel3TestQuote(freshOffer.price).total : null,
      };
    } catch (error) {
      evaluated[index] = { ...target, verdict: "SAFETY_HOLD", reason: "The fresh catalog check failed. This offer cannot be held.", refreshed: false, refreshStatus: error instanceof Error ? `Refresh error: ${error.message.slice(0, 100)}` : "Refresh failed" };
    }
  }));

  // Initial PASS results are not hold-eligible; a fresh matched snapshot is required.
  for (let index = 0; index < evaluated.length; index += 1) {
    const item = evaluated[index]!;
    if (item.verdict === "PASS" && !item.refreshed) {
      evaluated[index] = { ...item, verdict: "NEEDS_EVIDENCE", reason: "The first catalog check passed, but this offer was not re-confirmed. It cannot be held yet.", refreshStatus: "Not re-confirmed; not hold-eligible" };
    }
  }

  const ordered = evaluated.sort((a, b) => {
    const rank = (item: Evaluated) => item.refreshed && item.verdict === "PASS" ? 0 : item.verdict === "NEEDS_EVIDENCE" ? 1 : item.verdict === "BLOCKED" ? 2 : item.verdict === "SKIPPED" ? 3 : 4;
    return rank(a) - rank(b) || b.relevance - a.relevance || a.offer.price - b.offer.price;
  });
  const results = ordered.map((item) => ({
    snapshotId: item.offer.snapshotId,
    productId: item.offer.productId,
    title: item.offer.productTitle,
    description: item.offer.description,
    brand: item.offer.brand,
    imageUrl: item.offer.imageUrl,
    structuredAttributes: item.offer.structuredAttributes,
    fetchedAt: item.offer.fetchedAt,
    validUntil: item.offer.validUntil,
    relevance: item.relevance,
    offerUrl: item.offer.offerUrl,
    merchant: item.offer.offerDomain,
    itemPrice: item.offer.price,
    currency: item.offer.currency,
    availability: item.offer.availability,
    condition: item.offer.condition,
    estimatedTotalUsd: item.estimatedTotalUsd,
    verdict: item.verdict,
    reason: item.reason,
    refreshed: item.refreshed,
    refreshStatus: item.refreshStatus,
    agentMayHoldAlone: item.refreshed && item.verdict === "PASS" && item.estimatedTotalUsd !== null && shouldAutoHold(ctx.approval.autonomy, item.estimatedTotalUsd),
    ...(options.includeEvaluation && item.evaluation ? { evaluation: item.evaluation } : {}),
  }));

  return { status: 200, body: {
    query: normalizedQuery,
    approvalId: ctx.approvalId,
    searchQueries: search.json.searchQueries ?? [normalizedQuery],
    fetchedAt: search.json.fetchedAt ?? new Date().toISOString(),
    catalogCount: offers.length,
    refreshedCount: results.filter((item) => item.refreshed).length,
    results,
    note: "Every listing was evaluated against the unchanged, server-bound Purchase Pact. Search variants improve retrieval only; they never change hard rules. Only a fresh matched snapshot with PASS may be held.",
  } };
}
