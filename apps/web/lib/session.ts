import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";

/**
 * Anonymous per-browser session.
 *
 * PactPay is a prototype without user accounts. A random, unguessable, httpOnly cookie
 * identifies a browser so that a Purchase Pact approved here can only be used here, and so
 * the Control Center only lists this browser's own activity. The cookie is a bearer token:
 * it is not a substitute for real authentication in production.
 */
export const SESSION_COOKIE = "pp_sid";
const SESSION_PATTERN = /^[0-9a-f]{64}$/;
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_PATTERN.test(value);
}

/** Returns the caller's session id, or null when the browser has none yet. Never creates one. */
export async function readSessionId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  return isSessionId(value) ? value : null;
}

/** Returns the caller's session id, creating and setting the cookie if needed. Route handlers only. */
export async function ensureSessionId(): Promise<string> {
  const existing = await readSessionId();
  if (existing) return existing;
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
