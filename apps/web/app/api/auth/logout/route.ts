import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteLoginSession } from "../../../../../../lib/auth";
import { clearAuthCookie } from "../../../../lib/auth-cookie";
import { AUTH_COOKIE } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (token) await deleteLoginSession(token).catch(() => undefined);
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  clearAuthCookie(response);
  return response;
}
