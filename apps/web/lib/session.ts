import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { resolveLoginSession, type AuthUser } from "../../../lib/auth";

/**
 * Who is calling?
 *
 *  1. A signed-in account (cookie `pp_auth`, an opaque token whose hash is stored server-side). Everything the
 *     account does is stored under its private scope id, so its data follows it across browsers.
 *  2. The app's own gateway talking to itself (header `x-pactpay-internal`, a per-process secret), acting for
 *     an agent key's owner.
 *  3. A guest browser (cookie `pp_sid`), only when PACTPAY_REQUIRE_LOGIN is not "1". Handy for local
 *     development. Hosted deployments set PACTPAY_REQUIRE_LOGIN=1, which disables guests.
 *
 * "session id" everywhere else in the app means the scope id resolved here.
 */
export const SESSION_COOKIE = "pp_sid";
export const AUTH_COOKIE = "pp_auth";
const SESSION_PATTERN = /^[0-9a-f]{64}$/;
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

declare global {
  // eslint-disable-next-line no-var
  var pactPayInternalToken: string | undefined;
}

export function loginRequired(): boolean {
  return process.env.PACTPAY_REQUIRE_LOGIN === "1";
}

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_PATTERN.test(value);
}

/** Per-process secret that lets the gateway call the app's own routes on behalf of an agent key. Never leaves the server. */
export function internalToken(): string {
  global.pactPayInternalToken ??= randomBytes(32).toString("hex");
  return global.pactPayInternalToken;
}

async function isInternalCall(): Promise<boolean> {
  const presented = (await headers()).get("x-pactpay-internal");
  if (!presented) return false;
  const expected = internalToken();
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function readAuthUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  return token ? resolveLoginSession(token) : null;
}

/** Returns the caller's data scope, or null if they have none. Never creates one. */
export async function readSessionId(): Promise<string | null> {
  const legacy = (await cookies()).get(SESSION_COOKIE)?.value;
  if (isSessionId(legacy) && (await isInternalCall())) return legacy;
  const user = await readAuthUser();
  if (user) return user.scopeId;
  if (loginRequired()) return null;
  return isSessionId(legacy) ? legacy : null;
}

/**
 * Returns the caller's data scope, creating a guest cookie when guests are allowed. Returns null when login is
 * required and the caller isn't signed in. Route handlers only.
 */
export async function ensureSessionId(): Promise<string | null> {
  const existing = await readSessionId();
  if (existing) return existing;
  if (loginRequired()) return null;
  const created = randomBytes(32).toString("hex");
  const store = await cookies();
  // Mark the cookie Secure only when the browser actually reached us over HTTPS (hosted deployments set
  // x-forwarded-proto). Forcing it on plain http://localhost would make Safari drop the cookie.
  const forwardedProto = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  store.set(SESSION_COOKIE, created, {
    httpOnly: true,
    sameSite: "lax",
    secure: forwardedProto === "https" || process.env.PACTPAY_COOKIE_SECURE === "1",
    path: "/",
    maxAge: THIRTY_DAYS_SECONDS,
  });
  return created;
}

/** For routes that cost money or touch data: returns a 401 response when login is required and the caller isn't signed in. */
export async function requireLogin(): Promise<NextResponse | null> {
  if (!loginRequired()) return null;
  if ((await isInternalCall()) || (await readAuthUser())) return null;
  return NextResponse.json({ error: "Sign in to use PactPay.", loginRequired: true }, { status: 401 });
}
