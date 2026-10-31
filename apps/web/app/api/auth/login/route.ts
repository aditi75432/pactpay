import { NextResponse } from "next/server";
import { normalizeUsername } from "@pactpay/pact-core/password";
import { createLoginSession, verifyLogin } from "../../../../../../lib/auth";
import { setAuthCookie, isHttps } from "../../../../lib/auth-cookie";
import { enforceRateLimit } from "../../../../lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const username = normalizeUsername(record.username);
  const limited = enforceRateLimit(request, "auth-login", 10, 10 * 60_000, username ?? "");
  if (limited) return limited;
  const password = typeof record.password === "string" ? record.password.slice(0, 128) : "";
  const generic = NextResponse.json({ error: "That username and password don't match." }, { status: 401 });
  if (!username || !password) return generic;
  try {
    const user = await verifyLogin(username, password);
    if (!user) return generic;
    const session = await createLoginSession(user.userId);
    const response = NextResponse.json({ username: user.username }, { headers: { "Cache-Control": "no-store" } });
    setAuthCookie(response, session.token, session.expiresAt, isHttps(request));
    return response;
  } catch (error) {
    console.error("Login failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "We couldn't sign you in. Please try again." }, { status: 500 });
  }
}
