import { NextResponse } from "next/server";
import {
  finalizeProtectedCapture,
  getAuditEvents,
  getProtectedDemoContext,
  getTransactionById,
  isUuid,
  verifyAuditChain,
} from "../../../../../../../../lib/db";
import {
  getAuthorization,
  getCapture,
  getOrder,
  isPayPalSandboxConfigured,
} from "../../../../../../../../lib/paypal";
import { requireTransactionAccess } from "../../../../../../lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Money = { value?: string; currency_code?: string } | null | undefined;

function moneyToCents(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

function amountMatches(actual: Money, expectedValue: string, expectedCurrency: string): boolean {
  if (!actual || typeof actual.value !== "string" || typeof actual.currency_code !== "string") return false;
  const actualCents = moneyToCents(actual.value);
  const expectedCents = moneyToCents(expectedValue);
  return actualCents !== null && expectedCents !== null &&
    actualCents === expectedCents &&
    actual.currency_code.trim().toUpperCase() === expectedCurrency.trim().toUpperCase();
}

function conflict(message: string, status = 409) {
  return NextResponse.json({ error: message, capturePerformedByPactPay: false }, { status });
}

/**
 * Reconcile a capture that PactPay itself requested but could not verify from the POST response.
 * This route calls only PayPal GET endpoints. It never captures, voids, or retries a payment.
 */
export async function POST(_request: Request, context: { params: Promise<{ transactionId: string }> }) {
  try {
    const { transactionId } = await context.params;
    if (!isUuid(transactionId)) return conflict("Invalid transaction ID.", 400);
    const accessDenied = await requireTransactionAccess(transactionId);
    if (accessDenied) return accessDenied;
    if (!isPayPalSandboxConfigured()) {
      return conflict("Capture reconciliation is restricted to PayPal Sandbox.", 403);
    }

    const tx = await getTransactionById(transactionId);
    if (!tx) return conflict("Transaction not found.", 404);
    if (tx.status !== "CAPTURE_REVIEW") {
      return conflict(`Only CAPTURE_REVIEW transactions can be reconciled; current state is ${tx.status}.`);
    }
    if (!tx.paypal_order_id || !tx.authorization_id || !tx.pact_hash) {
      return conflict("The transaction is missing its bound order, authorization, or Purchase Pact hash.");
    }

    const purchase = await getProtectedDemoContext(transactionId);
    if (!purchase || purchase.mode !== "DEMO_SIMULATOR" ||
        purchase.pact_hash.trim() !== tx.pact_hash.trim()) {
      return conflict("The persisted simulator Purchase Pact does not match the transaction binding.");
    }

    const chain = await verifyAuditChain(transactionId);
    if (!chain.valid) {
      return conflict("Audit chain is invalid. Reconciliation was not applied; investigate the audit record first.");
    }
    const events = await getAuditEvents(transactionId);
    const gatePassed = events.some((event) => event.event_type === "SETTLEMENT_GATE_PASSED");
    const captureRequested = events.find((event) => event.event_type === "PAYPAL_CAPTURE_REQUESTED");
    const priorReconciliation = events.some((event) => event.event_type === "PAYPAL_CAPTURE_REQUIRES_RECONCILIATION");
    if (!gatePassed || !captureRequested || !priorReconciliation ||
        captureRequested.details?.authorizationId !== tx.authorization_id) {
      return conflict("The audit trail does not prove that PactPay previously requested this capture under the bound gate.");
    }

    // All remote operations below are GET-only. Verify the order, authorization, and capture agree.
    const [order, authorization] = await Promise.all([
      getOrder(tx.paypal_order_id),
      getAuthorization(tx.authorization_id),
    ]);

    if (order.id !== tx.paypal_order_id || order.status !== "COMPLETED") {
      return conflict("PayPal order ID/status does not match the expected completed order.");
    }
    const units = order.purchase_units ?? [];
    if (units.length !== 1) {
      return conflict("Expected exactly one purchase unit in the protected Sandbox order.");
    }
    const unit = units[0];
    if (unit.custom_id !== transactionId || unit.reference_id !== "pactpay-protected-demo-v1" ||
        !amountMatches(unit.amount, tx.amount, tx.currency)) {
      return conflict("The PayPal order's transaction binding, reference, amount, or currency did not match PactPay.");
    }

    if (authorization.id !== tx.authorization_id || authorization.status !== "CAPTURED" ||
        !amountMatches(authorization.amount, tx.amount, tx.currency) ||
        (authorization.supplementary_data?.related_ids?.order_id &&
          authorization.supplementary_data.related_ids.order_id !== tx.paypal_order_id)) {
      return conflict("The PayPal authorization resource did not verify as captured for this order and amount.");
    }

    const orderAuthorizations = unit.payments?.authorizations ?? [];
    const matchingOrderAuthorization = orderAuthorizations.find((item) => item.id === tx.authorization_id);
    if (!matchingOrderAuthorization || matchingOrderAuthorization.status !== "CAPTURED" ||
        !amountMatches(matchingOrderAuthorization.amount, tx.amount, tx.currency)) {
      return conflict("The completed order does not contain the expected captured authorization.");
    }

    const orderCaptures = unit.payments?.captures ?? [];
    if (orderCaptures.length !== 1) {
      return conflict("Expected exactly one capture in the protected Sandbox order; no local state was changed.");
    }
    const captureListedOnOrder = orderCaptures[0];
    if (!captureListedOnOrder.id || captureListedOnOrder.status !== "COMPLETED" ||
        !amountMatches(captureListedOnOrder.amount, tx.amount, tx.currency)) {
      return conflict("The order's capture does not verify as completed for the exact authorized amount.");
    }

    const capture = await getCapture(captureListedOnOrder.id);
    if (capture.id !== captureListedOnOrder.id || capture.status !== "COMPLETED" ||
        !amountMatches(capture.amount, tx.amount, tx.currency) || capture.final_capture === false ||
        (capture.supplementary_data?.related_ids?.authorization_id &&
          capture.supplementary_data.related_ids.authorization_id !== tx.authorization_id) ||
        (capture.supplementary_data?.related_ids?.order_id &&
          capture.supplementary_data.related_ids.order_id !== tx.paypal_order_id)) {
      return conflict("The direct PayPal capture resource failed ID, status, amount, currency, or relationship verification.");
    }

    const final = await finalizeProtectedCapture({
      transactionId,
      captureId: capture.id,
      captureStatus: capture.status,
      amount: capture.amount?.value ?? null,
      currency: capture.amount?.currency_code ?? null,
      reconciliation: {
        orderId: tx.paypal_order_id,
        authorizationId: tx.authorization_id,
      },
    });
    if (final.status !== "CAPTURED" || !final.amountMatches || !final.currencyMatches) {
      return conflict("PayPal was verified, but PactPay did not reach CAPTURED. Leave the transaction under review.", 502);
    }

    const [updated, auditIntegrity] = await Promise.all([
      getTransactionById(transactionId),
      verifyAuditChain(transactionId),
    ]);
    return NextResponse.json({
      reconciliation: "VERIFIED",
      transaction: updated ? {
        transactionId: updated.id,
        status: updated.status,
        amount: updated.amount,
        currency: updated.currency.trim(),
        orderId: updated.paypal_order_id,
        authorizationId: updated.authorization_id,
        captureId: updated.paypal_capture_id,
        captureStatus: updated.paypal_capture_status,
        captureOrigin: updated.capture_origin,
        capturedAt: updated.captured_at,
        lastError: updated.last_error_message,
      } : null,
      paypalVerification: {
        orderStatus: order.status,
        authorizationStatus: authorization.status,
        captureId: capture.id,
        captureStatus: capture.status,
        amount: capture.amount?.value,
        currency: capture.amount?.currency_code,
      },
      auditIntegrity,
      capturePerformedByPactPay: updated?.capture_origin === "PACTPAY_GATE",
      simulatorOnly: true,
      note: "Reconciled from PayPal read-only order, authorization, and capture resources. No capture or void request was issued by this reconciliation endpoint.",
    });
  } catch (error) {
    console.error("Protected capture reconciliation failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({
      error: "Unable to verify and reconcile the existing PayPal capture. No new capture or void was requested.",
      capturePerformedByPactPay: false,
    }, { status: 502 });
  }
}
