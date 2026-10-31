import { NextResponse } from "next/server";
import { parseBearerKey } from "@pactpay/pact-core/agent-key";
import { resolveAgentKey } from "../../../lib/agent-keys";
import { getPactApproval, type PactApprovalRow } from "../../../lib/pact-approvals";
import { enforceRateLimit } from "./request-guard";
import { internalToken } from "./session";

/**
 * The agent gateway. Software acting for a shopper authenticates with an agent key (never a browser cookie).
 * The key is bound to one approved Pact, and every gateway call is made as the "agent", so the autonomy
 * the shopper chose is enforced on the server. The gateway reuses the app's own routes for the real work,
 * so those routes' checks (approval binding, seller simulation, settlement gate) apply unchanged.
 */
export interface AgentContext {
  sessionId: string;
  approvalId: string;
  approval: PactApprovalRow;
}

function problem(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store", "WWW-Authenticate": status === 401 ? 'Bearer realm="pactpay-agent"' : "" } });
}

export async function authenticateAgent(request: Request): Promise<{ ok: true; ctx: AgentContext } | { ok: false; response: NextResponse }> {
  const key = parseBearerKey(request.headers.get("authorization"));
  if (!key) return { ok: false, response: problem(401, "Send your agent key as 'Authorization: Bearer ppk_...'.") };
  const limited = enforceRateLimit(request, "agent-gateway", 240, 10 * 60_000, key.slice(-8));
  if (limited) return { ok: false, response: limited };
  const resolved = await resolveAgentKey(key);
  if (!resolved) return { ok: false, response: problem(401, "This agent key is invalid, expired or revoked. Ask the shopper for a new one.") };
  const approval = await getPactApproval(resolved.sessionId, resolved.approvalId);
  if (!approval) return { ok: false, response: problem(401, "The rules this key was issued for are no longer valid.") };
  return { ok: true, ctx: { sessionId: resolved.sessionId, approvalId: resolved.approvalId, approval } };
}

export function gatewayProblem(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return problem(status, error, extra);
}

/** Calls one of the app's own routes as the shopper's session, from inside the server. */
export async function internalCall(
  request: Request,
  ctx: AgentContext,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const base = process.env.PACTPAY_INTERNAL_URL?.trim() || `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `pp_sid=${ctx.sessionId}`,
        "x-pactpay-internal": internalToken(),
        ...(forwarded ? { "x-forwarded-for": forwarded } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
