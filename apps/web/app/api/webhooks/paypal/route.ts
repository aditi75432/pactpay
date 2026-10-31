import { NextResponse } from "next/server";
import { recordVerifiedWebhook } from "../../../../../../lib/db";
import { verifyWebhookSignature } from "../../../../../../lib/paypal";

export const runtime = "nodejs";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function POST(request: Request) {
  if (!process.env.PAYPAL_WEBHOOK_ID?.trim()) {
    return NextResponse.json({ error: "Webhook is not configured for this environment" }, { status: 503 });
  }
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > 1_000_000) {
      return NextResponse.json({ error: "Invalid webhook body" }, { status: 400 });
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Webhook body must be valid JSON" }, { status: 400 });
    }

    const eventId = asString(event.id);
    const eventType = asString(event.event_type);
    const resource = (event.resource && typeof event.resource === "object")
      ? event.resource as Record<string, unknown>
      : {};
    const supplementary = (resource.supplementary_data && typeof resource.supplementary_data === "object")
      ? resource.supplementary_data as Record<string, unknown>
      : {};
    const relatedIds = (supplementary.related_ids && typeof supplementary.related_ids === "object")
      ? supplementary.related_ids as Record<string, unknown>
      : {};

    if (!eventId || !eventType) {
      return NextResponse.json({ error: "Webhook event is missing its ID or type" }, { status: 400 });
    }

    const requiredHeaders = {
      authAlgo: request.headers.get("paypal-auth-algo"),
      certUrl: request.headers.get("paypal-cert-url"),
      transmissionId: request.headers.get("paypal-transmission-id"),
      transmissionSignature: request.headers.get("paypal-transmission-sig"),
      transmissionTime: request.headers.get("paypal-transmission-time"),
    };
    if (Object.values(requiredHeaders).some((value) => !value)) {
      return NextResponse.json({ error: "Missing PayPal signature headers" }, { status: 400 });
    }

    const valid = await verifyWebhookSignature({
      authAlgo: requiredHeaders.authAlgo!,
      certUrl: requiredHeaders.certUrl!,
      transmissionId: requiredHeaders.transmissionId!,
      transmissionSignature: requiredHeaders.transmissionSignature!,
      transmissionTime: requiredHeaders.transmissionTime!,
      webhookEvent: event,
    });
    if (!valid) {
      return NextResponse.json({ error: "PayPal webhook signature verification failed" }, { status: 401 });
    }

    const resourceId = asString(resource.id);
    const relatedOrderId = asString(relatedIds.order_id) ?? (eventType === "CHECKOUT.ORDER.APPROVED" ? resourceId : null);
    const relatedAuthorizationId = asString(relatedIds.authorization_id) ??
      (eventType.startsWith("PAYMENT.AUTHORIZATION.") ? resourceId : null);

    const result = await recordVerifiedWebhook({
      eventId,
      eventType,
      resourceId,
      relatedOrderId,
      relatedAuthorizationId,
    });

    return NextResponse.json({
      received: true,
      verified: true,
      duplicate: result.duplicate,
      matchedTransaction: Boolean(result.transactionId),
    });
  } catch (error) {
    console.error("PactPay PayPal webhook processing failed", error);
    return NextResponse.json({ error: "Webhook verification or processing failed" }, { status: 500 });
  }
}
