import { NextResponse } from "next/server";
import { getProtectedDemoContext, getTransactionById, isUuid, verifyAuditChain } from "../../../../../../../../lib/db";
import { getAuthorization, getCapture, getOrder, isPayPalSandboxConfigured } from "../../../../../../../../lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Money = { value?: string; currency_code?: string } | null | undefined;

function moneyToCents(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

function amountMatches(actual: Money, expectedAmount: string, expectedCurrency: string): boolean {
  if (!actual || typeof actual.value !== "string" || typeof actual.currency_code !== "string") return false;
  const a = moneyToCents(actual.value);
  const e = moneyToCents(expectedAmount);
  return a !== null && e !== null && a === e && actual.currency_code.trim().toUpperCase() === expectedCurrency.trim().toUpperCase();
}

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

/** Read-only status check against PayPal Sandbox. This route never captures, voids, or changes local state. */
export async function GET(_request: Request, context: { params: Promise<{ transactionId: string }> }) {
  try {
    const { transactionId } = await context.params;
    if (!isUuid(transactionId)) return jsonNoStore({ error: "Invalid transaction ID." }, 400);
    if (!isPayPalSandboxConfigured()) return jsonNoStore({ error: "Live state checks are restricted to PayPal Sandbox." }, 403);

    const [tx, purchase, auditIntegrity] = await Promise.all([
      getTransactionById(transactionId),
      getProtectedDemoContext(transactionId),
      verifyAuditChain(transactionId),
    ]);
    if (!tx) return jsonNoStore({ error: "Transaction not found." }, 404);
    if (!purchase || purchase.mode !== "DEMO_SIMULATOR") return jsonNoStore({ error: "This transaction is not a protected Sandbox checkout." }, 404);
    if (!tx.paypal_order_id) return jsonNoStore({ error: "No PayPal order is attached to this transaction yet." }, 409);

    const order = await getOrder(tx.paypal_order_id);
    const units = order.purchase_units ?? [];
    const unit = units.find((item) => item.custom_id === transactionId) ?? (units.length === 1 ? units[0] : undefined);
    const orderAuthorization = unit?.payments?.authorizations?.find((item) => item.id === tx.authorization_id) ?? unit?.payments?.authorizations?.[0] ?? null;
    const authorizationId = tx.authorization_id ?? orderAuthorization?.id ?? null;
    const authorization = authorizationId ? await getAuthorization(authorizationId) : orderAuthorization;
    const orderCapture = unit?.payments?.captures?.find((item) => item.id === tx.paypal_capture_id) ?? unit?.payments?.captures?.find((item) => item.status === "COMPLETED") ?? unit?.payments?.captures?.[0] ?? null;
    const captureId = tx.paypal_capture_id ?? orderCapture?.id ?? null;
    let capture = orderCapture;
    let captureResourceRead = false;
    if (captureId) {
      try {
        capture = await getCapture(captureId);
        captureResourceRead = true;
      } catch {
        // Keep the capture summary embedded in the just-fetched order if the direct resource
        // is temporarily unavailable, and explicitly mark that fallback in the result.
        captureResourceRead = false;
      }
    }

    const bindingMatches = order.id === tx.paypal_order_id && unit?.custom_id === transactionId;
    const orderAmountMatches = amountMatches(unit?.amount, tx.amount, tx.currency);
    const authorizationAmountMatches = amountMatches(authorization?.amount, tx.amount, tx.currency);
    const captureAmountMatches = capture ? amountMatches(capture.amount, tx.amount, tx.currency) : null;
    const captureCompleted = capture?.status === "COMPLETED";
    const captureRelationshipMatches = Boolean(capture) &&
      (!capture?.supplementary_data?.related_ids?.authorization_id || capture.supplementary_data.related_ids.authorization_id === authorizationId) &&
      (!capture?.supplementary_data?.related_ids?.order_id || capture.supplementary_data.related_ids.order_id === tx.paypal_order_id);
    const canReconcileCapture = tx.status === "CAPTURE_REVIEW" && auditIntegrity.valid &&
      bindingMatches && orderAmountMatches && authorization?.status === "CAPTURED" && authorizationAmountMatches &&
      captureCompleted && captureAmountMatches === true && captureRelationshipMatches && Boolean(capture?.id);

    return jsonNoStore({
      checkedAt: new Date().toISOString(),
      local: { transactionId: tx.id, status: tx.status, amount: tx.amount, currency: tx.currency.trim(), orderId: tx.paypal_order_id, authorizationId: tx.authorization_id, captureId: tx.paypal_capture_id, captureStatus: tx.paypal_capture_status },
      paypal: {
        order: { id: order.id ?? null, status: order.status ?? "UNKNOWN", referenceId: unit?.reference_id ?? null, customId: unit?.custom_id ?? null, amount: unit?.amount?.value ?? null, currency: unit?.amount?.currency_code ?? null },
        authorization: authorization ? { id: authorization.id, status: authorization.status, amount: authorization.amount?.value ?? null, currency: authorization.amount?.currency_code ?? null, expiresAt: authorization.expiration_time ?? null } : null,
        capture: capture ? { id: capture.id ?? null, status: capture.status ?? "UNKNOWN", amount: capture.amount?.value ?? null, currency: capture.amount?.currency_code ?? null, finalCapture: capture.final_capture ?? null, directResourceRead: captureResourceRead } : null,
      },
      verification: {
        orderIdMatches: order.id === tx.paypal_order_id,
        transactionBindingMatches: bindingMatches,
        orderAmountMatches,
        authorizationAmountMatches,
        captureCompleted: Boolean(captureCompleted),
        captureAmountMatches,
        captureRelationshipMatches,
        auditValid: auditIntegrity.valid,
        canReconcileCapture,
      },
      auditIntegrity: { valid: auditIntegrity.valid, eventCount: auditIntegrity.eventCount, firstInvalidEventId: auditIntegrity.firstInvalidEventId },
      readOnly: true,
      paymentAction: "NONE",
      note: "This check queried PayPal Sandbox directly and did not create, capture, void, or modify a payment. It does not place a retailer order.",
    });
  } catch (error) {
    console.error("PayPal live state check failed", error instanceof Error ? error.message : "unknown error");
    return jsonNoStore({ error: "Could not refresh the live PayPal state. The local transaction has not been changed.", paymentAction: "NONE" }, 502);
  }
}
