import { NextResponse } from "next/server";
import { describeAutonomy } from "@pactpay/pact-core/autonomy";
import { authenticateAgent } from "../../../../../lib/agent-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the shopper approved. Read-only: an agent can read its limits but there is no way to change them. */
export async function GET(request: Request) {
  const auth = await authenticateAgent(request);
  if (!auth.ok) return auth.response;
  const { approval } = auth.ctx;
  const pact = approval.pact_json;
  return NextResponse.json({
    approvalId: approval.id,
    pactHash: approval.pact_hash,
    currency: pact.currency,
    autonomy: { mode: approval.autonomy.mode, limitUsd: approval.autonomy.limitUsd, ...describeAutonomy(approval.autonomy) },
    rules: pact.constraints.map((rule) => ({ id: rule.id, severity: rule.severity, description: rule.description })),
    authority: pact.authority,
    notes: [
      "These rules are locked. There is no tool to change them.",
      "You can search, shortlist and ask for a PayPal hold. A human approves each hold on PayPal.",
      "Settlement is decided by a fixed gate that re-checks the live offer. You can request it; you cannot override it.",
    ],
  }, { headers: { "Cache-Control": "no-store" } });
}
