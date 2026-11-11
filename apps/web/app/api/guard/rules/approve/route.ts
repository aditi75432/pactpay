import { inspectionRulesFor } from "@pactpay/pact-core/checkout-inspection";
import type { PurchasePact } from "@pactpay/pact-core";
import { issueAgentKey } from "../../../../../../../lib/agent-keys";
import { resolveGuardDevice } from "../../../../../../../lib/guard-devices";
import { corsJson, corsPreflight, DEVICE_HEADER } from "../../../../../lib/cors";
import { guardInternalCall } from "../../../../../lib/guard-internal";
import { enforceRateLimit } from "../../../../../lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * The extension's "set my rules" step 2: the shopper pressed Approve. We run the SAME approval the web app runs
 * (server-side validation, fixed authority envelope: no one, including an AI, may capture money or change hard
 * rules), then issue the agent key that Guard uses. One call, one explicit click, and the extension is independent.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "guard-rules-approve", 20, 10 * 60_000);
  if (limited) { limited.headers.set("Access-Control-Allow-Origin", "*"); return limited; }
  const device = await resolveGuardDevice(request.headers.get(DEVICE_HEADER));
  if (!device) return corsJson({ error: "This extension isn't registered yet. Reload the page and try again." }, 401);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || (body as { userApproved?: unknown }).userApproved !== true) {
    return corsJson({ error: "Review your rules and approve them explicitly to continue." }, 400);
  }
  const { pact, originalIntent, compiler } = body as { pact?: unknown; originalIntent?: unknown; compiler?: unknown };
  const approved = await guardInternalCall(request, device.sessionId, "/api/pacts/approve", { userApproved: true, pact, originalIntent, compiler });
  if (approved.status !== 200 || typeof approved.json.approvalId !== "string") {
    return corsJson({ error: typeof approved.json.error === "string" ? approved.json.error : "Couldn't approve these rules." }, approved.status >= 400 && approved.status < 500 ? approved.status : 500);
  }
  try {
    const issued = await issueAgentKey(device.sessionId, approved.json.approvalId);
    let rules: Array<{ id: string; label: string; hard: boolean }> = [];
    try { rules = inspectionRulesFor(approved.json.pact as PurchasePact).map((rule) => ({ id: rule.id, label: rule.label, hard: rule.hard })); } catch { /* shown without a rule list */ }
    return corsJson({
      key: issued.key, expiresAt: issued.expiresAt, approvalId: approved.json.approvalId,
      title: typeof originalIntent === "string" ? originalIntent.replace(/\s+/g, " ").trim().slice(0, 120) : "Your approved Purchase Pact",
      rules,
    });
  } catch (error) {
    console.error("Guard key issue failed", error instanceof Error ? error.message : "unknown error");
    return corsJson({ error: "Your rules were approved but the key couldn't be created. Try again." }, 500);
  }
}
