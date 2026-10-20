"use client";

import { useMemo, useState } from "react";
import type { Constraint, PurchasePact } from "@pactpay/pact-core";

type CompilerName = "GROQ" | "RULE_BASED_FALLBACK";
type Compilation = {
  title: string;
  searchQuery: string;
  assumptions: string[];
  unverifiedRequirements: string[];
  compiler: CompilerName;
  model: string;
  notice: string | null;
  pact: PurchasePact;
};

const STORAGE_KEY = "pactpay.activePact.v1";
const DEMO_INTENT = "Find a wireless mouse with a catalog item price at most $50 USD, in stock. Prefer Logitech.";
const EXAMPLES = [
  { label: "Wireless mouse", value: DEMO_INTENT },
  { label: "USB-C charger", value: "Find a USB-C charger with a catalog item price at most $40 USD, in stock. Prefer Anker." },
  { label: "Wireless headphones", value: "Find wireless headphones with a catalog item price at most $100 USD, in stock. Prefer Sony." },
];

function money(value: number | undefined, currency: string) {
  if (value === undefined || !Number.isFinite(value)) return "Not specified";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${value.toFixed(2)} ${currency}`; }
}

function CountMark({ n }: { n: string }) { return <span className="count-mark">{n}</span>; }
function Arrow() { return <span aria-hidden="true">↗</span>; }
function Brand() {
  return <a href="/" className="brand-lockup" aria-label="PactPay home">
    <span className="brand-symbol"><span /><span /><span /><span /></span>
    <span className="brand-word">pactpay<span className="brand-period">.</span></span>
  </a>;
}

export default function Home() {
  const [intent, setIntent] = useState(DEMO_INTENT);
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compilation, setCompilation] = useState<Compilation | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [budgetText, setBudgetText] = useState("");
  const [itemPriceBudgetText, setItemPriceBudgetText] = useState("");
  const [searching, setSearching] = useState(false);

  const hardCount = useMemo(() => compilation?.pact.constraints.filter((constraint) => constraint.severity === "hard").length ?? 0, [compilation]);
  const softCount = useMemo(() => compilation?.pact.constraints.filter((constraint) => constraint.severity === "soft").length ?? 0, [compilation]);

  async function compileIntent() {
    setCompiling(true);
    setError(null);
    setCompilation(null);
    try {
      const response = await fetch("/api/intent/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Couldn't compile this intent.");
      const result = payload as Compilation;
      setCompilation(result);
      setCurrency(result.pact.currency);
      const landedTotalConstraint = result.pact.constraints.find((constraint) => constraint.field === "total" && constraint.comparator === "lte");
      const draftLandedTotal = result.pact.maxTotalAmount ?? (typeof landedTotalConstraint?.expected === "number" ? landedTotalConstraint.expected : undefined);
      setBudgetText(draftLandedTotal === undefined ? "" : String(draftLandedTotal));
      const itemPriceConstraint = result.pact.constraints.find((constraint) => constraint.field === "attributes.itemPrice" && constraint.comparator === "lte");
      setItemPriceBudgetText(typeof itemPriceConstraint?.expected === "number" ? String(itemPriceConstraint.expected) : "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please retry.");
    } finally {
      setCompiling(false);
    }
  }

  function updateConstraint(id: string, patch: Partial<Constraint>) {
    setCompilation((current) => current ? {
      ...current,
      pact: { ...current.pact, constraints: current.pact.constraints.map((constraint) => constraint.id === id ? { ...constraint, ...patch } : constraint) },
    } : current);
  }

  function changeItemPriceBudget(value: string) {
    setItemPriceBudgetText(value);
    const parsed = value.trim() ? Number(value.replace(/[ ,\s$₹]/g, "")) : undefined;
    if (value.trim() && (parsed === undefined || !Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000)) return;
    setCompilation((current) => {
      if (!current) return current;
      const constraints = current.pact.constraints.filter((constraint) => !(constraint.field === "attributes.itemPrice" && constraint.comparator === "lte"));
      if (parsed !== undefined) constraints.unshift({
        id: "max-catalog-item-price",
        kind: "budget",
        severity: "hard",
        description: `Catalog item price must be at most ${parsed.toFixed(2)} ${currency}; shipping and tax are not included.`,
        expected: parsed,
        comparator: "lte",
        field: "attributes.itemPrice",
      });
      return { ...current, pact: { ...current.pact, constraints } };
    });
  }

  function changeLandedBudget(value: string) {
    setBudgetText(value);
    const parsed = value.trim() ? Number(value.replace(/[ ,\s$₹]/g, "")) : undefined;
    if (value.trim() && (parsed === undefined || !Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000)) return;
    setCompilation((current) => {
      if (!current) return current;
      const constraints = current.pact.constraints.filter((constraint) => constraint.field !== "total");
      if (parsed !== undefined) constraints.unshift({
        id: "max-landed-total",
        kind: "budget",
        severity: "hard",
        description: `Final landed total must be at most ${parsed.toFixed(2)} ${currency}.`,
        expected: parsed,
        comparator: "lte",
        field: "total",
      });
      return { ...current, pact: { ...current.pact, maxTotalAmount: parsed, constraints } };
    });
  }

  function removeConstraint(id: string) {
    const removed = compilation?.pact.constraints.find((constraint) => constraint.id === id);
    if (removed?.field === "attributes.itemPrice" && removed.comparator === "lte") setItemPriceBudgetText("");
    setCompilation((current) => current ? {
      ...current,
      pact: { ...current.pact, constraints: current.pact.constraints.filter((constraint) => constraint.id !== id) },
    } : current);
  }

  function approveAndSearch() {
    if (!compilation) return;
    const parsedBudget = budgetText.trim() ? Number(budgetText.replace(/[ ,\s$₹]/g, "")) : undefined;
    const parsedItemPriceBudget = itemPriceBudgetText.trim() ? Number(itemPriceBudgetText.replace(/[ ,\s$₹]/g, "")) : undefined;
    if (parsedBudget !== undefined && (!Number.isFinite(parsedBudget) || parsedBudget <= 0 || parsedBudget > 1_000_000)) {
      setError("Maximum landed total must be greater than zero and no more than 1,000,000, or be left blank.");
      return;
    }
    if (parsedItemPriceBudget !== undefined && (!Number.isFinite(parsedItemPriceBudget) || parsedItemPriceBudget <= 0 || parsedItemPriceBudget > 1_000_000)) {
      setError("Catalog item price cap must be greater than zero and no more than 1,000,000, or be left blank.");
      return;
    }
    // Rebuild the two caps from their own controls. A catalog item-price cap
    // must never silently become a final landed-total assertion.
    let constraints = compilation.pact.constraints.filter((constraint) =>
      constraint.field !== "currency" &&
      constraint.field !== "total" &&
      !(constraint.field === "attributes.itemPrice" && constraint.comparator === "lte")
    );
    if (parsedBudget !== undefined) {
      constraints.unshift({
        id: "max-landed-total",
        kind: "budget",
        severity: "hard",
        description: `Final landed total must be at most ${parsedBudget.toFixed(2)} ${currency}.`,
        expected: parsedBudget,
        comparator: "lte",
        field: "total",
      });
    }
    if (parsedItemPriceBudget !== undefined) {
      constraints.unshift({
        id: "max-catalog-item-price",
        kind: "budget",
        severity: "hard",
        description: `Catalog item price must be at most ${parsedItemPriceBudget.toFixed(2)} ${currency}; shipping and tax are not included.`,
        expected: parsedItemPriceBudget,
        comparator: "lte",
        field: "attributes.itemPrice",
      });
    }
    constraints.push({
      id: "currency-match",
      kind: "attribute",
      severity: "hard",
      description: `Offer currency must be ${currency}.`,
      expected: currency,
      comparator: "eq",
      field: "currency",
    });
    if (constraints.length < 2) {
      setError("Keep at least one purchase requirement in addition to the currency check.");
      return;
    }
    if (constraints.length > 12) {
      setError("This pact has too many requirements. Remove a rule before continuing.");
      return;
    }
    const approvedPact: PurchasePact = {
      ...compilation.pact,
      currency: currency as PurchasePact["currency"],
      maxTotalAmount: parsedBudget,
      constraints,
      authority: {
        canSearch: true,
        canCompare: true,
        canCreateOrder: false,
        canAuthorize: false,
        canCapture: false,
        canSubstitute: false,
        canChangeHardConstraints: false,
      },
    };
    setSearching(true);
    setError(null);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(approvedPact));
      sessionStorage.setItem("pactpay.activeIntent.v1", JSON.stringify({ title: compilation.title, originalIntent: intent, searchQuery: compilation.searchQuery, compiler: compilation.compiler }));
      window.location.href = `/agent?query=${encodeURIComponent(compilation.searchQuery)}`;
    } catch {
      setSearching(false);
      setError("Your browser couldn't save this pact for the next step. Check that site storage is enabled and retry.");
    }
  }

  return (
    <main className="home-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <Brand />
        <nav className="top-nav" aria-label="Main navigation">
          <a className="nav-active" href="/">Workspace</a>
          <a href="/agent">Shopping agent</a>
          <a href="/discover">Discover offers</a>
          <a href="/control-center">Control Center</a>
          <a href="/evidence">Evidence desk</a>
          <a href="/pact-lab">Policy lab</a>
        </nav>
        <div className="topbar-right">
          <span className="env-pill"><span className="live-dot" /> SANDBOX · NO LIVE PAYMENTS</span>
          <a href="/protected-demo" className="nav-sandbox">Sandbox lab <Arrow /></a>
        </div>
      </header>

      <section className="hero-grid">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> THE CONTROL LAYER FOR AGENTIC COMMERCE</div>
          <h1>Let AI shop.<br /><span>Never let it guess.</span></h1>
          <p className="hero-lede">Shopping agents can find the deal. PactPay makes sure the deal still obeys <em>your</em> rules before money moves.</p>
          <div className="hero-proof-row">
            <div className="proof-chip"><span className="proof-icon proof-mint">✳</span><span><strong>Intent-bound</strong><small>Your rules become a Purchase Pact</small></span></div>
            <div className="proof-chip"><span className="proof-icon proof-lilac">⌁</span><span><strong>Evidence-gated</strong><small>Unknown never means “pass”</small></span></div>
            <div className="proof-chip"><span className="proof-icon proof-gold">↗</span><span><strong>Payment-aware</strong><small>Deterministic gate before capture</small></span></div>
          </div>
          <div className="trust-note"><span className="trust-check">✓</span> AI drafts the rules. The policy engine enforces them. The model cannot capture funds.</div>
        </div>

        <section className="composer-card" aria-labelledby="composer-title">
          <div className="composer-heading">
            <div>
              <div className="step-kicker"><CountMark n="01" /> CREATE YOUR PURCHASE PACT</div>
              <h2 id="composer-title">What are we buying?</h2>
              <p>Say what matters. We’ll turn it into rules you can review and approve.</p>
            </div>
            <div className="ai-orbit" aria-hidden="true"><span>✳</span><i /><i /><i /></div>
          </div>
          <label className="sr-only" htmlFor="purchase-intent">Describe your purchase intent</label>
          <textarea id="purchase-intent" className="intent-input" value={intent} onChange={(event) => setIntent(event.currentTarget.value)} maxLength={1200} placeholder="e.g. Find a wireless mouse with a catalog item price at most $50 USD, in stock. Prefer Logitech." />
          <div className="intent-footer"><span>{intent.length}/1,200 characters</span><span><span className="input-dot" /> Natural language in · Structured rules out</span></div>
          <div className="example-row" aria-label="Example intents">
            <span className="example-label">Try an example</span>
            {EXAMPLES.map((example) => <button type="button" key={example.label} className="example-chip" onClick={() => { setIntent(example.value); setError(null); }}>{example.label}</button>)}
          </div>
          <button type="button" className="primary-button compile-button" disabled={compiling || intent.trim().length < 8} onClick={() => void compileIntent()}>
            {compiling ? <><span className="button-spinner" /> Compiling your intent…</> : <>Compile purchase pact <span aria-hidden="true">→</span></>}
          </button>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {compilation && <div className="compile-result" aria-live="polite">
            <div className="result-topline">
              <span className={`compiler-badge ${compilation.compiler === "GROQ" ? "compiler-ai" : "compiler-fallback"}`}>
                <span className="badge-dot" /> {compilation.compiler === "GROQ" ? `GROQ AI · ${compilation.model}` : "LOCAL RULE-BASED DRAFT"}
              </span>
              <span className="result-version">DRAFT v1</span>
            </div>
            {compilation.notice && <p className="fallback-note">{compilation.notice}</p>}
            <div className="result-title-row"><div><span className="field-label">YOUR PURCHASE PACT</span><h3>{compilation.title}</h3></div><span className="pact-shield">✓</span></div>
            <div className="pact-summary-stats">
              <div><strong>{hardCount.toString().padStart(2, "0")}</strong><span>Hard rules</span></div>
              <div><strong>{softCount.toString().padStart(2, "0")}</strong><span>Preferences</span></div>
              <div><strong>{compilation.pact.constraints.length.toString().padStart(2, "0")}</strong><span>Total rules</span></div>
            </div>
            <div className="pact-controls">
              <label className="control-field"><span>Payment currency</span><select value={currency} onChange={(event) => setCurrency(event.currentTarget.value)}><option value="USD">USD · US dollar</option><option value="INR">INR · Indian rupee</option></select></label>
              <label className="control-field"><span>Catalog item price cap <i>for discovery</i></span><div className="budget-input-wrap"><span>{currency === "INR" ? "₹" : "$"}</span><input inputMode="decimal" value={itemPriceBudgetText} onChange={(event) => changeItemPriceBudget(event.currentTarget.value)} placeholder="No cap set" /></div><small>Listing price only; excludes shipping and tax.</small></label>
              <label className="control-field"><span>Final landed total <i>if specified</i></span><div className="budget-input-wrap"><span>{currency === "INR" ? "₹" : "$"}</span><input inputMode="decimal" value={budgetText} onChange={(event) => changeLandedBudget(event.currentTarget.value)} placeholder="No cap set" /></div><small>Requires separate checkout evidence to verify.</small></label>
            </div>
            <div className="constraints-heading"><span>REVIEW RULES</span><span>YOU ARE IN CONTROL</span></div>
            <div className="constraint-list">
              {compilation.pact.constraints.map((constraint) => <div className="constraint-row" key={constraint.id}>
                <span className={`rule-severity ${constraint.severity === "hard" ? "rule-hard" : "rule-soft"}`}>{constraint.severity === "hard" ? "HARD" : "SOFT"}</span>
                <span className="rule-copy"><strong>{constraint.description}</strong><small>{constraint.field}</small></span>
                {constraint.field !== "currency" && constraint.field !== "total" && !(constraint.field === "attributes.itemPrice" && constraint.comparator === "lte") && <button type="button" className="severity-toggle" onClick={() => updateConstraint(constraint.id, { severity: constraint.severity === "hard" ? "soft" : "hard" })} title="Toggle between a hard requirement and a preference">{constraint.severity === "hard" ? "Make soft" : "Make hard"}</button>}
                {constraint.field !== "currency" && constraint.field !== "total" && <button type="button" className="remove-rule" onClick={() => removeConstraint(constraint.id)} aria-label={`Remove rule ${constraint.description}`} title="Remove rule">×</button>}
              </div>)}
            </div>
            {compilation.assumptions.length > 0 && <div className="assumptions-box"><div className="assumptions-title"><span>ⓘ</span> CONFIRM THESE ASSUMPTIONS</div>{compilation.assumptions.map((assumption, index) => <p key={`${index}-${assumption}`}>{assumption}</p>)}</div>}
            <div className="evidence-gap-note"><span className="gap-icon">◇</span><div><strong>Requirements are not evidence.</strong><p>{compilation.unverifiedRequirements[0] ?? "Merchant data may leave total, shipping, delivery or return terms unknown."} Missing or stale evidence cannot pass a hard rule.</p></div></div>
            <button type="button" className="primary-button approve-button" onClick={approveAndSearch} disabled={searching || compilation.pact.constraints.filter((constraint) => constraint.field !== "currency").length === 0}>
              {searching ? <><span className="button-spinner" /> Opening shopping agent…</> : <>Approve pact & run shopping agent <span aria-hidden="true">→</span></>}
            </button>
            <p className="approval-footnote"><span>▣</span> Approval locks this draft for evaluation in this browser session. Capture authority remains disabled.</p>
          </div>}
        </section>
      </section>

      <section className="workflow-section">
        <div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> FROM INTENT TO VERIFIED ACTION</div><h2>One promise. <span>Three guardrails.</span></h2></div><p>Agents can move quickly. The payment boundary must move deliberately.</p></div>
        <div className="workflow-grid">
          <article className="workflow-card"><div className="workflow-top"><CountMark n="01" /><span className="workflow-icon icon-green">✳</span></div><h3>Understand intent</h3><p>AI extracts explicit requirements into a reviewable Purchase Pact. Unstated details are surfaced—not invented.</p><div className="workflow-foot"><span className="status-bar status-green" /> Human-approved rules</div></article>
          <article className="workflow-card"><div className="workflow-top"><CountMark n="02" /><span className="workflow-icon icon-purple">⌁</span></div><h3>Verify the offer</h3><p>Live catalog snapshots are compared with the Pact. Source, freshness and missing evidence remain visible.</p><div className="workflow-foot"><span className="status-bar status-purple" /> Provenance before confidence</div></article>
          <article className="workflow-card"><div className="workflow-top"><CountMark n="03" /><span className="workflow-icon icon-amber">⛨</span></div><h3>Gate the payment</h3><p>Only a deterministic server-side decision may proceed. Failed or uncertain conditions stop and reconcile safely.</p><div className="workflow-foot"><span className="status-bar status-amber" /> Fail-closed by design</div></article>
        </div>
      </section>

      <section className="capability-strip">
        <div><span className="capability-icon">▦</span><span><strong>Source-backed evidence desk</strong><small>Review evidence, merchant claims and policy results side by side.</small></span><a href="/evidence" aria-label="Open evidence desk"><Arrow /></a></div>
        <div><span className="capability-icon">⌘</span><span><strong>Repeatable red-team scenarios</strong><small>Test the gate with downgrades and stale evidence.</small></span><a href="/pact-lab" aria-label="Open policy lab"><Arrow /></a></div>
        <div><span className="capability-icon">↗</span><span><strong>PayPal Sandbox execution</strong><small>Controlled simulator—not a real retailer checkout.</small></span><a href="/protected-demo" aria-label="Open sandbox simulator"><Arrow /></a></div>
        <div><span className="capability-icon">▦</span><span><strong>AG Grid Control Center</strong><small>Inspect real persisted policy runs and payment states.</small></span><a href="/control-center" aria-label="Open AG Grid Control Center"><Arrow /></a></div>
      </section>

      <footer className="home-footer"><Brand /><p>THE PACT IS THE RULE. EVIDENCE IS THE PROOF.</p><span>PayPal Sandbox only · No live payments · Merchant checkout not integrated</span></footer>
    </main>
  );
}
