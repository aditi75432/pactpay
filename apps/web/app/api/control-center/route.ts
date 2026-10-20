import { NextResponse } from "next/server";
import { listRecentPolicyRunDetails, listRecentTransactions } from "../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only operational view. This endpoint never changes a payment or a policy run. */
export async function GET() {
  try {
    const [transactions, policyRuns] = await Promise.all([
      listRecentTransactions(100),
      listRecentPolicyRunDetails(100),
    ]);
    return NextResponse.json({
      transactions,
      policyRuns,
      generatedAt: new Date().toISOString(),
      paymentAction: "NONE",
      capturePerformedByPactPay: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("PactPay Control Center read failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Unable to load Control Center data. Check that PostgreSQL is running and the database is reachable." }, { status: 500 });
  }
}
