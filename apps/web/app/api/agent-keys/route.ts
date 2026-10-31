import { NextResponse } from "next/server";
import { getAgentKeyStatus, issueAgentKey, revokeAgentKeys } from "../../../../../lib/agent-keys";
import { getPactApproval, isUuidLike } from "../../../../../lib/pact-approvals";
import { enforceRateLimit } from "../../../lib/request-guard";
import { readSessionId } from "../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function owned(approvalId: unknown): Promise<{ sessionId: string; approvalId: string } | NextResponse> {
  const sessionId = await readSessionId();
  if (!sessionId || !isUuidLike(approvalId)) return NextResponse.json({ error: "Approve your rules first." }, { status: 403 });
  const approval = await getPactApproval(sessionId, approvalId);
  if (!approval) return NextResponse.json({ error: "That approval isn't yours or no longer verifies." }, { status: 403 });
  return { sessionId, approvalId };
}

/** The shopper creates a key for software acting for them. The key is shown once and is bound to this approval. */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "agent-key-issue", 10, 10 * 60_000);
  if (limited) return limited;
  const body: unknown = await request.json().catch(() => null);
  const who = await owned(isRecord(body) ? body.approvalId : null);
  if (who instanceof NextResponse) return who;
  try {
    const issued = await issueAgentKey(who.sessionId, who.approvalId);
    return NextResponse.json({ key: issued.key, expiresAt: issued.expiresAt, approvalId: who.approvalId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Agent key issue failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Couldn't create an agent key." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const who = await owned(isRecord(body) ? body.approvalId : null);
  if (who instanceof NextResponse) return who;
  const revoked = await revokeAgentKeys(who.sessionId, who.approvalId);
  return NextResponse.json({ revoked }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const who = await owned(new URL(request.url).searchParams.get("approvalId"));
  if (who instanceof NextResponse) return who;
  return NextResponse.json(await getAgentKeyStatus(who.sessionId, who.approvalId), { headers: { "Cache-Control": "no-store" } });
}
