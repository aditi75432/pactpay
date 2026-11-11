/* PactPay Guard: background service worker. Captures the tab and talks to PactPay. Never decides anything. */
importScripts("config.js");

const DEFAULTS = { baseUrl: (self.PACTPAY_CONFIG && self.PACTPAY_CONFIG.baseUrl) || "http://localhost:3000", key: "", budget: 40, device: "", rulesTitle: "", rules: [], lastApproval: null, linked: false };

async function settings() {
  const v = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...v, baseUrl: String(v.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, "") };
}

async function call(path, { method = "POST", body, key, device, timeout = 70000 } = {}) {
  const s = await settings();
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  if (device) headers["x-guard-device"] = device;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${s.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: json.error || `PactPay returned ${res.status}.` };
    return { ok: true, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, error: e && e.name === "AbortError" ? "PactPay took too long to answer." : `Couldn't reach PactPay at ${s.baseUrl}. Check the server address in the extension popup.` };
  } finally { clearTimeout(timer); }
}

/** Every install gets its own device identity on first use, so the extension works with no web login. */
async function ensureDevice() {
  const s = await settings();
  if (s.device) return { ok: true, device: s.device };
  const r = await call("/api/guard/device", { body: {}, timeout: 20000 });
  if (!r.ok) return r;
  await chrome.storage.local.set({ device: r.json.token });
  return { ok: true, device: r.json.token };
}

async function guardCheck(msg) {
  const s = await settings();
  const body = { url: msg.url, evidence: msg.evidence };
  if (!s.key) body.budget = Number(s.budget) || 40;
  if (msg.screenshot) body.screenshot = msg.screenshot;
  const r = await call("/api/guard/check", { body, key: s.key || undefined });
  if (!r.ok) return { ok: false, error: r.error, status: r.status, hadKey: !!s.key };
  return { ok: true, result: r.json };
}

async function rulesDraft(msg) {
  const d = await ensureDevice();
  if (!d.ok) return d;
  const r = await call("/api/guard/rules/draft", { body: { intent: msg.intent }, device: d.device });
  return r.ok ? { ok: true, draft: r.json } : { ok: false, error: r.error };
}

async function storeApproval(json, approval) {
  await chrome.storage.local.set({ key: json.key, rulesTitle: json.title || "", rules: json.rules || [], lastApproval: approval });
}

async function rulesApprove(msg) {
  const d = await ensureDevice();
  if (!d.ok) return d;
  const approval = { pact: msg.pact, originalIntent: msg.originalIntent, compiler: msg.compiler };
  const r = await call("/api/guard/rules/approve", { body: { userApproved: true, ...approval }, device: d.device });
  if (!r.ok) return { ok: false, error: r.error };
  await storeApproval(r.json, approval);
  return { ok: true, title: r.json.title, rules: r.json.rules, expiresAt: r.json.expiresAt };
}

/** Agent keys last 24 hours. Renewing re-approves the SAME rules the shopper already approved, with one click. */
async function rulesRenew() {
  const s = await settings();
  if (!s.lastApproval) return { ok: false, error: "There are no saved rules to renew. Set your rules again." };
  return rulesApprove(s.lastApproval);
}

async function link(msg) {
  const d = await ensureDevice();
  if (!d.ok) return d;
  const r = await call("/api/guard/device/link", { body: { code: msg.code }, device: d.device, timeout: 20000 });
  if (!r.ok) return { ok: false, error: r.error };
  // Rules approved before linking belong to the old private scope. Clear them so the shopper re-approves under the account.
  await chrome.storage.local.set({ linked: true, key: "", rulesTitle: "", rules: [] });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  const run = (promise) => { promise.then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })); return true; };
  switch (msg.type) {
    case "CAPTURE":
      chrome.tabs.captureVisibleTab(sender.tab ? sender.tab.windowId : undefined, { format: "jpeg", quality: 72 })
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true;
    case "GUARD_CHECK": return run(guardCheck(msg));
    case "RULES_DRAFT": return run(rulesDraft(msg));
    case "RULES_APPROVE": return run(rulesApprove(msg));
    case "RULES_RENEW": return run(rulesRenew());
    case "LINK": return run(link(msg));
    case "BADGE":
      if (sender.tab) {
        const map = { SAFE_TO_PAY: ["✓", "#1b8a3c"], DO_NOT_PAY: ["!", "#c0392b"], CANNOT_VERIFY: ["?", "#b9770e"] };
        const [text, color] = map[msg.outcome] || ["", "#000"];
        chrome.action.setBadgeText({ tabId: sender.tab.id, text });
        chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color });
      }
      return false;
    default: return false;
  }
});
