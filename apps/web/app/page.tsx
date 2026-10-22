"use client";

import { useMemo, useState } from "react";
import type { Constraint, PurchasePact } from "@pactpay/pact-core";
import AppShell from "./components/AppShell";
import { describeAutonomy, parseAutonomy, type AutonomyMode } from "@pactpay/pact-core/autonomy";
import { logEvent, resetRun, saveAutonomy } from "./components/agentLog";
import StepTracker from "./components/StepTracker";

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
const INTENT_KEY = "pactpay.activeIntent.v1";
const APPROVAL_KEY = "pactpay.activeApproval.v1";
const DEMO_INTENT = "Find a wireless mouse with a catalog item price at most $50 USD, in stock. Prefer Logitech.";
const EXAMPLES = [
  { label: "Wireless mouse", value: DEMO_INTENT },
  { label: "USB-C charger", value: "Find a USB-C charger with a catalog item price at most $40 USD, in stock. Prefer Anker." },
  { label: "Headphones", value: "Find wireless headphones with a catalog item price at most $100 USD, in stock. Prefer Sony." },
];

function parseAmount(text: string): number | undefined | "invalid" {
  if (!text.trim()) return undefined;
  const parsed = Number(text.replace(/[ ,\s$₹]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1_000_000 ? parsed : "invalid";
}

function isPriceCap(rule: Constraint): boolean {
  return (rule.field === "attributes.itemPrice" || rule.field === "total") && rule.comparator === "lte";
}

export default function Home() {
  const [intent, setIntent] = useState(DEMO_INTENT);
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compilation, setCompilation] = useState<Compilation | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [itemCap, setItemCap] = useState("");
  const [totalCap, setTotalCap] = useState("");
  const [approving, setApproving] = useState(false);
  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>("ASK_ABOVE");
  const [autonomyLimit, setAutonomyLimit] = useState("50");

  const otherRules = useMemo(
    () => (compilation?.pact.constraints ?? []).filter((rule) => rule.field !== "currency" && !isPriceCap(rule)),
    [compilation],
  );

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
      if (!response.ok) throw new Error(payload.error ?? "We couldn't turn that into rules. Try rephrasing it.");
      const result = payload as Compilation;
      setCompilation(result);
      setCurrency(result.pact.currency);
      const itemRule = result.pact.constraints.find((rule) => rule.field === "attributes.itemPrice" && rule.comparator === "lte");
      const totalRule = result.pact.constraints.find((rule) => rule.field === "total" && rule.comparator === "lte");
      setItemCap(typeof itemRule?.expected === "number" ? String(itemRule.expected) : "");
      // Only pre-fill a total limit when the shopper actually asked for one ("total", "including shipping", ...).
      // A bare "at most $50" means the item price, and a catalog can't prove a landed total anyway.
      const mentionedTotal = /\b(total|all[- ]?in|including|incl\.?|delivered|shipping|tax|out[- ]the[- ]door)\b/i.test(intent);
      const draftTotal = result.pact.maxTotalAmount ?? (typeof totalRule?.expected === "number" ? totalRule.expected : undefined);
      setTotalCap(mentionedTotal && draftTotal !== undefined ? String(draftTotal) : "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setCompiling(false);
    }
  }

  function updateRule(id: string, patch: Partial<Constraint>) {
    setCompilation((current) => current ? {
      ...current,
      pact: { ...current.pact, constraints: current.pact.constraints.map((rule) => rule.id === id ? { ...rule, ...patch } : rule) },
    } : current);
  }

  function removeRule(id: string) {
    setCompilation((current) => current ? {
      ...current,
      pact: { ...current.pact, constraints: current.pact.constraints.filter((rule) => rule.id !== id) },
    } : current);
  }

  async function approveAndFindOffers() {
    if (!compilation || approving) return;
    const item = parseAmount(itemCap);
    const total = parseAmount(totalCap);
    if (item === "invalid" || total === "invalid") {
      setError("Enter amounts greater than zero, or leave a limit blank.");
      return;
    }
    // Each money limit is rebuilt from its own field so an item-price limit can never silently become a total.
    const constraints: Constraint[] = compilation.pact.constraints.filter((rule) => rule.field !== "currency" && !isPriceCap(rule));
    if (total !== undefined) {
      constraints.unshift({ id: "max-landed-total", kind: "budget", severity: "hard", description: `Final total must be at most ${total.toFixed(2)} ${currency}.`, expected: total, comparator: "lte", field: "total" });
    }
    if (item !== undefined) {
      constraints.unshift({ id: "max-catalog-item-price", kind: "budget", severity: "hard", description: `Item price must be at most ${item.toFixed(2)} ${currency}; shipping and tax are not included.`, expected: item, comparator: "lte", field: "attributes.itemPrice" });
    }
    constraints.push({ id: "currency-match", kind: "attribute", severity: "hard", description: `Offer currency must be ${currency}.`, expected: currency, comparator: "eq", field: "currency" });
    if (constraints.filter((rule) => rule.severity === "hard" && rule.field !== "currency").length < 1) {
      setError("Keep at least one must-have rule besides the currency, otherwise nothing could ever be approved.");
      return;
    }
    if (constraints.length > 12) {
      setError("That's too many rules. Remove a few to continue.");
      return;
    }
    // Drop the compiler's own total so a limit the shopper cleared can't sneak back into the approved rules.
    const { maxTotalAmount: _compilerTotal, ...pactWithoutTotal } = compilation.pact;
    void _compilerTotal;
    const draftPact: PurchasePact = {
      ...pactWithoutTotal,
      currency: currency as PurchasePact["currency"],
      ...(total !== undefined ? { maxTotalAmount: total } : {}),
      constraints,
      authority: { canSearch: true, canCompare: true, canCreateOrder: false, canAuthorize: false, canCapture: false, canSubstitute: false, canChangeHardConstraints: false },
    };
    const autonomy = parseAutonomy({ mode: autonomyMode, limitUsd: autonomyMode === "ASK_ABOVE" ? Number(autonomyLimit) : null });
    if (autonomyMode === "ASK_ABOVE" && autonomy.mode !== "ASK_ABOVE") {
      setError("Enter the most the agent may handle on its own, as a number above zero.");
      return;
    }
    setApproving(true);
    setError(null);
    try {
      const response = await fetch("/api/pacts/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pact: draftPact, userApproved: true, originalIntent: intent, compiler: compilation.compiler, autonomy }),
      });
      const payload = await response.json() as { approvalId?: string; pactHash?: string; pact?: PurchasePact; autonomy?: unknown; error?: string };
      if (!response.ok || !payload.approvalId || !payload.pact) throw new Error(payload.error ?? "We couldn't save your approval.");
      resetRun();
      const savedAutonomy = parseAutonomy(payload.autonomy);
      saveAutonomy(savedAutonomy);
      logEvent("you", `Approved ${payload.pact.constraints.filter((rule) => rule.severity === "hard").length} must-have rules and chose “${describeAutonomy(savedAutonomy).title}”.`);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload.pact));
      sessionStorage.setItem(APPROVAL_KEY, JSON.stringify({ approvalId: payload.approvalId, pactId: payload.pact.id, pactHash: payload.pactHash }));
      sessionStorage.setItem(INTENT_KEY, JSON.stringify({ title: compilation.title, originalIntent: intent, searchQuery: compilation.searchQuery, compiler: compilation.compiler }));
      window.location.href = `/agent?query=${encodeURIComponent(compilation.searchQuery)}`;
    } catch (caught) {
      setApproving(false);
      setError(caught instanceof Error ? caught.message : "We couldn't save your approval. Please try again.");
    }
  }

  return (
    <AppShell>
      <section className="pp-hero">
        <p className="pp-eyebrow">Safer shopping with AI agents</p>
        <h1 className="pp-h1" style={{ marginTop: 14, maxWidth: 14 + "em" }}>Let your AI agent shop. Keep the final say.</h1>
        <p className="pp-lede" style={{ marginTop: 18 }}>
          Tell PactPay what you want. It finds real offers and puts your payment on hold. The money is released only if the offer still matches the rules you approved. If the seller changes the deal, the hold is cancelled and you aren&apos;t charged.
        </p>
      </section>

      <div style={{ marginTop: 36 }}>
        <StepTracker current={compilation ? 1 : 0} />
        <div className="pp-grid-2">
          <section className="pp-card" aria-labelledby="ask-title">
            <div className="pp-card-head">
              <div>
                <h2 className="pp-h3" id="ask-title">What do you want to buy?</h2>
                <p className="pp-small pp-muted" style={{ marginTop: 4 }}>Say it the way you would to a friend. Include a budget if you have one.</p>
              </div>
            </div>
            <label className="pp-sr" htmlFor="intent">Describe your purchase</label>
            <textarea id="intent" className="pp-textarea" value={intent} onChange={(event) => setIntent(event.target.value)} maxLength={1200} />
            <div className="pp-row" style={{ margin: "14px 0 18px" }}>
              <span className="pp-tiny pp-muted" style={{ fontWeight: 700 }}>Try:</span>
              {EXAMPLES.map((example) => (
                <button key={example.label} type="button" className="pp-chip" onClick={() => { setIntent(example.value); setCompilation(null); setError(null); }}>{example.label}</button>
              ))}
            </div>
            <button type="button" className="pp-btn pp-btn-primary pp-btn-block" onClick={compileIntent} disabled={compiling || intent.trim().length < 8}>
              {compiling ? <><span className="pp-spinner" aria-hidden="true" /> Writing your rules…</> : "Turn this into rules"}
            </button>
            {error && !compilation && <p className="pp-callout pp-callout-bad" role="alert" style={{ marginTop: 14 }}>{error}</p>}
          </section>

          <section aria-live="polite">
            {!compilation && (
              <div className="pp-card-flat" style={{ background: "transparent", borderStyle: "dashed" }}>
                <h2 className="pp-h3">Your rules will show up here</h2>
                <p className="pp-muted" style={{ marginTop: 8 }}>Nothing is searched or paid until you read them and approve. You can change any rule first.</p>
              </div>
            )}
            {compilation && (
              <div className="pp-card pp-enter">
                <div className="pp-card-head">
                  <div>
                    <h2 className="pp-h3">{compilation.title}</h2>
                    <p className="pp-small pp-muted" style={{ marginTop: 4 }}>Check these rules. They&apos;re the only thing the agent can act on.</p>
                  </div>
                  <span className={`pp-badge ${compilation.compiler === "GROQ" ? "pp-badge-good" : "pp-badge-warn"}`}>
                    {compilation.compiler === "GROQ" ? "Written by AI" : "Basic parser"}
                  </span>
                </div>
                {compilation.notice && <p className="pp-callout pp-callout-warn pp-small" style={{ marginBottom: 14 }}>{compilation.notice}</p>}

                <div className="pp-stack" style={{ gap: 14 }}>
                  <div>
                    <label className="pp-label" htmlFor="item-cap">Most you&apos;ll pay for the item</label>
                    <div className="pp-money-input"><span>{currency === "INR" ? "₹" : "$"}</span><input id="item-cap" inputMode="decimal" value={itemCap} onChange={(event) => setItemCap(event.target.value)} placeholder="No limit" /></div>
                    <p className="pp-tiny pp-muted" style={{ marginTop: 6 }}>Shipping and tax aren&apos;t counted here.</p>
                  </div>
                  <div>
                    <label className="pp-label" htmlFor="total-cap">Most you&apos;ll pay in total, with shipping and tax <span className="pp-muted" style={{ fontWeight: 500 }}>(optional)</span></label>
                    <div className="pp-money-input"><span>{currency === "INR" ? "₹" : "$"}</span><input id="total-cap" inputMode="decimal" value={totalCap} onChange={(event) => setTotalCap(event.target.value)} placeholder="No limit" /></div>
                    <p className="pp-tiny pp-muted" style={{ marginTop: 6 }}>In test mode, shipping and tax are fixed test values ($4.99 and 8%). PactPay checks this limit again right before releasing payment.</p>
                  </div>
                </div>

                <div style={{ marginTop: 18 }}>
                  {otherRules.map((rule) => (
                    <div className="pp-rule" key={rule.id}>
                      <span className={`pp-badge ${rule.severity === "hard" ? "pp-badge-info" : "pp-badge-neutral"}`}>{rule.severity === "hard" ? "Must" : "Nice"}</span>
                      <div>
                        <p className="pp-rule-text">{rule.description}</p>
                      </div>
                      <div className="pp-row" style={{ gap: 4 }}>
                        <div className="pp-seg" role="group" aria-label={`Importance of: ${rule.description}`}>
                          <button type="button" aria-pressed={rule.severity === "hard"} onClick={() => updateRule(rule.id, { severity: "hard" })}>Must</button>
                          <button type="button" aria-pressed={rule.severity === "soft"} onClick={() => updateRule(rule.id, { severity: "soft" })}>Nice to have</button>
                        </div>
                        <button type="button" className="pp-x" onClick={() => removeRule(rule.id)} aria-label={`Remove rule: ${rule.description}`}>×</button>
                      </div>
                    </div>
                  ))}
                  <div className="pp-rule">
                    <span className="pp-badge pp-badge-info">Must</span>
                    <p className="pp-rule-text">Priced in {currency}</p>
                    <span />
                  </div>
                </div>

                {(compilation.assumptions.length > 0 || compilation.unverifiedRequirements.length > 0) && (
                  <div className="pp-callout pp-callout-info pp-small" style={{ marginTop: 14 }}>
                    {compilation.assumptions.map((item) => <p key={item}>{item}</p>)}
                    {compilation.unverifiedRequirements.length > 0 && <p style={{ marginTop: 6 }}>Not checkable yet from catalog data: {compilation.unverifiedRequirements.join("; ")}.</p>}
                  </div>
                )}

                <fieldset className="pp-auto" style={{ marginTop: 22 }}>
                  <legend className="pp-label" style={{ marginBottom: 4 }}>How much should your agent do on its own?</legend>
                  <p className="pp-tiny pp-muted" style={{ marginBottom: 10 }}>Your rules stay locked in every mode. This only decides who clicks.</p>
                  {(["ASK_ALWAYS", "ASK_ABOVE", "WITHIN_RULES"] as AutonomyMode[]).map((mode) => {
                    const info = describeAutonomy(mode === "ASK_ABOVE" ? { mode, limitUsd: Number(autonomyLimit) > 0 ? Number(autonomyLimit) : 50 } : { mode, limitUsd: null });
                    return (
                      <label className="pp-auto-option" data-selected={autonomyMode === mode} key={mode}>
                        <input type="radio" name="autonomy" checked={autonomyMode === mode} onChange={() => setAutonomyMode(mode)} />
                        <span>
                          <strong>{mode === "ASK_ABOVE" ? "Ask me above a limit" : info.title}{mode === "ASK_ABOVE" && <span className="pp-badge pp-badge-good" style={{ marginLeft: 8 }}>Recommended</span>}</strong>
                          <span className="pp-small pp-muted" style={{ display: "block" }}>{info.detail}</span>
                          {mode === "ASK_ABOVE" && autonomyMode === "ASK_ABOVE" && (
                            <span className="pp-money-input" style={{ marginTop: 8, maxWidth: 190 }}>
                              <span>$</span>
                              <input aria-label="The most the agent may handle on its own, in dollars" inputMode="decimal" value={autonomyLimit} onChange={(event) => setAutonomyLimit(event.target.value)} />
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>

                {error && <p className="pp-callout pp-callout-bad" role="alert" style={{ marginTop: 14 }}>{error}</p>}
                <button type="button" className="pp-btn pp-btn-primary pp-btn-block" style={{ marginTop: 18 }} onClick={approveAndFindOffers} disabled={approving}>
                  {approving ? <><span className="pp-spinner" aria-hidden="true" /> Saving your approval…</> : autonomyMode === "ASK_ALWAYS" ? "Approve these rules and find offers" : "Approve and let the agent start"}
                </button>
                <p className="pp-tiny pp-muted" style={{ marginTop: 10, textAlign: "center" }}>
                  By approving you accept test mode: PayPal Sandbox money, fixed test shipping and tax, and no store order. The agent can never change these rules, and the same safety gate checks every payment in every mode.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      <section className="pp-how" aria-label="How PactPay works">
        <div className="pp-how-item"><div className="pp-how-n">1</div><h3 className="pp-h3">You set the rules</h3><p className="pp-muted pp-small" style={{ marginTop: 6 }}>Budget, must-haves and preferences, in plain words. You approve them, and they&apos;re locked on our server.</p></div>
        <div className="pp-how-item"><div className="pp-how-n">2</div><h3 className="pp-h3">Your payment is held</h3><p className="pp-muted pp-small" style={{ marginTop: 6 }}>The agent finds a real offer. PayPal holds the amount. Nothing has been charged yet.</p></div>
        <div className="pp-how-item"><div className="pp-how-n">3</div><h3 className="pp-h3">Released only if it still matches</h3><p className="pp-muted pp-small" style={{ marginTop: 6 }}>Right before release, PactPay re-checks the seller&apos;s current offer. If anything slipped, the hold is cancelled.</p></div>
      </section>

      <p className="pp-footnote">
        PactPay runs in test mode. Offers come from a live product catalog (Channel3). Payments use PayPal Sandbox test money, and shipping and tax are fixed test values, so no store order is placed and no real money moves.
      </p>
    </AppShell>
  );
}
