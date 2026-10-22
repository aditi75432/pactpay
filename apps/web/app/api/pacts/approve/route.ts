import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { PurchasePact } from "@pactpay/pact-core";
import { createPactApproval } from "../../../../../../lib/pact-approvals";
import { sanitizePurchasePact } from "../../../../../../lib/intent-pact";
import { enforceRateLimit } from "../../../../lib/request-guard";
import { ensureSessionId } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\u0000-\u001f]/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * The user clicked "Approve". The Pact is validated, given a fixed authority envelope (nobody,
 * including the AI, may capture money or change hard rules), stored server-side and bound to this
 * browser session. Only the returned approvalId is accepted by order-creating routes afterwards.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "pact-approve", 20, 10 * 60_000);
  if (limited) return limited;
  try {
    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body) || body.userApproved !== true) {
      return NextResponse.json({ error: "Review your rules and approve them explicitly to continue." }, { status: 400 });
    }
    let sanitized: PurchasePact;
    try {
      sanitized = sanitizePurchasePact(body.pact);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "The Purchase Pact failed validation." }, { status: 400 });
    }
    if (!sanitized.constraints.some((rule) => rule.severity === "hard")) {
      return NextResponse.json({ error: "Add at least one must-have (hard) rule before approving. Without one, PactPay can never release payment." }, { status: 422 });
    }
    const sessionId = await ensureSessionId();
    const approvalId = randomUUID();
    // Every approval gets its own Pact id. Two approvals can never share an id or a hash, so the
    // Control Center's per-session scoping cannot be crossed by submitting an identical Pact.
    const pact: PurchasePact = {
      ...sanitized,
      id: `${sanitized.id.slice(0, 55)}:${approvalId}`,
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
    const stored = await createPactApproval({
      id: approvalId,
      sessionId,
      pact,
      originalIntent: shortText(body.originalIntent, 1200),
      compiler: shortText(body.compiler, 40),
    });
    return NextResponse.json({ approvalId: stored.id, pactHash: stored.pactHash, pact }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Pact approval failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "We couldn't save your approval. Check that the database is running and try again." }, { status: 500 });
  }
}
