import { NextResponse } from "next/server";
import { createRateLimiter, type RateLimiter } from "@pactpay/pact-core/rate-limit";

declare global {
  // Keeps limiter state across Next.js development hot reloads.
  // eslint-disable-next-line no-var
  var pactPayRateLimiters: Map<string, RateLimiter> | undefined;
}

function limiterFor(name: string, limit: number, windowMs: number): RateLimiter {
  global.pactPayRateLimiters ??= new Map();
  let limiter = global.pactPayRateLimiters.get(name);
  if (!limiter) {
    limiter = createRateLimiter({ limit, windowMs });
    global.pactPayRateLimiters.set(name, limiter);
  }
  return limiter;
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "local";
}

/**
 * Returns a 429 response when the caller exceeded the named limit, otherwise null.
 * Set PACTPAY_RATE_LIMIT_DISABLED=1 to turn limits off (for example in load-free local demos).
 */
export function enforceRateLimit(
  request: Request,
  name: string,
  limit: number,
  windowMs: number,
  extraKey?: string,
): NextResponse | null {
  if (process.env.PACTPAY_RATE_LIMIT_DISABLED === "1") return null;
  const decision = limiterFor(name, limit, windowMs).check(`${clientKey(request)}|${extraKey ?? ""}`);
  if (decision.allowed) return null;
  return NextResponse.json(
    { error: `Too many requests. Please wait ${decision.retryAfterSec} seconds and try again.` },
    { status: 429, headers: { "Retry-After": String(decision.retryAfterSec) } },
  );
}
