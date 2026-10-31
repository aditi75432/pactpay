import type { NextResponse } from "next/server";
import { AUTH_COOKIE } from "./session";

export function setAuthCookie(response: NextResponse, token: string, expiresAt: Date, secure: boolean) {
  response.cookies.set(AUTH_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", expires: expiresAt });
}
export function clearAuthCookie(response: NextResponse) {
  response.cookies.set(AUTH_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}
export function isHttps(request: Request): boolean {
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https" || process.env.PACTPAY_COOKIE_SECURE === "1";
}
