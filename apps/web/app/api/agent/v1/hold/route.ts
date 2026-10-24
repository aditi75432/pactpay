import { NextResponse } from "next/server";
import { decideSettlement } from "@pactpay/pact-core/autonomy";
import { previewChannel3TestQuote } from "@pactpay/pact-core/settlement-demo";
import { authenticateAgent, gatewayProblem, internalCall, isRecord } from "../../../../../lib/agent-gateway";
import { getChannel3OfferSnapshot } from "../../../../../../../lib/db";
import { isUuidLike } from "../../../../../../../lib/pact-approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ask for a PayPal hold on an offer. This only creates a PayPal order for a human to approve; nothing is
 * charged. Whether the agent may do this without a human click depends on the autonomy the shopper chose.
 */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const body: unknown = await request.json().catch(() => null);
  const snapshotId = isRecord(body) ? body.snapshotId : null;
  if (!isUuidLike(snapshotId)) return gatewayProblem(400, "Send {\"snapshotId\": \"...\"} from a shortlist result.");

  const snapshot = await getChannel3OfferSnapshot(snapshotId);
  if (!snapshot) return gatewayProblem(404, "That offer snapshot was not found. Run a new shortlist.");
  if (snapshot.currency !== "USD") return gatewayProblem(422, "Test checkout supports USD offers only.");
  const estimated = previewChannel3TestQuote(Number(snapshot.price)).total;
  const decision = decideSettlement(ctx.approval.autonomy, estimated, "agent");
  if (!decision.allowed) {
    return gatewayProblem(403, decision.reason, { requiresHuman: true, autonomyMode: ctx.approval.autonomy.mode, estimatedTotalUsd: estimated });
  }
  const created = await internalCall(request, ctx, "POST", "/api/paypal/offer-demo/orders", {
    snapshotId, approvalId: ctx.approvalId, approved: true, sandboxQuoteAcknowledged: true,
  });
  if (created.status !== 200 && created.status !== 201) {
    return gatewayProblem(created.status === 409 ? 409 : created.status >= 500 ? 502 : created.status, typeof created.json.error === "string" ? created.json.error : "The hold could not be created.", { sellerSimulation: created.json.sellerSimulation === true });
  }
  return NextResponse.json({
    transactionId: created.json.transactionId,
    approvalUrl: created.json.approvalUrl,
    status: "WAITING_FOR_HUMAN_PAYPAL_APPROVAL",
    estimatedTotalUsd: estimated,
    nextStep: "A human must open approvalUrl and approve the PayPal hold. Nothing is charged by this. Then call settle.",
  }, { headers: { "Cache-Control": "no-store" } });
}
