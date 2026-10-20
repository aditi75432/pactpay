import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { buildProtectedDemoOffer, buildProtectedDemoPact, canonicalJson, PROTECTED_DEMO_AMOUNT } from "@pactpay/pact-core/settlement-demo";
import { attachPayPalOrder, createLocalTransaction, markTransactionFailed, storeProtectedDemoContext } from "../../../../../../../lib/db";
import { createAuthorizationOrder, isPayPalSandboxConfigured } from "../../../../../../../lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export async function POST(request: Request) {
  let transactionId: string | null = null;
  try {
    if (!isPayPalSandboxConfigured()) {
      return NextResponse.json({ error: "Protected demo is disabled unless PAYPAL_BASE_URL points to a recognized PayPal Sandbox hostname." }, { status: 503 });
    }
    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || (body as { approved?: unknown }).approved !== true) {
      return NextResponse.json({ error: "Explicit approval of the displayed simulated Purchase Pact is required." }, { status: 400 });
    }

    const createdAt = new Date();
    transactionId = randomUUID();
    const pact = buildProtectedDemoPact(transactionId, createdAt);
    const baselineOffer = buildProtectedDemoOffer(transactionId, createdAt);
    const pactHash = sha256(pact);
    const baselineOfferHash = sha256(baselineOffer);
    const authorizeRequestId = randomUUID();

    await createLocalTransaction({
      id: transactionId,
      amount: PROTECTED_DEMO_AMOUNT,
      createRequestId: transactionId,
      authorizeRequestId,
    });

    // Bind the approved purchase context before creating the PayPal order or exposing its approval URL.
    await storeProtectedDemoContext({
      transactionId,
      pact: pact as unknown as Record<string, unknown>,
      pactHash,
      baselineOffer: baselineOffer as unknown as Record<string, unknown>,
      baselineOfferHash,
      currentOffer: baselineOffer as unknown as Record<string, unknown>,
      scenarioId: "BASELINE",
      securityFinding: null,
    });

    const order = await createAuthorizationOrder(
      PROTECTED_DEMO_AMOUNT,
      transactionId,
      transactionId,
      {
        referenceId: "pactpay-protected-demo-v1",
        description: "PactPay protected-settlement demonstration — simulated offer, Sandbox only",
        flow: "protected-demo",
      },
    );
    const approvalUrl = order.links?.find((link) => link.rel === "approve")?.href;
    if (!approvalUrl) {
      await markTransactionFailed(transactionId, "PayPal did not return an approval URL for the protected demo order.");
      return NextResponse.json({ error: "PayPal did not return an approval URL." }, { status: 502 });
    }

    await attachPayPalOrder({ transactionId, orderId: order.id, orderStatus: order.status });
    return NextResponse.json({
      transactionId,
      orderId: order.id,
      amount: PROTECTED_DEMO_AMOUNT,
      currency: "USD",
      approvalUrl,
      mode: "DEMO_SIMULATOR",
      pactHash,
      message: "A simulated purchase pact is bound before buyer approval. This is not a purchase from a Channel3-listed retailer.",
      capturePerformedByPactPay: false,
    });
  } catch (error) {
    if (transactionId) {
      try {
        await markTransactionFailed(transactionId, error instanceof Error ? error.message : "Protected demo order creation failed.");
      } catch {
        // Preserve the original response; transaction/audit state can be inspected separately.
      }
    }
    console.error("Protected demo order creation failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Protected Sandbox demo order could not be created. No capture was performed." }, { status: 502 });
  }
}
