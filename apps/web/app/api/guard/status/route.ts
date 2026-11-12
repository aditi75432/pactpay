import { parseBearerKey } from "@pactpay/pact-core/agent-key";
import { inspectionRulesFor } from "@pactpay/pact-core/checkout-inspection";
import { resolveVisionProvider } from "../../../../../../lib/llm-provider";
import { resolveAgentKey } from "../../../../../../lib/agent-keys";
import { getPactApproval } from "../../../../../../lib/pact-approvals";
import { resolveGuardDevice } from "../../../../../../lib/guard-devices";
import { corsJson, corsPreflight, DEVICE_HEADER } from "../../../../lib/cors";
import { enforceRateLimit } from "../../../../lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/** The extension popup calls this to show "connected to <rules>" and whether the AI screenshot cross-check is available. */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, "guard-status", 120, 10 * 60_000);
  if (limited) { limited.headers.set("Access-Control-Allow-Origin", "*"); return limited; }
  const vision = resolveVisionProvider() !== null;
  const deviceToken = request.headers.get(DEVICE_HEADER);
  let linked = false;
  if (deviceToken) {
    try { linked = (await resolveGuardDevice(deviceToken))?.linked ?? false; } catch { /* status still answers without the device */ }
  }
  const key = parseBearerKey(request.headers.get("authorization"));
  if (!key) return corsJson({ ok: true, connected: false, mode: "quick", vision, linked, service: "pactpay-guard" });
  const resolved = await resolveAgentKey(key);
  if (!resolved) return corsJson({ ok: false, connected: false, error: "This key is invalid, expired or revoked." }, 401);
  const approval = await getPactApproval(resolved.sessionId, resolved.approvalId);
  if (!approval) return corsJson({ ok: false, connected: false, error: "The rules for this key are no longer valid." }, 401);
  return corsJson({
    ok: true, connected: true, mode: "pact", vision, linked,
    rulesTitle: approval.original_intent?.slice(0, 120) || "Your approved Purchase Pact",
    rules: inspectionRulesFor(approval.pact_json).map((rule) => ({ id: rule.id, label: rule.label, hard: rule.hard })),
    service: "pactpay-guard",
  });
}
