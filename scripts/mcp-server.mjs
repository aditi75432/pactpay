#!/usr/bin/env node
/**
 * PactPay MCP server (stdio). Lets any MCP-capable agent (Claude Desktop, Cursor, ...) shop with PactPay.
 * Zero dependencies. It only talks to the PactPay agent gateway with an agent key.
 *
 *   PACTPAY_URL=http://localhost:3000 PACTPAY_AGENT_KEY=ppk_... node scripts/mcp-server.mjs
 *
 * What the agent can do: read its rules, shortlist offers, ask for a PayPal hold (a human approves it on
 * PayPal), and request settlement. What it cannot do: change the rules, or override the settlement gate.
 */
const BASE = (process.env.PACTPAY_URL || "http://localhost:3000").replace(/\/$/, "");
const KEY = process.env.PACTPAY_AGENT_KEY || "";
const SERVER_INFO = { name: "pactpay", version: "0.1.0" };

const TOOLS = [
  { name: "pactpay_get_rules", description: "Read the shopping rules the user approved, and how much you may do on your own. You cannot change them.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "pactpay_shortlist", description: "Search live stores and rank offers against the approved rules. Only PASS offers can be held. Nothing is paid.", inputSchema: { type: "object", properties: { query: { type: "string", description: "What to look for, e.g. 'wireless mouse'" } }, required: ["query"], additionalProperties: false } },
  { name: "pactpay_hold_payment", description: "Ask for a PayPal hold on a PASS offer. A human must approve the hold on PayPal; nothing is charged. May be refused if the user's autonomy setting requires them to click.", inputSchema: { type: "object", properties: { snapshotId: { type: "string", description: "snapshotId from a shortlist result" } }, required: ["snapshotId"], additionalProperties: false } },
  { name: "pactpay_request_settlement", description: "Ask PactPay to re-check the live offer and settle a held payment. PactPay decides; it captures only if every rule still passes, otherwise it voids the hold. Refused if the user's autonomy setting requires a human to release.", inputSchema: { type: "object", properties: { transactionId: { type: "string" } }, required: ["transactionId"], additionalProperties: false } },
  { name: "pactpay_order_status", description: "Check a hold or order: authorization status, capture status and amount.", inputSchema: { type: "object", properties: { transactionId: { type: "string" } }, required: ["transactionId"], additionalProperties: false } },
];

async function gateway(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { ok: response.ok, status: response.status, json };
}

async function callTool(name, args) {
  if (!KEY) return { isError: true, text: "PACTPAY_AGENT_KEY is not set. Ask the user to create an agent key in PactPay." };
  const a = args && typeof args === "object" ? args : {};
  let result;
  if (name === "pactpay_get_rules") result = await gateway("GET", "/api/agent/v1/rules");
  else if (name === "pactpay_shortlist") result = await gateway("POST", "/api/agent/v1/shortlist", { query: String(a.query ?? "") });
  else if (name === "pactpay_hold_payment") result = await gateway("POST", "/api/agent/v1/hold", { snapshotId: String(a.snapshotId ?? "") });
  else if (name === "pactpay_request_settlement") result = await gateway("POST", "/api/agent/v1/settle", { transactionId: String(a.transactionId ?? "") });
  else if (name === "pactpay_order_status") result = await gateway("GET", `/api/agent/v1/orders/${encodeURIComponent(String(a.transactionId ?? ""))}`);
  else return { isError: true, text: `Unknown tool: ${name}` };
  return { isError: !result.ok, text: JSON.stringify({ httpStatus: result.status, ...result.json }, null, 2) };
}

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }

async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  try {
    if (method === "initialize") {
      return send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: "You shop for a user within rules they approved. A human approves each PayPal hold. You cannot change the rules or override the settlement check." } });
    }
    if (method === "ping") return isRequest && send({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (method === "tools/call") {
      const outcome = await callTool(params?.name, params?.arguments);
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: outcome.text }], isError: outcome.isError } });
    }
    if (isRequest) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (error) {
    if (isRequest) send({ jsonrpc: "2.0", id, error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" } });
  }
}

let buffer = "";
let pending = 0;
let inputEnded = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
    pending += 1;
    void handle(message).finally(() => { pending -= 1; if (inputEnded && pending === 0) process.exit(0); });
  }
});
// If the client closes the pipe, finish the calls already in flight before exiting.
process.stdin.on("end", () => { inputEnded = true; if (pending === 0) process.exit(0); });
process.stderr.write(`pactpay MCP server ready (${BASE})\n`);
