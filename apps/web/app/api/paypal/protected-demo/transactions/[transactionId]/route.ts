import { NextResponse } from "next/server";
import { getProtectedDemoContext, getTransactionById, isUuid, verifyAuditChain } from "../../../../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    offerSnapshotId: tx.offer_snapshot_id,
    policyRunId: tx.policy_run_id,
    pactHash: tx.pact_hash,
    captureId: tx.paypal_capture_id,
    captureStatus: tx.paypal_capture_status,
    captureOrigin: tx.capture_origin,
    voidStatus: tx.paypal_void_status,
    capturedAt: tx.captured_at,
    voidedAt: tx.voided_at,
    lastError: tx.last_error_message,
  };
}

function gateReasonsOf(value: unknown): string[] {
  if (!value || typeof value !== "object" || !("settlementGate" in value)) return [];
  const gate = (value as Record<string, unknown>).settlementGate;
  if (!gate || typeof gate !== "object") return [];
  const reasons = (gate as Record<string, unknown>).reasons;
  return Array.isArray(reasons) ? reasons.filter((item): item is string => typeof item === "string") : [];
}

export async function GET(_request: Request, context: { params: Promise<{ transactionId: string }> }) {
  try {
    const { transactionId } = await context.params;
    if (!isUuid(transactionId)) return NextResponse.json({ error: "Invalid transaction ID." }, { status: 400 });
    const [tx, purchase, auditChain] = await Promise.all([
      getTransactionById(transactionId),
      getProtectedDemoContext(transactionId),
      verifyAuditChain(transactionId),
    ]);
    if (!tx) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    if (!purchase || purchase.mode !== "DEMO_SIMULATOR") {
      return NextResponse.json({ error: "This transaction has no bound protected demo context." }, { status: 404 });
    }
    return NextResponse.json({
      transaction: publicTransaction(tx),
      purchaseContext: {
        mode: purchase.mode,
        pact: purchase.pact_json,
        pactHash: purchase.pact_hash,
        baselineOffer: purchase.baseline_offer,
        baselineOfferHash: purchase.baseline_offer_hash,
        currentOffer: purchase.current_offer,
        scenarioId: purchase.scenario_id,
        securityFinding: purchase.security_finding,
        securityFindingPresent: Boolean(purchase.security_finding),
        revision: purchase.revision,
        gateDecision: purchase.gate_decision,
        gateVerification: purchase.gate_verification && typeof purchase.gate_verification === "object" && "verification" in purchase.gate_verification
          ? (purchase.gate_verification as Record<string, unknown>).verification
          : purchase.gate_verification,
        gateHash: purchase.gate_hash,
        gateReasons: gateReasonsOf(purchase.gate_verification),
        gateVerifiedAt: purchase.gate_verified_at,
        gateValidUntil: purchase.gate_valid_until,
      },
      auditIntegrity: {
        valid: auditChain.valid,
        eventCount: auditChain.eventCount,
        failedEventId: auditChain.firstInvalidEventId,
      },
      capturePerformedByPactPay: tx.capture_origin === "PACTPAY_GATE",
      simulatorOnly: true,
    });
  } catch (error) {
    console.error("Protected demo context lookup failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Unable to load protected demo context." }, { status: 500 });
  }
}
