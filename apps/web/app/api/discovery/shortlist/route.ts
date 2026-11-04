import { NextResponse } from "next/server";
import { getPactApproval, isUuidLike } from "../../../../../../lib/pact-approvals";
import { enforceRateLimit } from "../../../../lib/request-guard";
import { readSessionId, requireLogin } from "../../../../lib/session";
import { runDeterministicShortlist } from "../../../../lib/deterministic-shortlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** First-party route: the browser and Muse UI share the same server-side rules pipeline as external agents. */
export async function POST(request: Request) {
  const denied = await requireLogin();
  if (denied) return denied;
  const limited = enforceRateLimit(request, "discovery-shortlist", 12, 10 * 60_000);
  if (limited) return limited;
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return NextResponse.json({ error: "Send {approvalId, query}." }, { status: 400 });
  const record = body as Record<string, unknown>;
  const sessionId = await readSessionId();
  if (!sessionId || !isUuidLike(record.approvalId)) return NextResponse.json({ error: "Approve your Purchase Pact first." }, { status: 403 });
  const approval = await getPactApproval(sessionId, record.approvalId);
  if (!approval) return NextResponse.json({ error: "That approved Purchase Pact was not found for this session." }, { status: 403 });
  const query = typeof record.query === "string" ? record.query.trim() : "";
  const result = await runDeterministicShortlist(request, { sessionId, approvalId: approval.id, approval }, query, { includeEvaluation: true });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
