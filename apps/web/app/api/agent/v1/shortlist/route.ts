import { NextResponse } from "next/server";
import { applyCheckoutQuote, quoteRulesFor, type QuoteEvaluationLike } from "@pactpay/pact-core/checkout-quote";
import { shouldAutoHold } from "@pactpay/pact-core/autonomy";
import { blockedBySellerWorld, offerKey } from "@pactpay/pact-core/seller-world";
import { previewChannel3TestQuote } from "@pactpay/pact-core/settlement-demo";
import { authenticateAgent, gatewayProblem, internalCall, isRecord } from "../../../../../lib/agent-gateway";
import { listSellerWorld } from "../../../../../../../lib/seller-world";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LiveOffer = { snapshotId: string; productId: string; productTitle: string; offerDomain: string; price: number; currency: string; availability: string | null; brand: string | null };

function asOffer(value: unknown): LiveOffer | null {
  if (!isRecord(value)) return null;
  const { snapshotId, productId, productTitle, offerDomain, price, currency } = value;
  if (typeof snapshotId !== "string" || typeof productId !== "string" || typeof productTitle !== "string" || typeof offerDomain !== "string" || typeof price !== "number" || typeof currency !== "string") return null;
  return { snapshotId, productId, productTitle, offerDomain, price, currency, availability: typeof value.availability === "string" ? value.availability : null, brand: typeof value.brand === "string" ? value.brand : null };
}

/** Search the live catalog and rank offers against the approved rules. Nothing is held or paid here. */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const body: unknown = await request.json().catch(() => null);
  const query = isRecord(body) && typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 120) return gatewayProblem(400, "Send {\"query\": \"what to look for\"} (2 to 120 characters).");

  const search = await internalCall(request, ctx, "POST", "/api/discovery/search", { query });
  if (search.status !== 200) return gatewayProblem(search.status === 429 ? 429 : 502, typeof search.json.error === "string" ? search.json.error : "The catalog search failed.");
  const offers = (Array.isArray(search.json.offers) ? search.json.offers : []).map(asOffer).filter((offer): offer is LiveOffer => offer !== null).slice(0, 12);
  const world = await listSellerWorld(ctx.sessionId);
  const pact = ctx.approval.pact_json;

  const results: Array<Record<string, unknown>> = [];
  let cursor = 0;
  async function worker() {
    while (cursor < offers.length) {
      const offer = offers[cursor++]!;
      const skipped = blockedBySellerWorld(world, offerKey(offer.productId, offer.offerDomain));
      const estimatedTotal = offer.currency === "USD" ? previewChannel3TestQuote(offer.price).total : null;
      const base = { snapshotId: offer.snapshotId, title: offer.productTitle, merchant: offer.offerDomain, itemPrice: offer.price, currency: offer.currency, availability: offer.availability, estimatedTotalUsd: estimatedTotal };
      if (skipped) { results.push({ ...base, verdict: "SKIPPED", reason: skipped, agentMayHoldAlone: false }); continue; }
      const evaluation = await internalCall(request, ctx, "POST", "/api/discovery/evaluate", { snapshotId: offer.snapshotId, pact });
      if (evaluation.status !== 200) { results.push({ ...base, verdict: "NEEDS_EVIDENCE", reason: "The offer could not be evaluated.", agentMayHoldAlone: false }); continue; }
      const adjusted = applyCheckoutQuote(evaluation.json as unknown as QuoteEvaluationLike, { price: offer.price, currency: offer.currency }, quoteRulesFor(pact));
      const verdict = adjusted.summary.decision === "capture" ? "PASS" : adjusted.summary.hardFailures > 0 ? "BLOCKED" : "NEEDS_EVIDENCE";
      const problem = adjusted.verification.results.find((item) => (item.severity ?? "hard") === "hard" && item.status !== "pass");
      results.push({
        ...base, verdict,
        reason: verdict === "PASS" ? "Matches every must-have rule on the live catalog data." : problem?.reason ?? "A must-have rule is not met or cannot be proven.",
        agentMayHoldAlone: verdict === "PASS" && estimatedTotal !== null && shouldAutoHold(ctx.approval.autonomy, estimatedTotal),
      });
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  const rank = (verdict: unknown) => (verdict === "PASS" ? 0 : verdict === "NEEDS_EVIDENCE" ? 1 : verdict === "SKIPPED" ? 2 : 3);
  results.sort((a, b) => rank(a.verdict) - rank(b.verdict) || Number(a.itemPrice) - Number(b.itemPrice));
  return NextResponse.json({ query, approvalId: ctx.approvalId, results, note: "Only PASS offers can be held. A human approves each hold on PayPal. The final decision is made by the settlement gate." }, { headers: { "Cache-Control": "no-store" } });
}
