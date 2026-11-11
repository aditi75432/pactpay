import { redeemLinkCode, resolveGuardDevice } from "../../../../../../../lib/guard-devices";
import { corsJson, corsPreflight, DEVICE_HEADER } from "../../../../../lib/cors";
import { enforceRateLimit } from "../../../../../lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/** The extension redeems a one-time link code from a signed-in web user. Afterwards both share one account scope. */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "guard-device-link", 10, 10 * 60_000);
  if (limited) { limited.headers.set("Access-Control-Allow-Origin", "*"); return limited; }
  const token = request.headers.get(DEVICE_HEADER);
  const device = await resolveGuardDevice(token);
  if (!device || !token) return corsJson({ error: "This extension isn't registered. Reload it and try again." }, 401);
  const body: unknown = await request.json().catch(() => null);
  const code = body && typeof body === "object" ? (body as { code?: unknown }).code : null;
  try {
    const ok = await redeemLinkCode(token, code);
    if (!ok) return corsJson({ error: "That code is wrong, expired or already used. Create a new one on the PactPay Extension page." }, 400);
    return corsJson({ linked: true });
  } catch (error) {
    console.error("Guard link failed", error instanceof Error ? error.message : "unknown error");
    return corsJson({ error: "Couldn't link right now. Try again." }, 500);
  }
}
