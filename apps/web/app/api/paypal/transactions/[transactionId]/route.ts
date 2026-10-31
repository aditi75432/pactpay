import { NextResponse } from "next/server";
import { getAuditEvents, getTransactionById, isUuid, verifyAuditChain } from "../../../../../../../lib/db";
import { requireTransactionAccess } from "../../../../../lib/ownership";

export const runtime = "nodejs";

function publicTransaction(tx: NonNullable<Awaited<ReturnType<typeof getTransactionById>>>) {
  return {
    transactionId: tx.id,
    status: tx.status,
    amount: tx.amount,
    currency: tx.currency.trim(),
    orderId: tx.paypal_order_id,
    orderStatus: tx.paypal_order_status,
    authorizationId: tx.authorization_id,
    authorizationStatus: tx.paypal_authorization_status,
    authorizationExpiresAt: tx.authorization_expires_at,
    authorizedAt: tx.authorized_at,
    createdAt: tx.created_at,
    updatedAt: tx.updated_at,
    lastError: tx.last_error_message,
    offerSnapshotId: tx.offer_snapshot_id,
    policyRunId: tx.policy_run_id,
    pactHash: tx.pact_hash,
    captureId: tx.paypal_capture_id,
    captureStatus: tx.paypal_capture_status,
    voidStatus: tx.paypal_void_status,
    capturedAt: tx.captured_at,
    voidedAt: tx.voided_at,
  };
}

export async function GET(_request: Request, context: { params: Promise<{ transactionId: string }> }) {
  try {
    const { transactionId } = await context.params;
    if (!isUuid(transactionId)) return NextResponse.json({ error: "Invalid transaction ID" }, { status: 400 });
    const accessDenied = await requireTransactionAccess(transactionId);
    if (accessDenied) return accessDenied;
    const tx = await getTransactionById(transactionId);
    if (!tx) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    const audit = await getAuditEvents(transactionId);
    const auditChain = await verifyAuditChain(transactionId);
    return NextResponse.json({ transaction: publicTransaction(tx), audit, auditChain, capturePerformedByPactPay: tx.capture_origin === "PACTPAY_GATE" });
  } catch (error) {
    console.error("PactPay transaction lookup failed", error);
    return NextResponse.json({ error: "Unable to load transaction status" }, { status: 500 });
  }
}
