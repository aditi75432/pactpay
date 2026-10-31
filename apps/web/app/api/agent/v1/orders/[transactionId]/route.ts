import { NextResponse } from "next/server";
import { authenticateAgent, gatewayProblem, internalCall, isRecord } from "../../../../../../lib/agent-gateway";
import { getTransactionPactHash } from "../../../../../../../../lib/activity";
import { isUuidLike } from "../../../../../../../../lib/pact-approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ transactionId: string }> }) {
  const auth = await authenticateAgent(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const { transactionId } = await context.params;
  if (!isUuidLike(transactionId) || (await getTransactionPactHash(transactionId)) !== ctx.approval.pact_hash.toLowerCase()) return gatewayProblem(404, "No such order for this key.");
  const found = await internalCall(request, ctx, "GET", `/api/paypal/protected-demo/transactions/${transactionId}`);
  const tx = isRecord(found.json.transaction) ? found.json.transaction : {};
  return NextResponse.json({
    transactionId,
    status: tx.status ?? null, authorizationStatus: tx.authorizationStatus ?? null, captureStatus: tx.captureStatus ?? null,
    amount: tx.amount ?? null, currency: tx.currency ?? null,
    waitingForHuman: tx.status === "ORDER_CREATED",
  }, { headers: { "Cache-Control": "no-store" } });
}
