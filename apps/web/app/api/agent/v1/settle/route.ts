import { NextResponse } from "next/server";
import { authenticateAgent, gatewayProblem, internalCall, isRecord } from "../../../../../lib/agent-gateway";
import { getTransactionPactHash } from "../../../../../../../lib/activity";
import { isUuidLike } from "../../../../../../../lib/pact-approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Request settlement of a held payment. The gateway ALWAYS acts as the agent, never as the user, so the
 * autonomy limit is enforced: above the limit (or under "Ask me every time") this is refused with 403 and a
 * human has to release it. When allowed, the same deterministic gate decides; the agent can't override it.
 */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const body: unknown = await request.json().catch(() => null);
  const transactionId = isRecord(body) ? body.transactionId : null;
  if (!isUuidLike(transactionId)) return gatewayProblem(400, "Send {\"transactionId\": \"...\"} from a hold.");
  if ((await getTransactionPactHash(transactionId)) !== ctx.approval.pact_hash.toLowerCase()) return gatewayProblem(404, "No such order for this key.");

  const settled = await internalCall(request, ctx, "POST", `/api/paypal/transactions/${transactionId}/settle`, { trigger: "agent" });
  const after = await internalCall(request, ctx, "GET", `/api/paypal/protected-demo/transactions/${transactionId}`);
  const tx = isRecord(after.json.transaction) ? after.json.transaction : {};
  const order = { status: tx.status ?? null, authorizationStatus: tx.authorizationStatus ?? null, captureStatus: tx.captureStatus ?? null, amount: tx.amount ?? null, currency: tx.currency ?? null };
  if (settled.json.requiresHuman === true) {
    return NextResponse.json({ error: settled.json.error, requiresHuman: true, autonomyMode: settled.json.autonomyMode, order }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({
    httpStatus: settled.status,
    ...(typeof settled.json.error === "string" ? { error: settled.json.error } : {}),
    order,
    outcome: order.status === "CAPTURED" ? "CAPTURED" : order.status === "VOIDED" || order.status === "VOIDING" || order.status === "POLICY_BLOCKED" ? "BLOCKED_AND_VOIDED" : "NOT_SETTLED",
  }, { status: settled.status >= 500 ? 502 : 200, headers: { "Cache-Control": "no-store" } });
}
