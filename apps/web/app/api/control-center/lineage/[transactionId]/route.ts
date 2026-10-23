import { NextResponse } from "next/server";
import { getAuditEvents } from "../../../../../../../lib/db";
import { getTransactionPactHash } from "../../../../../../../lib/activity";
import { getSessionScope } from "../../../../../../../lib/pact-approvals";
import { readSessionId } from "../../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeDetails(details: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(details)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .filter(([key]) => !/secret|token|password|authorization_header/i.test(key))
    .slice(0, 8)
    .map(([key, value]) => [key, String(value).slice(0, 140)]);
}

/** The hash-chained event history for one transaction. Read-only, and limited to this session's own activity. */
export async function GET(_request: Request, context: { params: Promise<{ transactionId: string }> }) {
  try {
    const { transactionId } = await context.params;
    const pactHash = await getTransactionPactHash(transactionId);
    if (!pactHash) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    if (process.env.PACTPAY_CONTROL_CENTER_SCOPE !== "all") {
      const sessionId = await readSessionId();
      const scope = sessionId ? await getSessionScope(sessionId) : null;
      if (!scope || !scope.pactHashes.has(pactHash)) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    }
    const events = await getAuditEvents(transactionId);
    return NextResponse.json({
      events: events.map((event) => ({ id: event.id, type: event.event_type, actor: event.actor, at: event.created_at, hash: event.event_hash.slice(0, 12), details: safeDetails(event.details) })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Lineage read failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Couldn't load the event lineage." }, { status: 500 });
  }
}
