import { NextResponse } from "next/server";
import { getTransactionById, isUuid, markTransactionCancelled } from "../../../../../../../../lib/db";
import { requireTransactionAccess } from "../../../../../../lib/ownership";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ transactionId: string }> }) {
  try {
    const { transactionId } = await context.params;
    if (!isUuid(transactionId)) return NextResponse.json({ error: "Invalid transaction ID" }, { status: 400 });
    const accessDenied = await requireTransactionAccess(transactionId);
    if (accessDenied) return accessDenied;
    const tx = await getTransactionById(transactionId);
    if (!tx) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    await markTransactionCancelled(transactionId);
    const updated = await getTransactionById(transactionId);
    return NextResponse.json({ transactionId, status: updated?.status ?? tx.status });
  } catch (error) {
    console.error("PactPay checkout cancellation failed", error);
    return NextResponse.json({ error: "Unable to record checkout cancellation" }, { status: 500 });
  }
}
