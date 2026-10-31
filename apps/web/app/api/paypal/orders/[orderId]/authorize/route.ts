import { NextResponse } from "next/server";
import {
  claimAuthorization,
  getTransactionById,
  recordAuthorizationSuccess,
  resetAuthorizationForRetry,
  isUuid,
} from "../../../../../../../../lib/db";
import { authorizeOrder } from "../../../../../../../../lib/paypal";
import { requireTransactionAccess } from "../../../../../../lib/ownership";

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
    lastError: tx.last_error_message,
  };
}

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  let transactionId: string | null = null;
  try {
    const { orderId } = await context.params;
    if (!/^[A-Z0-9]+$/i.test(orderId)) {
      return NextResponse.json({ error: "Invalid PayPal order ID" }, { status: 400 });
    }

    const body = (await request.json()) as { transactionId?: unknown };
    if (typeof body.transactionId !== "string" || !isUuid(body.transactionId)) {
      return NextResponse.json({ error: "A valid local transaction ID is required" }, { status: 400 });
    }
    transactionId = body.transactionId;
    const accessDenied = await requireTransactionAccess(transactionId);
    if (accessDenied) return accessDenied;

    const tx = await getTransactionById(transactionId);
    if (!tx || tx.paypal_order_id !== orderId) {
      return NextResponse.json({ error: "Order is not bound to this PactPay transaction" }, { status: 404 });
    }

    if (tx.status === "AUTHORIZED" || tx.status === "AUTHORIZATION_REVIEW") {
      return NextResponse.json({ transaction: publicTransaction(tx), idempotent: true, capturePerformed: false });
    }
    if (tx.status === "AUTHORIZING") {
      return NextResponse.json({ transaction: publicTransaction(tx), inProgress: true, capturePerformed: false });
    }
    if (tx.status !== "ORDER_CREATED") {
      return NextResponse.json(
        { error: `Transaction cannot be authorized from state ${tx.status}`, transaction: publicTransaction(tx) },
        { status: 409 },
      );
    }

    const claimed = await claimAuthorization(transactionId);
    if (!claimed) {
      const current = await getTransactionById(transactionId);
      if (current?.status === "AUTHORIZED" || current?.status === "AUTHORIZATION_REVIEW") {
        return NextResponse.json({ transaction: publicTransaction(current), idempotent: true, capturePerformed: false });
      }
      return NextResponse.json({ transaction: current ? publicTransaction(current) : null, inProgress: true, capturePerformed: false });
    }

    const paypalResponse = await authorizeOrder(orderId, tx.authorize_request_id);
    const authorization = paypalResponse.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!authorization?.id || !authorization.amount?.value || !authorization.amount.currency_code || !authorization.status) {
      await resetAuthorizationForRetry(transactionId, "PayPal authorization response was missing required payment details.");
      return NextResponse.json({ error: "PayPal authorization response was incomplete" }, { status: 502 });
    }

    await recordAuthorizationSuccess({
      transactionId,
      authorizationId: authorization.id,
      authorizationStatus: authorization.status,
      orderStatus: typeof paypalResponse.status === "string" ? paypalResponse.status : null,
      authorizationExpiresAt: authorization.expiration_time ?? null,
      amount: authorization.amount.value,
      currency: authorization.amount.currency_code,
    });

    const completed = await getTransactionById(transactionId);
    if (!completed) throw new Error("PactPay transaction disappeared after authorization.");
    return NextResponse.json({
      transaction: publicTransaction(completed),
      capturePerformed: false,
      message: completed.status === "AUTHORIZED"
        ? "Authorization recorded. No capture was performed."
        : "PayPal returned an authorization, but its amount/currency/status requires review. No capture was performed.",
    });
  } catch (error) {
    if (transactionId) {
      try {
        await resetAuthorizationForRetry(transactionId, error instanceof Error ? error.message : "Unexpected authorization error");
      } catch {
        // Preserve the original failure; the transaction can be inspected in the database.
      }
    }
    console.error("PactPay authorization failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected authorization error", capturePerformed: false },
      { status: 502 },
    );
  }
}
