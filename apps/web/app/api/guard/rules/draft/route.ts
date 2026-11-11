import { inspectionRulesFor } from "@pactpay/pact-core/checkout-inspection";
import type { PurchasePact } from "@pactpay/pact-core";
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
 * The extension's "set my rules" step 1: turn plain words into a reviewable draft. This is the same compiler the web
 * app uses (AI when a model is configured, a transparent rule-based parser otherwise); the extension only adds a
 * list of which rules Guard can check on a checkout page. Nothing is approved here.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "guard-rules-draft", 15, 10 * 60_000);
  if (limited) { limited.headers.set("Access-Control-Allow-Origin", "*"); return limited; }
  const device = await resolveGuardDevice(request.headers.get(DEVICE_HEADER));
  if (!device) return corsJson({ error: "This extension isn't registered yet. Reload the page and try again." }, 401);
  const body: unknown = await request.json().catch(() => null);
  const intent = body && typeof body === "object" && typeof (body as { intent?: unknown }).intent === "string" ? (body as { intent: string }).intent.trim() : "";
  if (intent.length < 8 || intent.length > 1200) return corsJson({ error: "Describe what you're buying and your limits in 8 to 1,200 characters." }, 400);

  const result = await guardInternalCall(request, device.sessionId, "/api/intent/compile", { intent });
  if (result.status !== 200) return corsJson({ error: typeof result.json.error === "string" ? result.json.error : "Couldn't draft rules right now." }, result.status === 429 ? 429 : 422);
  let checkable: Array<{ id: string; label: string; hard: boolean }> = [];
  try {
    checkable = inspectionRulesFor(result.json.pact as PurchasePact).map((rule) => ({ id: rule.id, label: rule.label, hard: rule.hard }));
  } catch { /* the draft is still shown; Guard just can't list what it checks */ }
  return corsJson({ ...result.json, checkable });
}
