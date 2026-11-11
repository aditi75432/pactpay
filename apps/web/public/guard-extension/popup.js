const $ = (id) => document.getElementById(id);
const DEFAULTS = { baseUrl: (self.PACTPAY_CONFIG && self.PACTPAY_CONFIG.baseUrl) || "http://localhost:3000", key: "", budget: 40, autoCheck: true, screenshots: true, blockPay: true, rulesTitle: "", rules: [], linked: false };
const send = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, (reply) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : reply)));

async function settings() { return { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) }; }
const base = (s) => s.baseUrl.replace(/\/+$/, "");

function render(s) {
  $("key").value = s.key; $("budget").value = s.budget; $("baseUrl").value = s.baseUrl;
  $("autoCheck").checked = s.autoCheck; $("screenshots").checked = s.screenshots; $("blockPay").checked = s.blockPay;
  $("open").href = `${base(s)}/control-center`;
  $("linkBadge").hidden = !s.linked;
  const list = $("rulesList"); list.textContent = "";
  if (s.key) {
    $("modeBadge").textContent = "Your rules"; $("modeBadge").className = "badge pact";
    $("rulesTitle").textContent = s.rulesTitle || "Your approved rules";
    (s.rules || []).slice(0, 5).forEach((r) => { const li = document.createElement("li"); const b = document.createElement("span"); b.className = `bd ${r.hard ? "" : "nice"}`; b.textContent = r.hard ? "MUST" : "NICE"; const t = document.createElement("span"); t.textContent = r.label; li.append(b, t); list.appendChild(li); });
    $("rulesHint").textContent = "Guard holds every checkout to these. Keys last 24 hours; Guard offers one-click renewal.";
    $("setRules").textContent = "Edit my rules"; $("setRules").className = "secondary wide";
  } else {
    $("modeBadge").textContent = "Quick Guard"; $("modeBadge").className = "badge";
    $("rulesTitle").textContent = `Checking against a $${Number(s.budget).toFixed(0)} budget`;
    $("rulesHint").textContent = "Set your own rules in plain words. You approve them right on the page, and Guard adds an AI screenshot cross-check.";
    $("setRules").textContent = "Set my rules"; $("setRules").className = "primary";
  }
}

async function test(s) {
  try {
    const headers = {}; if (s.key) headers.authorization = `Bearer ${s.key}`;
    const res = await fetch(`${base(s)}/api/guard/status`, { headers });
    const j = await res.json().catch(() => ({}));
    const el = $("status");
    if (!res.ok) { el.textContent = j.error || "That key isn't valid or has expired."; el.className = "hint bad"; return; }
    el.textContent = j.connected ? `Connected · ${j.rules.length} rules${j.vision ? " · AI cross-check on" : ""}` : `Server reachable${j.vision ? " · AI cross-check available" : ""}`; el.className = "hint ok";
  } catch { $("status").textContent = "Can't reach that PactPay server. Check the address."; $("status").className = "hint bad"; }
}

async function save() {
  const prev = await settings();
  const s = { baseUrl: $("baseUrl").value.trim().replace(/\/+$/, "") || DEFAULTS.baseUrl, key: $("key").value.trim(), budget: Math.max(1, Number($("budget").value) || 40), autoCheck: $("autoCheck").checked, screenshots: $("screenshots").checked, blockPay: $("blockPay").checked };
  // A new server is a new identity: its device token and approved rules don't carry over.
  if (s.baseUrl !== prev.baseUrl) Object.assign(s, { device: "", rulesTitle: "", rules: [], lastApproval: null, linked: false });
  await chrome.storage.local.set(s);
  const now = await settings(); render(now); await test(now);
}

async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }
async function toTab(message, failText) {
  const tab = await activeTab();
  try { await chrome.tabs.sendMessage(tab.id, message); window.close(); }
  catch { $("pageState").textContent = failText; }
}

$("setRules").addEventListener("click", () => toTab({ type: "OPEN_RULES" }, "Open a regular website tab first (not a chrome:// page), reload it once, then try again."));
$("check").addEventListener("click", () => toTab({ type: "RUN_CHECK" }, "Reload this tab once, then try again (the extension was installed after it opened)."));
$("save").addEventListener("click", save);
for (const id of ["autoCheck", "screenshots", "blockPay"]) $(id).addEventListener("change", save);
$("linkBtn").addEventListener("click", async () => {
  const code = $("code").value.trim(); const msg = $("linkMsg");
  if (!code) { msg.textContent = "Enter the code from the PactPay Guard extension page."; msg.className = "hint bad"; return; }
  msg.textContent = "Linking…"; msg.className = "hint";
  const r = await send({ type: "LINK", code });
  if (r && r.ok) { msg.textContent = "Linked. Set your rules again so they're saved to your account."; msg.className = "hint ok"; render(await settings()); }
  else { msg.textContent = (r && r.error) || "Couldn't link."; msg.className = "hint bad"; }
});

(async () => {
  const s = await settings(); render(s); test(s);
  const tab = await activeTab();
  try { const r = await chrome.tabs.sendMessage(tab.id, { type: "STATUS" }); $("pageState").textContent = r.detected ? "This page looks like a checkout." : "No checkout detected here. Open the cart or payment step."; }
  catch { $("pageState").textContent = "Open a store's checkout page to use Guard."; }
})();
