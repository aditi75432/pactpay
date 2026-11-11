import { createGuardDevice } from "../../../../../../lib/guard-devices";
import { corsJson, corsPreflight } from "../../../../lib/cors";
import { enforceRateLimit } from "../../../../lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * First run of the extension: register this install and get a device token (shown once). The device gets its own
 * private data scope, so the extension works with no web login. It can draft and approve rules, hold agent keys
 * and store its Guard checks. It cannot see any web account's data unless the shopper links it with a one-time code.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "guard-device", 10, 60 * 60_000);
  if (limited) { limited.headers.set("Access-Control-Allow-Origin", "*"); return limited; }
  try {
    const { token } = await createGuardDevice();
    return corsJson({ token });
  } catch (error) {
    console.error("Guard device registration failed", error instanceof Error ? error.message : "unknown error");
    return corsJson({ error: "Couldn't register this extension. Check that the PactPay server and its database are running." }, 500);
  }
}
