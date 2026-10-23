import { NextResponse } from "next/server";
import { listRecentPolicyRunDetails, listRecentTransactions } from "../../../../../lib/db";
import { getSessionScope } from "../../../../../lib/pact-approvals";
import { describeAutonomy } from "@pactpay/pact-core/autonomy";
import { getActivityContexts, type ActivityContextRow } from "../../../../../lib/activity";
import { readSessionId } from "../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


const REVIEW_STATES = ["CAPTURE_REVIEW", "VOID_REVIEW", "AUTHORIZATION_REVIEW", "FAILED"];

function enrich<T extends { transaction_id: string; status: string; amount: string; currency: string; capture_status: string | null; created_at: string; pact_hash: string | null }>(
  rows: T[], contexts: Map<string, ActivityContextRow>,
) {
  // Attempt number = order of this hold among the holds made under the same approved rules.
  const attemptByTx = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const row of [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    const key = (row.pact_hash ?? row.transaction_id).trim().toLowerCase();
    const next = (seen.get(key) ?? 0) + 1;
    seen.set(key, next);
    attemptByTx.set(row.transaction_id, next);
  }
  return rows.map((row) => {
    const ctx = contexts.get(row.transaction_id);
    const verification = ctx?.gate_verification?.verification;
    const failed = (verification?.results ?? [])
      .filter((item) => item.status !== "pass" && (item.severity ?? "hard") === "hard" && !item.constraintId.startsWith("system."))
      .map((item) => ctx?.pact_json?.constraints?.find((rule) => rule.id === item.constraintId)?.description ?? item.constraintId);
    const captured = row.status === "CAPTURED" && row.capture_status === "COMPLETED" ? Number(row.amount).toFixed(2) : "0.00";
    const outcome = row.status === "CAPTURED" ? `Captured ${row.currency.trim()} ${captured}`
      : ["VOIDED", "VOIDING", "POLICY_BLOCKED"].includes(row.status) ? "Voided · nothing captured"
      : row.status === "AUTHORIZED" ? "On hold · nothing captured"
      : REVIEW_STATES.includes(row.status) ? "Needs review" : row.status;
    return {
      ...row,
      attempt_no: attemptByTx.get(row.transaction_id) ?? 1,
      offer_title: ctx?.title ?? null,
      offer_domain: ctx?.domain ?? null,
      injected_change: ctx?.scenario_id && ctx.scenario_id !== "BASELINE" ? ctx.scenario_id.toLowerCase().replace(/_/g, " ") : null,
      failed_rules: failed.length ? failed.join(" · ").slice(0, 160) : null,
      evidence_state: verification === undefined ? "NOT CHECKED" : verification.evidenceFresh === false || verification.evidenceAttributable === false ? "STALE / UNVERIFIED" : "FRESH",
      captured_amount: captured,
      outcome,
    };
  });
}

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
    const contexts = await getActivityContexts(transactions.map((tx) => tx.transaction_id));
    if (showAll) {
      return NextResponse.json({
        transactions: enrich(transactions, contexts), policyRuns, scope: "all", generatedAt: new Date().toISOString(),
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
      transactions: enrich(scopedTransactions, contexts),
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
