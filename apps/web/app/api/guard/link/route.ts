import { NextResponse } from "next/server";
import { createLinkCode } from "../../../../../../lib/guard-devices";
import { enforceRateLimit } from "../../../../lib/request-guard";
import { ensureSessionId, requireLogin } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A signed-in (or, locally, guest) web user asks for a one-time code to link their extension to this account. */
export async function POST(request: Request) {
  const denied = await requireLogin();
  if (denied) return denied;
  const limited = enforceRateLimit(request, "guard-link-code", 10, 10 * 60_000);
  if (limited) return limited;
  const sessionId = await ensureSessionId();
  if (!sessionId) return NextResponse.json({ error: "Sign in to link the extension.", loginRequired: true }, { status: 401 });
  try {
    return NextResponse.json(await createLinkCode(sessionId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Guard link code failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Couldn't create a link code." }, { status: 500 });
  }
}
