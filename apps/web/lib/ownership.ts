import { NextResponse } from "next/server";
import { getTransactionPactHash } from "../../../lib/activity";
import { getSessionScope } from "../../../lib/pact-approvals";
import { readSessionId } from "./session";

/**
 * A transaction belongs to whoever approved the Purchase Pact it is bound to. Every route that reads or changes a
 * transaction calls this first, so a leaked transaction id alone gives no access. Answers 404, not 403, so a
 * stranger can't tell whether an id exists. A transaction with no Pact binding (the legacy $1 test) is not
 * reachable unless the operator view (PACTPAY_CONTROL_CENTER_SCOPE=all) is on.
 */
export async function requireTransactionAccess(transactionId: string): Promise<NextResponse | null> {
  if (process.env.PACTPAY_CONTROL_CENTER_SCOPE === "all") return null;
  const notFound = NextResponse.json({ error: "Transaction not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const hash = await getTransactionPactHash(transactionId);
  if (!hash) return notFound;
  const sessionId = await readSessionId();
  if (!sessionId) return notFound;
  const scope = await getSessionScope(sessionId);
  return scope.pactHashes.has(hash) ? null : notFound;
}
