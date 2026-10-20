import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createDemoScenario, isDemoScenarioId } from "@pactpay/pact-core/demo-scenarios";
import { evaluatePact, summarizeVerification } from "@pactpay/pact-core/policy";
import { recordPolicyRun } from "../../../../../../lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const scenarioId = (body as { scenarioId?: unknown } | null)?.scenarioId;
  if (!isDemoScenarioId(scenarioId)) {
    return NextResponse.json({
      error: "scenarioId must be one of the server-defined Policy Lab scenarios.",
    }, { status: 400 });
  }

  try {
    const now = new Date();
    const scenario = createDemoScenario(scenarioId, now);
    const verification = evaluatePact(scenario.pact, scenario.offer, {
      securityClear: scenario.securityClear,
      now,
    });
    const summary = summarizeVerification(verification);
    const runId = randomUUID();

    await recordPolicyRun({
      id: runId,
      scenarioId: scenario.id,
      pactId: scenario.pact.id,
      decision: summary.decision,
      decisionReason: summary.reason,
      securityClear: verification.securityClear,
      evidenceFresh: verification.evidenceFresh,
      evidenceAttributable: verification.evidenceAttributable,
      offerSnapshot: scenario.offer as unknown as Record<string, unknown>,
      verificationResult: verification as unknown as Record<string, unknown>,
      pactSnapshot: scenario.pact as unknown as Record<string, unknown>,
    });

    return NextResponse.json({
      runId,
      scenario: {
        id: scenario.id,
        title: scenario.title,
        description: scenario.description,
        ...(scenario.securityNote ? { securityNote: scenario.securityNote } : {}),
      },
      pact: scenario.pact,
      offer: scenario.offer,
      verification,
      summary,
      mode: "DETERMINISTIC_SIMULATOR",
      paymentAction: "NONE",
      capturePerformedByPactPay: false,
      note: "This result is a policy evaluation only. It does not authorize, capture, void, or otherwise change a PayPal transaction.",
    });
  } catch (error) {
    console.error("PactPay policy evaluation failed", error);
    return NextResponse.json({ error: "Policy evaluation could not be completed or saved." }, { status: 500 });
  }
}
