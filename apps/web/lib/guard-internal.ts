import { internalToken } from "./session";

/** Calls one of the app's own routes as a data scope, from inside the server (the same mechanism the agent gateway uses). */
export async function guardInternalCall(request: Request, sessionId: string, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const base = process.env.PACTPAY_INTERNAL_URL?.trim() || `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `pp_sid=${sessionId}`,
        "x-pactpay-internal": internalToken(),
        ...(forwarded ? { "x-forwarded-for": forwarded } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, json };
  } catch {
    return { status: 502, json: { error: "PactPay couldn't reach its own rules service. Try again." } };
  } finally {
    clearTimeout(timer);
  }
}
