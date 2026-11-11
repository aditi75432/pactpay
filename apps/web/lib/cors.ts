import { NextResponse } from "next/server";

/**
 * CORS for the PactPay Guard extension endpoints.
 *
 * These endpoints authenticate with a Bearer agent key (or take a budget and run no model), never a browser cookie,
 * so allowing any origin does not expose a signed-in shopper to cross-site requests. The extension calls them from
 * its background worker, where CORS does not apply, but we answer preflights anyway so a page-context caller works too.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Guard-Device",
  "Access-Control-Max-Age": "86400",
};

export function withCors(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function corsJson(body: unknown, status = 200): NextResponse {
  return withCors(NextResponse.json(body, { status }));
}

/** Extension device header. Kept separate from Authorization, which carries an approved-rules agent key. */
export const DEVICE_HEADER = "x-guard-device";
