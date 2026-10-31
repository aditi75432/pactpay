import { NextResponse } from "next/server";
import { normalizeUsername, validatePassword } from "@pactpay/pact-core/password";
import { createLoginSession, createUser } from "../../../../../../lib/auth";
import { setAuthCookie, isHttps } from "../../../../lib/auth-cookie";
import { enforceRateLimit } from "../../../../lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "auth-signup", 8, 10 * 60_000);
  if (limited) return limited;
  const body: unknown = await request.json().catch(() => null);
  const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const username = normalizeUsername(record.username);
  if (!username) return NextResponse.json({ error: "Choose a username of 3 to 32 characters: letters, numbers, dots, dashes or underscores." }, { status: 400 });
  const passwordProblem = validatePassword(record.password, username);
  if (passwordProblem) return NextResponse.json({ error: passwordProblem }, { status: 400 });
  try {
    const created = await createUser(username, record.password as string);
    if (!created.ok) return NextResponse.json({ error: "That username is taken. Try another, or sign in." }, { status: 409 });
    const session = await createLoginSession(created.userId);
    const response = NextResponse.json({ username }, { headers: { "Cache-Control": "no-store" } });
    setAuthCookie(response, session.token, session.expiresAt, isHttps(request));
    return response;
  } catch (error) {
    console.error("Signup failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "We couldn't create the account. Please try again." }, { status: 500 });
  }
}
