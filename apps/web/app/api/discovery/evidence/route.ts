import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { validateMerchantEvidenceClaim } from "@pactpay/pact-core/merchant-evidence";
import { hashMerchantEvidence } from "../../../../../../lib/merchant-evidence-integrity";
import {
  ensureEvidenceSchema,
  getChannel3OfferSnapshot,
  isUuid,
  listOfferEvidence,
  storeOfferEvidence,
} from "../../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const snapshotId = url.searchParams.get("snapshotId") ?? "";
  if (!isUuid(snapshotId)) {
    return NextResponse.json({ error: "snapshotId must identify a server-stored offer snapshot." }, { status: 400 });
  }

  try {
    await ensureEvidenceSchema();
    const snapshot = await getChannel3OfferSnapshot(snapshotId);
    if (!snapshot) return NextResponse.json({ error: "Offer snapshot not found. Run a fresh Channel3 search." }, { status: 404 });
    const items = await listOfferEvidence(snapshotId);
    return NextResponse.json({
      snapshot: {
        id: snapshot.id,
        productId: snapshot.product_id,
        title: snapshot.product_title,
        brand: snapshot.brand,
        domain: snapshot.offer_domain,
        offerUrl: snapshot.offer_url,
        itemPrice: Number(snapshot.price),
        currency: snapshot.currency.trim(),
        fetchedAt: snapshot.fetched_at,
        validUntil: snapshot.valid_until,
        catalogFresh: Date.parse(snapshot.valid_until) > Date.now(),
      },
      items: items.map((item) => ({
        id: item.id,
        field: item.field,
        value: item.claim_value,
        sourceUrl: item.source_url,
        sourceDomain: item.source_domain,
        note: item.note,
        observedAt: item.observed_at,
        validUntil: item.valid_until,
        contentHash: item.content_hash,
        reviewStatus: item.review_status,
        reviewerLabel: item.reviewer_label,
        sourceInspected: item.source_inspected,
        reviewNote: item.review_note,
        reviewedAt: item.reviewed_at,
      })),
      policy: {
        paymentAction: "NONE",
        capturePerformedByPactPay: false,
        manuallySubmittedEvidenceIsNotIndependentlyAuthenticated: true,
        note: "PactPay validates field shape and binds each source URL to the selected merchant domain. It does not fetch or authenticate the page. Only claims explicitly human-reviewed after inspection are eligible for policy evaluation.",
      },
    });
  } catch (error) {
    console.error("Could not list merchant evidence", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Evidence could not be loaded from the local database." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!isRecord(body) || typeof body.snapshotId !== "string" || !isUuid(body.snapshotId)) {
    return NextResponse.json({ error: "snapshotId must identify a server-stored offer snapshot." }, { status: 400 });
  }

  try {
    const snapshot = await getChannel3OfferSnapshot(body.snapshotId);
    if (!snapshot) return NextResponse.json({ error: "Offer snapshot not found. Run a fresh Channel3 search." }, { status: 404 });

    const validated = validateMerchantEvidenceClaim({
      field: body.field,
      value: body.value,
      sourceUrl: body.sourceUrl,
      note: body.note,
    }, snapshot.offer_domain);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

    const observedAt = new Date();
    const validUntil = new Date(observedAt.getTime() + validated.claim.ttlMs);
    const id = randomUUID();
    const contentHash = hashMerchantEvidence({
      id,
      snapshotId: snapshot.id,
      field: validated.claim.field,
      value: validated.claim.value,
      sourceUrl: validated.claim.sourceUrl,
      sourceDomain: validated.claim.sourceDomain,
      note: validated.claim.note,
      observedAt: observedAt.toISOString(),
      validUntil: validUntil.toISOString(),
    });

    await storeOfferEvidence({
      id,
      snapshotId: snapshot.id,
      field: validated.claim.field,
      value: validated.claim.value,
      sourceUrl: validated.claim.sourceUrl,
      sourceDomain: validated.claim.sourceDomain,
      note: validated.claim.note,
      observedAt: observedAt.toISOString(),
      validUntil: validUntil.toISOString(),
      contentHash,
    });

    return NextResponse.json({
      item: {
        id,
        field: validated.claim.field,
        value: validated.claim.value,
        sourceUrl: validated.claim.sourceUrl,
        sourceDomain: validated.claim.sourceDomain,
        note: validated.claim.note,
        observedAt: observedAt.toISOString(),
        validUntil: validUntil.toISOString(),
        contentHash,
        reviewStatus: "SUBMITTED",
      },
      paymentAction: "NONE",
      capturePerformedByPactPay: false,
      note: "Evidence stored immutably as a submitted human claim. It is not used in policy evaluation until a reviewer records HUMAN_REVIEWED after opening the merchant source.",
    }, { status: 201 });
  } catch (error) {
    console.error("Could not store merchant evidence", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Evidence could not be stored." }, { status: 500 });
  }
}
