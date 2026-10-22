import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { PurchasePact } from "@pactpay/pact-core";
import { evaluatePact, summarizeVerification } from "@pactpay/pact-core/policy";
import { buildChannel3BoundTestOffer, canonicalJson, isChannel3OfferPurchasable } from "@pactpay/pact-core/settlement-demo";
import {
  attachPayPalOrder,
  createLocalTransaction,
  getChannel3OfferSnapshot,
  markTransactionFailed,
  storeProtectedDemoContext,
} from "../../../../../../../lib/db";
import { sanitizePurchasePact } from "../../../../../../../lib/intent-pact";
import { getPactApproval } from "../../../../../../../lib/pact-approvals";
import { enforceRateLimit } from "../../../../../lib/request-guard";
import { readSessionId } from "../../../../../lib/session";
import { createAuthorizationOrder, isPayPalSandboxConfigured } from "../../../../../../../lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHECKOUT_AMOUNT = 10_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function publicConstraintDescription(id: string, pact: PurchasePact): string {
  return pact.constraints.find((constraint) => constraint.id === id)?.description ?? "A required purchase rule";
}

export async function POST(request: Request) {
  let transactionId: string | null = null;
  const limited = enforceRateLimit(request, "offer-order", 12, 10 * 60_000);
  if (limited) return limited;
  try {
    if (!isPayPalSandboxConfigured()) {
      return NextResponse.json({ error: "Offer-bound settlement is disabled unless PAYPAL_BASE_URL points to a recognized PayPal Sandbox hostname." }, { status: 503 });
    }

    const bodyValue: unknown = await request.json().catch(() => null);
    const body = record(bodyValue);
    if (!body || body.approved !== true || body.sandboxQuoteAcknowledged !== true) {
      return NextResponse.json({ error: "Review and explicitly approve the Sandbox test quote before continuing. No PayPal order was created." }, { status: 400 });
    }
    if (typeof body.snapshotId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.snapshotId)) {
      return NextResponse.json({ error: "Select a saved Channel3 offer snapshot before starting the Sandbox test checkout." }, { status: 400 });
    }

    let pact: PurchasePact;
    let approvedPactHash: string | null = null;
    if (typeof body.approvalId === "string") {
      // Preferred path: the Pact was approved server-side and is bound to this browser session.
      const sessionId = await readSessionId();
      if (!sessionId) {
        return NextResponse.json({ error: "We couldn't find your approval session. Approve your rules again to continue. No order was created." }, { status: 403 });
      }
      const approval = await getPactApproval(sessionId, body.approvalId);
      if (!approval) {
        return NextResponse.json({ error: "That approval was not found for this browser, or its stored rules no longer verify. Approve your rules again. No order was created." }, { status: 403 });
      }
      pact = approval.pact_json;
      approvedPactHash = approval.pact_hash.toLowerCase();
      if (pact.currency !== "USD") {
        return NextResponse.json({ error: "The protected PayPal Sandbox test-checkout adapter currently supports USD Pacts only. No order was created." }, { status: 422 });
      }
      if (pact.authority?.canCapture !== false || pact.authority?.canChangeHardConstraints !== false) {
        return NextResponse.json({ error: "The stored Pact grants authority it must never grant. Settlement fails closed." }, { status: 409 });
      }
    } else if (process.env.PACTPAY_ALLOW_CLIENT_PACT === "1") {
      // Legacy development path. Disabled by default because a browser-supplied Pact is not an approval record.
      try {
        const sanitized = sanitizePurchasePact(body.pact);
        if (sanitized.currency !== "USD") {
          return NextResponse.json({ error: "The protected PayPal Sandbox test-checkout adapter currently supports USD Pacts only. No order was created." }, { status: 422 });
        }
        pact = {
          ...sanitized,
          authority: {
            canSearch: true,
            canCompare: true,
            canCreateOrder: true,
            canAuthorize: true,
            canCapture: false,
            canSubstitute: false,
            canChangeHardConstraints: false,
          },
        };
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "The approved Purchase Pact failed validation." }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: "Approve your rules first. Orders are only created from a Pact approved and stored on the server. No order was created." }, { status: 400 });
    }

    const source = await getChannel3OfferSnapshot(body.snapshotId);
    if (!source) return NextResponse.json({ error: "This offer snapshot was not found. Run a fresh Channel3 search and select the offer again." }, { status: 404 });
    const now = new Date();
    const fetchedAtMs = Date.parse(source.fetched_at);
    const validUntilMs = Date.parse(source.valid_until);
    if (!Number.isFinite(fetchedAtMs) || !Number.isFinite(validUntilMs) || fetchedAtMs > now.getTime() || validUntilMs <= now.getTime()) {
      return NextResponse.json({ error: "This catalog snapshot is stale. Refresh the exact offer before starting a Sandbox test checkout." }, { status: 409 });
    }
    if (source.currency.trim().toUpperCase() !== "USD" || source.currency.trim().toUpperCase() !== pact.currency) {
      return NextResponse.json({ error: `The selected offer is ${source.currency.trim()}, but this Sandbox checkout requires ${pact.currency}. Choose a matching-currency listing. No order was created.` }, { status: 422 });
    }
    if (!isChannel3OfferPurchasable(source.availability)) {
      return NextResponse.json({
        error: `Channel3 has not confirmed that this exact offer is currently purchasable (availability: ${source.availability?.trim() || "unknown"}). Choose an offer with a positive availability state. No PayPal order or authorization was created.`,
        paymentAction: "NONE",
        capturePerformedByPactPay: false,
      }, { status: 422 });
    }
    const price = Number(source.price);
    if (!Number.isFinite(price) || price <= 0 || price > 9_000) {
      return NextResponse.json({ error: "The selected catalog item price is outside the supported Sandbox test range." }, { status: 422 });
    }

    transactionId = randomUUID();
    const observedSource = {
      snapshotId: source.id,
      currentObservationSnapshotId: source.id,
      productId: source.product_id,
      title: source.product_title,
      description: source.description,
      brand: source.brand,
      imageUrl: source.image_url,
      domain: source.offer_domain,
      offerUrl: source.offer_url,
      itemPrice: price,
      currency: source.currency.trim().toUpperCase(),
      availability: source.availability,
      condition: source.condition,
      ramGb: source.ram_gb === null ? null : Number(source.ram_gb),
      structuredAttributes: source.structured_attributes,
      fetchedAt: new Date(source.fetched_at).toISOString(),
      validUntil: new Date(source.valid_until).toISOString(),
    };
    const baselineOffer = buildChannel3BoundTestOffer(transactionId, observedSource, now);
    const baselineOfferRecord = baselineOffer as unknown as Record<string, unknown>;
    const preflight = evaluatePact(pact, baselineOffer, { securityClear: true, now });
    const hardNeedsWork = preflight.results.filter((result) => (result.severity ?? "hard") === "hard" && result.status !== "pass");
    if (hardNeedsWork.length > 0 || !preflight.evidenceFresh || !preflight.evidenceAttributable) {
      const blockers = hardNeedsWork.slice(0, 4).map((result) => {
        const status = result.status === "fail" ? "does not match" : "is not verified";
        return `${publicConstraintDescription(result.constraintId, pact)} — ${status}`;
      });
      if (!preflight.evidenceFresh) blockers.push("Required evidence is stale.");
      if (!preflight.evidenceAttributable) blockers.push("Required evidence cannot be attributed to the selected offer or test quote.");
      return NextResponse.json({
        error: `This offer is not eligible for a protected Sandbox test checkout yet: ${blockers.join("; ")}. No PayPal order or authorization was created.`,
        preflight: { decision: summarizeVerification(preflight).decision, blockers },
        paymentAction: "NONE",
        capturePerformedByPactPay: false,
      }, { status: 422 });
    }

    const total = Number(baselineOffer.total);
    if (!Number.isFinite(total) || total <= 0 || total > MAX_CHECKOUT_AMOUNT) {
      return NextResponse.json({ error: `The simulated Sandbox test quote must be positive and no more than USD ${MAX_CHECKOUT_AMOUNT.toFixed(2)}.` }, { status: 422 });
    }
    const amount = total.toFixed(2);
    const pactHash = sha256(pact);
    if (approvedPactHash && pactHash !== approvedPactHash) {
      return NextResponse.json({ error: "The stored Pact no longer matches its approved hash. Settlement fails closed and no order was created." }, { status: 409 });
    }
    const baselineOfferHash = sha256(baselineOffer);
    const authorizeRequestId = randomUUID();

    await createLocalTransaction({
      id: transactionId,
      amount,
      createRequestId: transactionId,
      authorizeRequestId,
      offerSnapshotId: source.id,
    });
    await storeProtectedDemoContext({
      transactionId,
      pact: pact as unknown as Record<string, unknown>,
      pactHash,
      baselineOffer: baselineOfferRecord,
      baselineOfferHash,
      currentOffer: baselineOfferRecord,
      scenarioId: "BASELINE",
      securityFinding: null,
    });

    const safeTitle = source.product_title.replace(/[\r\n\t]/g, " ").trim().slice(0, 70) || "Selected Channel3 offer";
    const order = await createAuthorizationOrder(amount, transactionId, transactionId, {
      referenceId: "pactpay-channel3-test-checkout-v1",
      description: `PactPay Sandbox test checkout · ${safeTitle} · not a retailer order`,
      flow: "protected-demo",
    });
    const approvalUrl = order.links?.find((link) => link.rel === "approve")?.href;
    if (!approvalUrl) {
      await markTransactionFailed(transactionId, "PayPal did not return an approval URL for the offer-bound Sandbox test checkout.");
      return NextResponse.json({ error: "PayPal did not return a Sandbox approval URL. No capture was performed." }, { status: 502 });
    }
    await attachPayPalOrder({ transactionId, orderId: order.id, orderStatus: order.status });

    return NextResponse.json({
      transactionId,
      orderId: order.id,
      amount,
      currency: "USD",
      approvalUrl,
      mode: "DEMO_SIMULATOR",
      checkoutAdapter: "PACTPAY_CHANNEL3_TEST_CHECKOUT",
      sourceSnapshotId: source.id,
      sourceProductId: source.product_id,
      sourceTitle: source.product_title,
      sourceMerchant: source.offer_domain,
      sourceItemPrice: price,
      quote: baselineOffer.sandboxQuote,
      pactHash,
      note: "Bound to the selected live Channel3 catalog snapshot. The item price and catalog attributes originate from Channel3; shipping and test tax are PactPay simulator terms. This PayPal Sandbox authorization is not a purchase from the displayed retailer.",
      simulatorOnly: true,
      capturePerformedByPactPay: false,
    });
  } catch (error) {
    if (transactionId) {
      try { await markTransactionFailed(transactionId, error instanceof Error ? error.message : "Offer-bound Sandbox order creation failed."); }
      catch { /* Preserve the primary error; a failed local record remains inspectable. */ }
    }
    console.error("Offer-bound Sandbox checkout creation failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "The offer-bound Sandbox test checkout could not be created. No capture was performed." }, { status: 502 });
  }
}
