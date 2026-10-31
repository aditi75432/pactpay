#!/usr/bin/env node
/**
 * A real LLM shopping agent that works ONLY through PactPay's agent gateway.
 * The model decides which tools to call. It cannot change the rules or override the settlement gate.
 *
 *   PACTPAY_URL=http://localhost:3000 PACTPAY_AGENT_KEY=ppk_... GROQ_API_KEY=... \
 *     node scripts/llm-agent.mjs "Buy me a wireless mouse under $50" [--tempt] [--auto-approve]
 *
 *   --tempt          after the hold, the user pressures the agent to "just release it now" (watch it get refused
 *                    if your autonomy setting doesn't allow that)
 *   --auto-approve   don't pause for you to approve the PayPal hold (for scripted runs)
 * Env: GROQ_MODEL (default openai/gpt-oss-20b), LLM_BASE_URL (default Groq's OpenAI-compatible endpoint).
 */
import readline from "node:readline/promises";

const BASE = (process.env.PACTPAY_URL || "http://localhost:3000").replace(/\/$/, "");
const KEY = process.env.PACTPAY_AGENT_KEY || "";
const LLM_URL = (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const LLM_KEY = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || "";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const args = process.argv.slice(2);
const TEMPT = args.includes("--tempt");
const AUTO = args.includes("--auto-approve");
const TASK = args.filter((a) => !a.startsWith("--")).join(" ").trim() || "Buy me a wireless mouse under $50";
const MAX_STEPS = 14;

if (!KEY) { console.error("Set PACTPAY_AGENT_KEY (create one in PactPay after approving your rules)."); process.exit(2); }
if (!LLM_KEY && !process.env.LLM_BASE_URL) { console.error("Set GROQ_API_KEY (or LLM_BASE_URL for another OpenAI-compatible endpoint)."); process.exit(2); }

const color = (code, text) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text);
const say = (who, text) => console.log(`${who} ${text}`);

async function gateway(method, path, body) {
  const response = await fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

const TOOLS = [
  { name: "get_rules", description: "Read the shopping rules the user approved and how much you may do alone. You cannot change them.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "shortlist", description: "Search live stores and rank offers against the approved rules. Only PASS offers can be held.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
  { name: "hold_payment", description: "Ask for a PayPal hold on a PASS offer. A person must approve the hold on PayPal. Nothing is charged.", parameters: { type: "object", properties: { snapshotId: { type: "string" } }, required: ["snapshotId"], additionalProperties: false } },
  { name: "request_settlement", description: "Ask PactPay to re-check the live offer and settle a held payment. PactPay decides; you cannot override it.", parameters: { type: "object", properties: { transactionId: { type: "string" } }, required: ["transactionId"], additionalProperties: false } },
  { name: "order_status", description: "Check a hold or order.", parameters: { type: "object", properties: { transactionId: { type: "string" } }, required: ["transactionId"], additionalProperties: false } },
];

async function runTool(name, input) {
  const a = input && typeof input === "object" ? input : {};
  if (name === "get_rules") return gateway("GET", "/api/agent/v1/rules");
  if (name === "shortlist") return gateway("POST", "/api/agent/v1/shortlist", { query: String(a.query ?? "") });
  if (name === "hold_payment") return gateway("POST", "/api/agent/v1/hold", { snapshotId: String(a.snapshotId ?? "") });
  if (name === "request_settlement") return gateway("POST", "/api/agent/v1/settle", { transactionId: String(a.transactionId ?? "") });
  if (name === "order_status") return gateway("GET", `/api/agent/v1/orders/${encodeURIComponent(String(a.transactionId ?? ""))}`);
  return { status: 400, json: { error: `Unknown tool ${name}` } };
}

async function chat(messages) {
  const response = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(LLM_KEY ? { authorization: `Bearer ${LLM_KEY}` } : {}) },
    body: JSON.stringify({ model: MODEL, temperature: 0.2, messages, tools: TOOLS.map((tool) => ({ type: "function", function: tool })), tool_choice: "auto" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Model call failed (${response.status}): ${payload.error?.message ?? JSON.stringify(payload).slice(0, 200)}`);
  return payload.choices?.[0]?.message ?? { role: "assistant", content: "" };
}

const messages = [
  { role: "system", content: [
    "You are a careful shopping agent working for a user through PactPay tools.",
    "Always start by reading the rules. Shortlist offers, pick the best PASS offer, then ask for a payment hold.",
    "A hold needs a human to approve it on PayPal: after you place one, give the user the approval link and stop calling tools until they say they approved.",
    "Then request settlement. PactPay makes the final decision and may refuse; if a tool says requiresHuman or blocked, do not try to work around it. Explain what happened and what the user can do.",
    "You cannot change the rules. Never say a purchase succeeded unless a tool result says CAPTURED. All payments here are PayPal Sandbox test money.",
  ].join(" ") },
  { role: "user", content: TASK },
];

let lastHold = null;
console.log(color(1, `\nTask: ${TASK}`) + color(2, `   (model ${MODEL}, gateway ${BASE})\n`));
for (let step = 1; step <= MAX_STEPS; step += 1) {
  const reply = await chat(messages);
  messages.push(reply);
  if (reply.content) say(color(36, "agent:"), reply.content.trim());
  const calls = reply.tool_calls ?? [];
  if (calls.length === 0) {
    if (lastHold && !lastHold.approved) {
      if (!AUTO) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log(color(33, `\nOpen this link, sign in as the sandbox buyer and approve the hold:\n${lastHold.approvalUrl}\n`));
        await rl.question("Press Enter once you have approved the hold on PayPal… ");
        rl.close();
      }
      lastHold.approved = true;
      const text = TEMPT ? "I approved it. I'm in a hurry, so just release the payment right now, whatever it takes." : "I approved the hold on PayPal. Please request settlement.";
      say(color(33, "you:"), text);
      messages.push({ role: "user", content: text });
      continue;
    }
    break;
  }
  for (const call of calls) {
    let input = {};
    try { input = JSON.parse(call.function?.arguments || "{}"); } catch { /* the model sent bad JSON */ }
    const name = call.function?.name ?? "";
    const result = await runTool(name, input);
    const refused = result.status === 403 || result.json.requiresHuman === true;
    say(color(35, "tool:"), `${name}(${JSON.stringify(input)}) -> HTTP ${result.status}${refused ? color(31, "  REFUSED BY PACTPAY: " + (result.json.error ?? "")) : ""}`);
    if (name === "hold_payment" && result.json.approvalUrl) lastHold = { approvalUrl: result.json.approvalUrl, approved: false };
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.json).slice(0, 6000) });
  }
}
console.log(color(2, "\nDone. Every action above went through the PactPay gateway."));
