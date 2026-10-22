import { NextResponse } from "next/server";
import {
  applyChannel3BoundTestScenario,
  applyProtectedDemoScenario,
  PROTECTED_DEMO_SCENARIOS,
  type Channel3BoundTestOffer,
  type ProtectedDemoScenarioId,
} from "@pactpay/pact-core/settlement-demo";
import type { PurchasePact } from "@pactpay/pact-core";
import { getProtectedDemoContext, getTransactionById, isUuid, updateProtectedDemoScenario } from "../../../../../../../../lib/db";
import { enforceRateLimit } from "../../../../../../lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request, context: { params: Promise<{ transactionId: string }> }) {
  const rateLimited = enforceRateLimit(request, "scenario", 30, 10 * 60_000);
  if (rateLimited) return rateLimited;
  try {
    const { transactionId } = await context.params;
    if (!isUuid(transactionId)) return NextResponse.json({ error: "Invalid transaction ID." }, { status: 400 });
    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body) || typeof body.scenarioId !== "string" ||
        !PROTECTED_DEMO_SCENARIOS.some((scenario) => scenario.id === body.scenarioId)) {
      return NextResponse.json({ error: "A supported simulator scenarioId is required." }, { status: 400 });
    }
    const [tx, stored] = await Promise.all([getTransactionById(transactionId), getProtectedDemoContext(transactionId)]);
    if (!tx) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    if (tx.status !== "AUTHORIZED") {
      return NextResponse.json({ error: `Scenario can only change while AUTHORIZED; current state is ${tx.status}. Start a new Sandbox demo for another scenario.` }, { status: 409 });
    }
    if (!stored || stored.mode !== "DEMO_SIMULATOR") {
      return NextResponse.json({ error: "This transaction is not bound to a protected demo Purchase Pact." }, { status: 409 });
    }
    const scenarioId = body.scenarioId as ProtectedDemoScenarioId;
    const now = new Date();
    const baselineOffer = stored.baseline_offer as unknown as Record<string, unknown>;
    const mutation = baselineOffer.checkoutAdapter === "PACTPAY_CHANNEL3_TEST_CHECKOUT"
      ? applyChannel3BoundTestScenario(
          scenarioId,
          stored.baseline_offer as unknown as Channel3BoundTestOffer,
          stored.pact_json as unknown as PurchasePact,
          now,
        )
      : applyProtectedDemoScenario(transactionId, scenarioId, now, stored.baseline_offer as never);
    const updated = await updateProtectedDemoScenario({
      transactionId,
      expectedRevision: stored.revision,
      scenarioId,
      currentOffer: mutation.offer as unknown as Record<string, unknown>,
      securityFinding: mutation.securityFinding,
    });
    return NextResponse.json({
      transactionId,
      revision: updated.revision,
      scenarioId: updated.scenario_id,
      label: PROTECTED_DEMO_SCENARIOS.find((scenario) => scenario.id === scenarioId)?.label,
      currentOffer: updated.current_offer,
      securityFindingPresent: Boolean(updated.security_finding),
      gateDecision: updated.gate_decision,
      paymentAction: "NONE",
      capturePerformedByPactPay: false,
      simulatorOnly: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected scenario update failure.";
    console.error("Protected demo scenario update failed", message);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
