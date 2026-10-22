import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { Evidence, PurchasePact } from "@pactpay/pact-core";
import { evaluatePact, summarizeVerification, type OfferSnapshot } from "@pactpay/pact-core/policy";
import { getChannel3OfferSnapshot, isUuid, recordPolicyRun } from "../../../../../../lib/db";
import { sanitizePurchasePact } from "../../../../../../lib/intent-pact";
import { enforceRateLimit } from "../../../../lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVIDENCE_TTL_MS = 60_000;

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, "discovery-evaluate", 240, 10 * 60_000);
  if (rateLimited) return rateLimited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const requestBody = body as { snapshotId?: unknown; pact?: unknown } | null;
  const snapshotIdValue = requestBody?.snapshotId;
  if (typeof snapshotIdValue !== "string" || !isUuid(snapshotIdValue)) {
    return NextResponse.json({ error: "snapshotId must identify a server-stored Channel3 offer snapshot." }, { status: 400 });
  }
  let reviewedPact: PurchasePact | null = null;
  if (requestBody && Object.prototype.hasOwnProperty.call(requestBody, "pact")) {
    try {
      reviewedPact = sanitizePurchasePact(requestBody.pact);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "The supplied Purchase Pact failed validation." }, { status: 400 });
    }
  }
  if (!reviewedPact) {
    return NextResponse.json({ error: "Approve a Purchase Pact in the Pact Composer before evaluating live offers. PactPay will not silently apply unrelated default rules." }, { status: 400 });
  }
  const pact = reviewedPact;

  try {
    const stored = await getChannel3OfferSnapshot(snapshotIdValue);
    if (!stored) return NextResponse.json({ error: "Offer snapshot not found. Run a fresh Channel3 search." }, { status: 404 });

    const now = new Date();
    const fetchedAt = new Date(stored.fetched_at);
    const validUntil = new Date(stored.valid_until);
    const evidence: Evidence[] = [];
    const addEvidence = (field: string, value: string | number | boolean | null, claim: string) => {
      if (value === null) return;
      evidence.push({
        id: `c3-${stored.id}-${field.replace(/[^a-zA-Z0-9]/g, "-")}`,
        source: "Channel3 live search response",
        sourceType: "channel3",
        collectedAt: fetchedAt.toISOString(),
        validUntil: validUntil.toISOString(),
        claim,
        value,
        field,
        subjectRef: stored.id,
        provenanceRef: stored.offer_url,
      });
    };

    const price = Number(stored.price);
    addEvidence("currency", stored.currency.trim(), `Channel3 reported offer currency ${stored.currency.trim()}.`);
    addEvidence("attributes.itemPrice", price, `Channel3 item price ${price.toFixed(2)} ${stored.currency.trim()}; shipping and tax are not included unless independently verified.`);
    addEvidence("attributes.availability", stored.availability, `Channel3 reported availability ${stored.availability ?? "unknown"}.`);
    addEvidence("attributes.condition", stored.condition, `Channel3 reported item condition ${stored.condition ?? "unknown"}.`);
    addEvidence("attributes.brand", stored.brand, `Channel3 product brand ${stored.brand ?? "unknown"}.`);
    const ramGb = stored.ram_gb === null ? null : Number(stored.ram_gb);
    addEvidence("attributes.ramGb", ramGb, `Channel3 structured RAM attribute ${ramGb ?? "unknown"} GB.`);

    const offer: OfferSnapshot = {
      id: stored.id,
      currency: stored.currency.trim(),
      // Critical: catalog item price is NOT treated as a fully landed checkout total.
      total: null,
      shippingFee: null,
      deliveryDate: null,
      returnWindowDays: null,
      attributes: {
        itemPrice: Number.isFinite(price) ? price : undefined,
        availability: stored.availability,
        condition: stored.condition,
        brand: stored.brand,
        ramGb: Number.isFinite(ramGb ?? NaN) ? ramGb : undefined,
      },
      evidence,
    };



    const verification = evaluatePact(pact, offer, { securityClear: true, now });
    const summary = summarizeVerification(verification);
    const runId = randomUUID();
    await recordPolicyRun({
      id: runId,
      scenarioId: "channel3_live_offer",
      pactId: pact.id,
      decision: summary.decision,
      decisionReason: summary.reason,
      securityClear: verification.securityClear,
      evidenceFresh: verification.evidenceFresh,
      evidenceAttributable: verification.evidenceAttributable,
      offerSnapshot: offer as unknown as Record<string, unknown>,
      verificationResult: verification as unknown as Record<string, unknown>,
      // Persist the exact user-reviewed Pact alongside the result so the policy
      // run hash covers the rules actually used for this evaluation.
      pactSnapshot: pact as unknown as Record<string, unknown>,
    });

    const evidenceMissing = verification.results
      .filter((item) => (item.severity ?? "hard") === "hard" && item.status === "unknown")
      .map((item) => ({ constraintId: item.constraintId, reason: item.reason }));

    return NextResponse.json({
      runId,
      source: "CHANNEL3_LIVE_SNAPSHOT",
      scenario: { id: "channel3_live_offer", title: "Live Channel3 offer", description: "Evaluate only fields present in the server-stored Channel3 snapshot against the user-approved Purchase Pact; missing fulfillment facts fail closed." },
      pact,
      offer: {
        id: stored.id,
        productId: stored.product_id,
        title: stored.product_title,
        brand: stored.brand,
        imageUrl: stored.image_url,
        domain: stored.offer_domain,
        url: stored.offer_url,
        itemPrice: price,
        currency: stored.currency.trim(),
        availability: stored.availability,
        condition: stored.condition,
        ramGb,
        fetchedAt: stored.fetched_at,
        validUntil: stored.valid_until,
        itemPriceOnly: true,
      },
      verification,
      summary,
      missingHardEvidence: evidenceMissing,
      paymentAction: "NONE",
      capturePerformedByPactPay: false,
      note: `Policy evaluation only. No PayPal endpoint is called. Channel3 search provides catalog offer data, but this result does not establish landed total, shipping, delivery date, or return terms. PactPay will block settlement while required hard evidence is absent or stale. Evidence TTL is ${EVIDENCE_TTL_MS / 1000}s under PactPay's local policy. A clear security gate here means no local security finding was supplied; it is not an autonomous prompt-injection detector.`,
    });
  } catch (error) {
    console.error("Live Channel3 offer evaluation failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "The offer could not be evaluated or the result could not be persisted." }, { status: 500 });
  }
}
