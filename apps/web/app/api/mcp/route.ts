import { NextResponse } from "next/server";
import { authenticateAgent, internalCall, isRecord, type AgentContext } from "../../../lib/agent-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVER_INFO = { name: "pactpay", version: "1.0.0" };
const SUPPORTED_PROTOCOLS = new Set(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
const TOOLS = [
  { name: "pactpay_get_rules", description: "Read the exact Purchase Pact the shopper approved, including budget and autonomy. Rules are read-only and cannot be changed by an agent.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "pactpay_shortlist", description: "Search live Channel3 catalog offers and evaluate every result against the shopper's unchanged approved Purchase Pact. Results include images, links, prices and reasons. Only refreshed PASS results may be held.", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 180, description: "Product or model to search for. Do not include budget instructions; PactPay applies the approved rules after discovery." } }, required: ["query"], additionalProperties: false } },
  { name: "pactpay_hold_payment", description: "Request a PayPal Sandbox authorization hold for a refreshed PASS result. This does not charge the shopper; human approval and the shopper's autonomy settings still apply.", inputSchema: { type: "object", properties: { snapshotId: { type: "string", description: "snapshotId of a refreshed PASS result returned by pactpay_shortlist." } }, required: ["snapshotId"], additionalProperties: false } },
  { name: "pactpay_request_settlement", description: "Ask PactPay to re-check a held transaction and decide whether to capture or void it. The agent cannot override the decision.", inputSchema: { type: "object", properties: { transactionId: { type: "string" } }, required: ["transactionId"], additionalProperties: false } },
  { name: "pactpay_order_status", description: "Read the status and amount of a transaction belonging to this agent key's approved Purchase Pact.", inputSchema: { type: "object", properties: { transactionId: { type: "string" } }, required: ["transactionId"], additionalProperties: false } },
];

function rpc(id: unknown, result: unknown, protocolVersion = "2025-03-26") {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { headers: responseHeaders(protocolVersion) });
}
function rpcError(id: unknown, code: number, message: string, protocolVersion = "2025-03-26") {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status: 200, headers: responseHeaders(protocolVersion) });
}
function responseHeaders(protocolVersion = "2025-03-26"): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "Mcp-Protocol-Version": protocolVersion,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Accept",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

async function callGatewayTool(request: Request, ctx: AgentContext, name: string, args: Record<string, unknown>) {
  if (name === "pactpay_get_rules") return internalCall(request, ctx, "GET", "/api/agent/v1/rules");
  if (name === "pactpay_shortlist") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (query.length < 2 || query.length > 180) return { status: 400, json: { error: "query must be between 2 and 180 characters." } };
    return internalCall(request, ctx, "POST", "/api/agent/v1/shortlist", { query });
  }
  if (name === "pactpay_hold_payment") {
    const snapshotId = typeof args.snapshotId === "string" ? args.snapshotId : "";
    if (!snapshotId) return { status: 400, json: { error: "snapshotId is required." } };
    return internalCall(request, ctx, "POST", "/api/agent/v1/hold", { snapshotId });
  }
  if (name === "pactpay_request_settlement") {
    const transactionId = typeof args.transactionId === "string" ? args.transactionId : "";
    if (!transactionId) return { status: 400, json: { error: "transactionId is required." } };
    return internalCall(request, ctx, "POST", "/api/agent/v1/settle", { transactionId });
  }
  if (name === "pactpay_order_status") {
    const transactionId = typeof args.transactionId === "string" ? args.transactionId : "";
    if (!transactionId) return { status: 400, json: { error: "transactionId is required." } };
    return internalCall(request, ctx, "GET", `/api/agent/v1/orders/${encodeURIComponent(transactionId)}`);
  }
  return { status: 404, json: { error: `Unknown PactPay tool: ${name}` } };
}

/** Stateless Streamable HTTP MCP endpoint. External MCP clients connect by URL + Bearer key; no local repo or adapter file is needed. */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request);
  if (!auth.ok) return auth.response;

  const requestedHeaderVersion = request.headers.get("Mcp-Protocol-Version") ?? "2025-03-26";
  const protocolVersion = SUPPORTED_PROTOCOLS.has(requestedHeaderVersion) ? requestedHeaderVersion : "2025-03-26";
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 64_000) return NextResponse.json({ error: "MCP request is too large." }, { status: 413, headers: responseHeaders(protocolVersion) });
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") return rpcError(null, -32600, "Invalid JSON-RPC request.", protocolVersion);
  const id = body.id;
  const hasId = id !== undefined && id !== null;
  const params = isRecord(body.params) ? body.params : {};

  if (body.method === "notifications/initialized" || body.method === "notifications/cancelled" || body.method.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: responseHeaders(protocolVersion) });
  }
  if (body.method === "initialize") {
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26";
    const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : "2025-03-26";
    const headers = new Headers(responseHeaders(protocolVersion));
    headers.set("Mcp-Protocol-Version", protocolVersion);
    return NextResponse.json({
      jsonrpc: "2.0", id: id ?? null,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "You act for one shopper using only the Purchase Pact bound to this key. Read the rules before shopping. Never change or infer permission to change them. Only fresh PASS offers can be held. A hold is not a charge. PactPay rechecks before capture and can void the hold.",
      },
    }, { headers });
  }
  if (body.method === "ping") return hasId ? rpc(id, {}, protocolVersion) : new Response(null, { status: 202, headers: responseHeaders(protocolVersion) });
  if (body.method === "tools/list") return rpc(id ?? null, { tools: TOOLS }, protocolVersion);
  if (body.method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    if (!name) return rpcError(id ?? null, -32602, "tools/call requires params.name.", protocolVersion);
    const args = isRecord(params.arguments) ? params.arguments : {};
    const outcome = await callGatewayTool(request, auth.ctx, name, args);
    return rpc(id ?? null, {
      content: [{ type: "text", text: JSON.stringify({ httpStatus: outcome.status, ...outcome.json }, null, 2) }],
      isError: outcome.status < 200 || outcome.status >= 300,
    }, protocolVersion);
  }
  return hasId ? rpcError(id, -32601, `Method not found: ${body.method}`, protocolVersion) : new Response(null, { status: 202, headers: responseHeaders(protocolVersion) });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: responseHeaders() });
}

export async function GET() {
  return new Response("PactPay MCP endpoint. Use an MCP Streamable HTTP client with Authorization: Bearer ppk_... and POST JSON-RPC requests.", {
    status: 405,
    headers: { ...responseHeaders(), Allow: "POST, OPTIONS", "Content-Type": "text/plain; charset=utf-8" },
  });
}
