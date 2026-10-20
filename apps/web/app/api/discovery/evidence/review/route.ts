import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ensureEvidenceSchema, isUuid, recordOfferEvidenceReview } from "../../../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.snapshotId !== "string" || !isUuid(body.snapshotId) ||
      typeof body.evidenceId !== "string" || !isUuid(body.evidenceId)) {
    return NextResponse.json({ error: "snapshotId and evidenceId must be valid IDs." }, { status: 400 });
  }
  if (body.decision !== "HUMAN_REVIEWED" && body.decision !== "REJECTED") {
    return NextResponse.json({ error: "decision must be HUMAN_REVIEWED or REJECTED." }, { status: 400 });
  }
  if (body.decision === "HUMAN_REVIEWED" && body.sourceInspected !== true) {
    return NextResponse.json({ error: "Confirm that you opened the merchant source and checked the exact claim before marking it human-reviewed." }, { status: 400 });
  }
  const reviewNote = typeof body.reviewNote === "string" ? body.reviewNote.trim() : "";
  if (reviewNote.length > 500) return NextResponse.json({ error: "Review note must be 500 characters or fewer." }, { status: 400 });

  try {
    await ensureEvidenceSchema();
    const recorded = await recordOfferEvidenceReview({
      id: randomUUID(),
      evidenceId: body.evidenceId,
      snapshotId: body.snapshotId,
      decision: body.decision,
      reviewerLabel: "local_demo_user",
      sourceInspected: body.decision === "HUMAN_REVIEWED" && body.sourceInspected === true,
      reviewNote: reviewNote || null,
    });
    if (!recorded) return NextResponse.json({ error: "Evidence does not belong to the selected offer snapshot." }, { status: 404 });
    return NextResponse.json({
      evidenceId: body.evidenceId,
      reviewStatus: body.decision,
      reviewRecorded: true,
      paymentAction: "NONE",
      capturePerformedByPactPay: false,
      note: "This local demo records a human attestation only. PactPay does not authenticate reviewer identity or independently fetch the merchant page. Do not expose this endpoint publicly without authentication and authorization.",
    });
  } catch (error) {
    console.error("Could not record evidence review", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Evidence review could not be recorded." }, { status: 500 });
  }
}
