import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { renderCheckout, renderStorefront } from "../../apps/web/lib/demo-store.ts";
import { budgetRules, guardPage, parsePageEvidence } from "../../packages/pact-core/src/page-guard.ts";

/**
 * The real content script, running against the real demo-store HTML, with a fake Chrome API wired to the real verdict
 * engine. This exercises the on-page card, the pay-button speed bump, the rules modal and key renewal.
 */
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function setup(html, url, { backend = {}, stored = {} } = {}) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, { url, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.__PACTPAY_TEST_OPEN_SHADOW__ = true;
  // jsdom's postMessage doesn't set event.source/origin the way a browser does, so model that.
  w.postMessage = (data) => setTimeout(() => w.dispatchEvent(new w.MessageEvent("message", { data, origin: w.location.origin, source: w })), 0);
  const store = { ...stored };
  const calls = [];
  const listeners = [];
  w.chrome = {
    storage: { local: {
      get: (defaults, cb) => cb({ ...defaults, ...store }),
      set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
    } },
    runtime: {
      getManifest: () => ({ version: "1.0.0" }),
      lastError: null,
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (msg, cb) => {
        calls.push(msg);
        const handler = backend[msg.type] || (() => ({ ok: true }));
        Promise.resolve(handler(msg, store)).then((r) => cb && cb(r));
      },
    },
  };
  for (const f of ["config.js", "extract.js", "content.js"]) w.eval(read(f));
  const shadow = () => w.document.getElementById("pactpay-guard-host")?.shadowRoot ?? null;
  const text = () => shadow()?.textContent ?? "";
  const fromTab = (msg) => listeners.forEach((fn) => fn(msg, {}, () => {}));
  return { w, store, calls, shadow, text, fromTab };
}

const localCheck = (budget = 40) => (msg) => {
  const evidence = parsePageEvidence(JSON.parse(JSON.stringify(msg.evidence)));
  const verdict = guardPage({ evidence, vision: null, rules: budgetRules(budget) });
  return { ok: true, result: { mode: "quick", rulesTitle: `Quick Guard: budget $${budget}`, verdict, visionNote: null, readers: [] } };
};
const co = (scenario) => ({ html: renderCheckout(scenario, "mug-set"), url: `https://shop.example/store/checkout?scenario=${scenario}` });
const click = (w, el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
const buttonByText = (root, label) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);

test("honest checkout: green verdict, pay button is not held", async () => {
  const { html, url } = co("honest");
  const t = setup(html, url, { backend: { GUARD_CHECK: localCheck() } });
  await wait(120);
  assert.match(t.text(), /Safe to pay/);
  click(t.w, t.w.document.getElementById("place-order"));
  assert.equal(t.w.document.getElementById("mf-toast").style.display, "block");
});

