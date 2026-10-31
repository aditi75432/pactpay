#!/usr/bin/env node
/**
 * Red-team an agent key: try to do things a misbehaving agent would try, and show each one being refused.
 *
 *   PACTPAY_URL=http://localhost:3000 PACTPAY_AGENT_KEY=ppk_... node scripts/agent-redteam.mjs [--tx <transactionId>]
 *
 * Pass --tx with a held payment to also test settlement limits (the expected result depends on the autonomy
 * the user chose). Exits non-zero if any attack succeeds.
 */
const BASE = (process.env.PACTPAY_URL || "http://localhost:3000").replace(/\/$/, "");
const KEY = process.env.PACTPAY_AGENT_KEY || "";
const txIndex = process.argv.indexOf("--tx");
const TX = txIndex > 0 ? process.argv[txIndex + 1] : null;
let failures = 0;

async function call(method, path, { key = KEY, body } = {}) {
  const response = await fetch(`${BASE}${path}`, { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}
function check(title, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? "  REFUSED / OK " : "  !! BREACH   "} ${title}${detail ? `\n               ${detail}` : ""}`);
}

if (!KEY) { console.error("Set PACTPAY_AGENT_KEY first (create one in PactPay after approving your rules)."); process.exit(2); }
console.log(`\nRed-teaming ${BASE}\n`);

const rules = await call("GET", "/api/agent/v1/rules");
console.log(`Agent can read its limits: ${rules.status === 200 ? "yes" : "NO"} (${rules.json.autonomy?.title ?? "?"})\n`);
if (rules.status !== 200) { console.error(rules.json.error ?? "Could not read rules."); process.exit(2); }

console.log("Attacks:");
const noKey = await call("GET", "/api/agent/v1/rules", { key: "" });
check("Call the gateway with no key", noKey.status === 401, `HTTP ${noKey.status}`);
const badKey = await call("GET", "/api/agent/v1/rules", { key: "ppk_" + "A".repeat(43) });
check("Call the gateway with a made-up key", badKey.status === 401, `HTTP ${badKey.status}`);
const rewrite = await call("POST", "/api/agent/v1/rules", { body: { rules: [], autonomy: { mode: "WITHIN_RULES" } } });
check("Rewrite the rules or raise my own autonomy", rewrite.status === 404 || rewrite.status === 405, `HTTP ${rewrite.status}: there is no such tool`);
const fakeId = "11111111-1111-4111-8111-111111111111";
const stranger = await call("POST", "/api/agent/v1/settle", { body: { transactionId: fakeId } });
check("Settle an order that isn't mine", stranger.status === 404, `HTTP ${stranger.status}`);
const fakeHold = await call("POST", "/api/agent/v1/hold", { body: { snapshotId: fakeId } });
check("Hold a payment on an offer that doesn't exist", fakeHold.status === 404, `HTTP ${fakeHold.status}`);
const junk = await call("POST", "/api/agent/v1/settle", { body: { transactionId: "' OR 1=1 --" } });
check("Send a malformed order id", junk.status === 400, `HTTP ${junk.status}`);

if (TX) {
  const mode = rules.json.autonomy.mode;
  const attempt = await call("POST", "/api/agent/v1/settle", { body: { transactionId: TX } });
  if (mode === "ASK_ALWAYS") check(`Release a payment myself although the user chose "Ask me every time"`, attempt.status === 403 && attempt.json.requiresHuman === true, `HTTP ${attempt.status}: ${attempt.json.error ?? ""}`);
  else console.log(`  (info)       Settlement requested under "${rules.json.autonomy.title}": HTTP ${attempt.status}, outcome ${attempt.json.outcome ?? attempt.json.error ?? "?"}. Above the limit it would be refused with 403.`);
} else {
  console.log("  (skipped)    Settlement-limit attack: pass --tx <transactionId> of a held payment.");
}
console.log(failures === 0 ? "\nEvery attack was refused.\n" : `\n${failures} attack(s) got through.\n`);
process.exit(failures === 0 ? 0 : 1);
