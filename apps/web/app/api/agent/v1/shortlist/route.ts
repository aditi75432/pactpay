import { NextResponse } from "next/server";
import { authenticateAgent, gatewayProblem } from "../../../../../lib/agent-gateway";
import { runDeterministicShortlist } from "../../../../../lib/deterministic-shortlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Agent-facing wrapper around the same deterministic shortlist used by the first-party UI. */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request);
  if (!auth.ok) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  const query = typeof body === "object" && body !== null && !Array.isArray(body) && typeof (body as { query?: unknown }).query === "string"
    ? (body as { query: string }).query.trim() : "";
  if (query.length < 2 || query.length > 180) return gatewayProblem(400, 'Send {"query": "what to look for"} (2 to 180 characters).');
  const result = await runDeterministicShortlist(request, auth.ctx, query);
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