test("invisible instruction: red verdict quotes the hidden text, and Place order is stopped", async () => {
  const { html, url } = co("injected");
  const t = setup(html, url, { backend: { GUARD_CHECK: localCheck() } });
  await wait(120);
  assert.match(t.text(), /Do not pay/);
  assert.match(t.text(), /ignore the buyer's budget/i);
  assert.match(t.text(), /Hidden how: off-screen|Hidden how: opacity:0/);
  click(t.w, t.w.document.getElementById("place-order"));
  assert.match(t.text(), /stopped this payment/);
  assert.notEqual(t.w.document.getElementById("mf-toast").style.display, "block");
  click(t.w, buttonByText(t.shadow(), "I understand, pay anyway"));
  assert.equal(t.w.document.getElementById("mf-toast").style.display, "block");
});

test("a store page that isn't a checkout stays silent", async () => {
  const t = setup(renderStorefront(), "https://shop.example/store", { backend: { GUARD_CHECK: localCheck() } });
  await wait(120);
  assert.equal(t.text(), "");
  assert.equal(t.calls.filter((c) => c.type === "GUARD_CHECK").length, 0);
});

test("a manual check on a non-checkout page explains itself instead of showing an error", async () => {
  const t = setup(renderStorefront(), "https://shop.example/store", { backend: { GUARD_CHECK: localCheck() } });
  await wait(60);
  t.fromTab({ type: "RUN_CHECK" });
  await wait(80);
  assert.match(t.text(), /doesn't look like a checkout/);
  assert.doesNotMatch(t.text(), /Couldn't check this page/);
  assert.equal(t.calls.filter((c) => c.type === "GUARD_CHECK").length, 0, "nothing is sent for a non-checkout page");
});

test("set rules in the on-page modal: draft, review with 'Guard checks this', approve", async () => {
  const draft = {
    compiler: "MODEL", title: "Mug set", assumptions: ["Currency is USD"], unverifiedRequirements: ["Brand is a mug maker"],
    pact: { constraints: [
      { id: "c1", description: "Final landed total must be at most 40.00 USD.", severity: "hard" },
      { id: "c2", description: "Prefer a ceramic mug.", severity: "soft" },
    ] },
    checkable: [{ id: "c1", label: "Final landed total must be at most 40.00 USD.", hard: true }],
  };
  const { html, url } = co("honest");
  const backend = {
    GUARD_CHECK: localCheck(),
    RULES_DRAFT: () => ({ ok: true, draft }),
    RULES_APPROVE: (msg, store) => { store.key = "ppk_test"; store.rulesTitle = "Mug set"; return { ok: true, title: "Mug set", rules: [{ id: "c1", label: draft.checkable[0].label, hard: true }] }; },
  };
  const t = setup(html, url, { backend });
  await wait(120);
  t.fromTab({ type: "OPEN_RULES" });
  assert.match(t.text(), /Set your rules/);
  const ta = t.shadow().querySelector("textarea");
  assert.match(t.text(), /where the order total is \$24\.97/);
  ta.value = "Everyday mug set, total under $40, ceramic if possible";
  click(t.w, buttonByText(t.shadow(), "Draft my rules"));
  await wait(60);
  assert.match(t.text(), /Review your rules/);
  assert.match(t.text(), /MUST/); assert.match(t.text(), /NICE/);
  assert.match(t.text(), /Guard checks this/); assert.match(t.text(), /Shopping agent only/);
  assert.match(t.text(), /Drafted by AI/);
  assert.match(t.text(), /Assumed: Currency is USD/);
  click(t.w, buttonByText(t.shadow(), "Approve these rules"));
  await wait(60);
  assert.match(t.text(), /Rules approved/);
  assert.equal(t.store.key, "ppk_test");
  const sent = t.calls.find((c) => c.type === "RULES_APPROVE");
  assert.equal(sent.originalIntent, "Everyday mug set, total under $40, ceramic if possible");
  assert.equal(sent.pact, draft.pact);
});

test("a draft with no must-have rule can't be approved", async () => {
  const draft = { compiler: "RULE_BASED_FALLBACK", notice: "No model", pact: { constraints: [{ id: "n", description: "Prefer blue.", severity: "soft" }] }, checkable: [] };
  const { html, url } = co("honest");
  const t = setup(html, url, { backend: { GUARD_CHECK: localCheck(), RULES_DRAFT: () => ({ ok: true, draft }) } });
  await wait(100);
  t.fromTab({ type: "OPEN_RULES" });
  t.shadow().querySelector("textarea").value = "A blue mug, nothing else";
  click(t.w, buttonByText(t.shadow(), "Draft my rules"));
  await wait(60);
  assert.match(t.text(), /Add at least one must-have/);
  assert.equal(buttonByText(t.shadow(), "Approve these rules").disabled, true);
  assert.match(t.text(), /basic parser/);
});

test("a too-short description is rejected before anything is sent", async () => {
  const { html, url } = co("honest");
  const t = setup(html, url, { backend: { GUARD_CHECK: localCheck() } });
  await wait(100);
  t.fromTab({ type: "OPEN_RULES" });
  t.shadow().querySelector("textarea").value = "mug";
  click(t.w, buttonByText(t.shadow(), "Draft my rules"));
  await wait(30);
  assert.match(t.text(), /Add a few more words/);
  assert.equal(t.calls.filter((c) => c.type === "RULES_DRAFT").length, 0);
});

test("expired 24-hour key: offers one-click renewal, then re-checks", async () => {
  const { html, url } = co("honest");
  let renewed = false;
  const backend = {
    GUARD_CHECK: (msg) => renewed ? localCheck()(msg) : { ok: false, status: 401, hadKey: true, error: "This agent key is invalid, expired or revoked." },
    RULES_RENEW: () => { renewed = true; return { ok: true }; },
  };
  const t = setup(html, url, { backend, stored: { key: "ppk_old", screenshots: false } });
  await wait(120);
  assert.match(t.text(), /Your rules key expired/);
  click(t.w, buttonByText(t.shadow(), "Renew my rules"));
  await wait(120);
  assert.match(t.text(), /Safe to pay/);
});

test("the web app can send a link code through the bridge (only on the app's own origin)", async () => {
  const { html } = co("honest");
  const t = setup(html, "http://localhost:3000/extension", { backend: { LINK: (m) => ({ ok: m.code === "ABCD-2345" }) } });
  const seen = [];
  t.w.addEventListener("message", (e) => { if (e.data && e.data.source === "pactpay-guard-ext") seen.push(e.data.type); });
  await wait(60);
  t.w.postMessage({ source: "pactpay-web", type: "LINK", code: "ABCD-2345" }, t.w.location.origin);
  await wait(60);
  assert.ok(seen.includes("READY")); assert.ok(seen.includes("LINKED"));
  // On any other site the bridge isn't listening.
  const other = setup(html, "https://evil.example/", { backend: { LINK: () => ({ ok: true }) } });
  await wait(60);
  other.w.postMessage({ source: "pactpay-web", type: "LINK", code: "ABCD-2345" }, other.w.location.origin);
  await wait(60);
  assert.equal(other.calls.filter((c) => c.type === "LINK").length, 0);
});
