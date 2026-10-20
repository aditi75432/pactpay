import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  attachPayPalOrder,
  createLocalTransaction,
  markTransactionFailed,
} from "../../../../../../lib/db";
import { createAuthorizationOrder } from "../../../../../../lib/paypal";

export const runtime = "nodejs";

function isMoney(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^(?:0|[1-9]\d*)(?:\.\d{2})$/.test(value) && Number(value) > 0 && Number(value) <= 10000;
}

export async function POST(request: Request) {
  let transactionId: string | null = null;
  try {
    const body = (await request.json()) as { amount?: unknown };
    if (!isMoney(body.amount)) {
      return NextResponse.json(
        { error: "amount must be a positive USD value with exactly two decimals, up to 10000.00" },
        { status: 400 },
      );
    }

    transactionId = randomUUID();
    const authorizeRequestId = randomUUID();
    await createLocalTransaction({
      id: transactionId,
      amount: body.amount,
      createRequestId: transactionId,
      authorizeRequestId,
    });

    const order = await createAuthorizationOrder(body.amount, transactionId, transactionId);
    const approvalUrl = order.links?.find((link) => link.rel === "approve")?.href;
    if (!approvalUrl) {
      await markTransactionFailed(transactionId, "PayPal did not return an approval URL.");
      return NextResponse.json({ error: "PayPal did not return an approval URL" }, { status: 502 });
    }

    await attachPayPalOrder({ transactionId, orderId: order.id, orderStatus: order.status });
    return NextResponse.json({
      transactionId,
      orderId: order.id,
      status: "ORDER_CREATED",
      approvalUrl,
    });
  } catch (error) {
    if (transactionId) {
      try {
        await markTransactionFailed(
          transactionId,
          error instanceof Error ? error.message : "Unexpected order-creation error",
        );
      } catch {
        // Preserve the original error response; database failures are visible in server logs.
      }
    }
    console.error("PactPay order creation failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected order-creation error" },
      { status: 502 },
    );
  }
}
