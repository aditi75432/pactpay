import { NextResponse } from "next/server";
import { listGuardChecks } from "../../../../../../lib/guard-checks";
import { readSessionId } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in shopper's own Guard checks (verdicts from the browser extension), for the Activity page. */
export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) return NextResponse.json({ checks: [] }, { headers: { "Cache-Control": "no-store" } });
  try {
    return NextResponse.json({ checks: await listGuardChecks(sessionId, 200) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Guard history failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Couldn't load Guard checks.", checks: [] }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
