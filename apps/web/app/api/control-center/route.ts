import { NextResponse } from "next/server";
import { listRecentPolicyRunDetails, listRecentTransactions } from "../../../../../lib/db";
import { getSessionScope } from "../../../../../lib/pact-approvals";
import { describeAutonomy } from "@pactpay/pact-core/autonomy";
import { readSessionId } from "../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only operational view. This endpoint never changes a payment or a policy run.
 *
 * By default it only returns activity from Pacts approved in the caller's own browser session, so a
 * public deployment never exposes other visitors' payments. Set PACTPAY_CONTROL_CENTER_SCOPE=all to
 * show everything (local development or a private operator deployment).
 */
export async function GET() {
  try {
    const showAll = process.env.PACTPAY_CONTROL_CENTER_SCOPE === "all";
    const [transactions, policyRuns] = await Promise.all([
      listRecentTransactions(100),
      listRecentPolicyRunDetails(100),
    ]);
    if (showAll) {
      return NextResponse.json({
        transactions, policyRuns, scope: "all", generatedAt: new Date().toISOString(),
        paymentAction: "NONE", capturePerformedByPactPay: false,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const sessionId = await readSessionId();
    const scope = sessionId ? await getSessionScope(sessionId) : { pactIds: new Set<string>(), pactHashes: new Set<string>(), autonomyByHash: new Map<string, import("@pactpay/pact-core/autonomy").Autonomy>() };
    const scopedTransactions = transactions
      .filter((tx) => tx.pact_hash && scope.pactHashes.has(tx.pact_hash.trim().toLowerCase()))
      .map((tx) => {
        const autonomy = scope.autonomyByHash.get((tx.pact_hash ?? "").trim().toLowerCase());
        return { ...tx, autonomy_label: autonomy ? (autonomy.mode === "WITHIN_RULES" ? "Handles it within rules" : describeAutonomy(autonomy).title) : null };
      });
    const scopedRuns = policyRuns.filter((run) => scope.pactIds.has(run.pact_id));
    return NextResponse.json({
      transactions: scopedTransactions,
      policyRuns: scopedRuns,
      scope: "session",
      generatedAt: new Date().toISOString(),
      paymentAction: "NONE",
      capturePerformedByPactPay: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("PactPay Control Center read failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Unable to load Control Center data. Check that PostgreSQL is running and the database is reachable." }, { status: 500 });
  }
}
