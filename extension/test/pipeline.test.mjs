import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { renderCheckout } from "../../apps/web/lib/demo-store.ts";
import { budgetRules, guardPage, parsePageEvidence } from "../../packages/pact-core/src/page-guard.ts";

/**
 * End to end, minus the network: the extension's code reader reads each demo-store checkout, the evidence goes through
 * the same parser the server uses, and the same fixed rules return the verdict the storefront promises.
 */
const require = createRequire(import.meta.url);
const X = require("../extract.js");
const pseudoFor = (scenario) => (el, which) => (scenario === "css-fee" && el.classList.contains("mf-total-row") && which === "::after" ? '"+ $9.99 handling charged at payment"' : "none");

function verdictFor(scenario, budget = 40) {
  const dom = new JSDOM(renderCheckout(scenario), { url: `https://marlowandfinch.example/store/checkout?scenario=${scenario}`, pretendToBeVisual: true });
  const r = X.extractEvidence(dom.window.document, dom.window, dom.window.location, pseudoFor(scenario));
  // Round-trip through JSON exactly as the extension sends it.
  const evidence = parsePageEvidence(JSON.parse(JSON.stringify(r.evidence)));
  return guardPage({ evidence, vision: null, rules: budgetRules(budget) });
}

test("honest checkout within budget: SAFE_TO_PAY", () => {
  const v = verdictFor("honest");
  assert.equal(v.outcome, "SAFE_TO_PAY", v.reasons.join(" | "));
  assert.equal(v.confidence, "basic");
});

test("hidden fee: DO_NOT_PAY because the total is higher than its itemized lines", () => {
  const v = verdictFor("hidden-fee", 60);
  assert.equal(v.outcome, "DO_NOT_PAY");
  assert.equal(v.inspection.arithmetic.ok, false);
});

test("invisible instruction to an AI: DO_NOT_PAY with the quote and how it was hidden", () => {
  const v = verdictFor("injected");
  assert.equal(v.outcome, "DO_NOT_PAY");
  const f = v.findings.filter((x) => x.kind === "hidden-instruction");
  assert.ok(f.length >= 1);
  assert.ok(f.some((x) => /off-screen|opacity:0/.test(x.how)));
  assert.ok(f.some((x) => /budget/i.test(x.excerpt)));
});

test("fee drawn by CSS: DO_NOT_PAY", () => {
  const v = verdictFor("css-fee");
  assert.equal(v.outcome, "DO_NOT_PAY");
  assert.ok(v.findings.some((x) => x.kind === "css-charge"));
  assert.equal(v.observed.fees, 9.99);
});

test("over budget: DO_NOT_PAY with a budget reason", () => {
  const v = verdictFor("over-budget");
  assert.equal(v.outcome, "DO_NOT_PAY");
  assert.match(v.reasons.join(" "), /budget/i);
});

test("the same honest checkout is blocked when the shopper's budget is lower than the total", () => {
  assert.equal(verdictFor("honest", 25).outcome, "DO_NOT_PAY");
});
