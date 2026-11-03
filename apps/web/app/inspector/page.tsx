"use client";

import { useEffect, useState } from "react";
import type { PurchasePact } from "@pactpay/pact-core";
import type { Inspection, InspectionOutcome } from "@pactpay/pact-core/checkout-inspection";
import { INSPECTION_DEMO_RULES, INSPECTION_SAMPLES } from "@pactpay/pact-core/inspection-samples";
import AppShell from "../components/AppShell";

type Reader = { provider: string; model: string; modelLabel: string; openWeights: boolean; ms: number; tokens: number | null };
type Result = { inspection: Inspection; readers: Reader[]; crossModel: boolean; rulesSource: "approved" | "demo"; attached: { id: string } | null };
type RulesMode = "demo" | "approved";
type SuiteRow = { id: string; title: string; expected: InspectionOutcome; got: InspectionOutcome | "ERROR"; ms: number };

const OUTCOME_LABEL: Record<InspectionOutcome | "ERROR", string> = { SAFE_TO_PAY: "Safe to pay", DO_NOT_PAY: "Do not pay", CANNOT_VERIFY: "Can't verify", ERROR: "Error" };

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(blob);
  });
}

export default function InspectorPage() {
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [pact, setPact] = useState<PurchasePact | null>(null);
  const [mode, setMode] = useState<RulesMode>("demo");
  const [image, setImage] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [suite, setSuite] = useState<SuiteRow[] | null>(null);
  const [suiteBusy, setSuiteBusy] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const tx = new URLSearchParams(window.location.search).get("tx");
      if (tx && /^[0-9a-f-]{36}$/i.test(tx)) { setOrderId(tx); setMode("approved"); }
    } catch { /* no query string */ }
    try {
      const a = window.sessionStorage.getItem("pactpay.activeApproval.v1");
      const p = window.sessionStorage.getItem("pactpay.activePact.v1");
      const parsed = a ? JSON.parse(a) as { approvalId?: unknown } : null;
      if (parsed && typeof parsed.approvalId === "string") setApprovalId(parsed.approvalId);
      if (p) setPact(JSON.parse(p) as PurchasePact);
    } catch { /* nothing approved yet */ }
  }, []);

  async function call(imageUrl: string, rulesMode: RulesMode): Promise<Result> {
    const response = await fetch("/api/inspector/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rulesMode === "demo" ? { rules: "demo", image: imageUrl } : { approvalId, image: imageUrl, ...(orderId ? { transactionId: orderId } : {}) }),
    });
    const payload = await response.json() as Result & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "The inspection failed.");
    return payload;
  }

  async function pickSample(id: string, file: string, title: string) {
    setError(null); setResult(null);
    try {
      setImage(await toDataUrl(await (await fetch(file)).blob())); setLabel(title); setPicked(id);
    } catch { setError("Couldn't load that sample."); }
  }
  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError(null); setResult(null); setPicked(null);
    if (file.size > 3.5 * 1024 * 1024) { setError("Please use an image under 3.5 MB."); return; }
    try { setImage(await toDataUrl(file)); setLabel(file.name); } catch { setError("Couldn't read that file."); }
  }
  async function inspect() {
    if (!image || busy) return;
    setBusy(true); setError(null); setResult(null);
    try { setResult(await call(image, mode)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The inspection failed."); }
    finally { setBusy(false); }
  }
  async function runSuite() {
    if (suiteBusy) return;
    setSuiteBusy(true); setSuite([]); setError(null);
    const rows: SuiteRow[] = [];
    for (const sample of INSPECTION_SAMPLES) {
      const started = Date.now();
      try {
        const data = await call(await toDataUrl(await (await fetch(sample.file)).blob()), "demo");
        rows.push({ id: sample.id, title: sample.title, expected: sample.expected, got: data.inspection.outcome, ms: Date.now() - started });
      } catch { rows.push({ id: sample.id, title: sample.title, expected: sample.expected, got: "ERROR", ms: Date.now() - started }); }
      setSuite([...rows]);
    }
    setSuiteBusy(false);
  }

  const canUseApproved = Boolean(approvalId);
  const effectiveMode: RulesMode = orderId ? "approved" : mode === "approved" && canUseApproved ? "approved" : "demo";
  const tone = result?.inspection.outcome === "SAFE_TO_PAY" ? "good" : result?.inspection.outcome === "DO_NOT_PAY" ? "bad" : "warn";
  const correct = suite ? suite.filter((row) => row.got === row.expected).length : 0;

  return (
    <AppShell>
      <section className="pp-muse-hero">
        <p className="pp-eyebrow">Meta Muse Spark · vision</p>
        <h1>Look at the real checkout page before any money moves.</h1>
        <p>A Muse model reads the screenshot twice, independently. Then fixed rules compare what it saw with what you approved, check that the charges add up, and flag any text aimed at an AI. <strong>The model reads. It never decides.</strong></p>
        <div className="pp-muse-pills"><span>Two independent readings</span><span>Hidden-fee arithmetic</span><span>Prompt-injection scan</span><span>Unknown never means safe</span></div>
      </section>

      {orderId && (
        <div className="pp-callout pp-callout-warn" style={{ marginTop: 18 }}>
          <p style={{ fontWeight: 700 }}>You are inspecting the checkout for a real order.</p>
          <p className="pp-small" style={{ marginTop: 4 }}>This verdict is attached to the order. When settlement runs, PactPay will <strong>refuse to capture and void the hold</strong> unless it says Safe to pay. {canUseApproved ? "" : "Approve your rules on the Shop page in this browser first."} <a href={`/order/${orderId}`}>Back to the order</a></p>
        </div>
      )}

      <div className="pp-split" style={{ marginTop: 24 }}>
        <section className="pp-card" aria-labelledby="pick-title">
          <h2 className="pp-h3" id="pick-title">1 · Choose a checkout page</h2>
          <p className="pp-small pp-muted" style={{ margin: "4px 0 12px" }}>Try a sample, or upload a screenshot of any checkout page.</p>
          <div className="pp-sample-grid">
            {INSPECTION_SAMPLES.map((sample) => (
              <button key={sample.id} type="button" className="pp-sample" aria-pressed={picked === sample.id} onClick={() => void pickSample(sample.id, sample.file, sample.title)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sample.file} alt="" loading="lazy" />
                <strong>{sample.title}</strong><span>{sample.hint}</span>
              </button>
            ))}
          </div>
          <label className="pp-label" htmlFor="upload" style={{ marginTop: 16 }}>Or upload a screenshot</label>
          <input id="upload" className="pp-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void pickFile(event.target.files?.[0])} />

          <p className="pp-label" style={{ marginTop: 18 }}>Check it against</p>
          <div className="pp-seg" role="group" aria-label="Which rules">
            <button type="button" aria-pressed={effectiveMode === "demo"} onClick={() => setMode("demo")} disabled={Boolean(orderId)}>Demo rules</button>
            <button type="button" aria-pressed={effectiveMode === "approved"} onClick={() => setMode("approved")} disabled={!canUseApproved} title={canUseApproved ? "" : "Approve your rules on the Shop page first"}>My approved rules</button>
          </div>
          <ul className="pp-small" style={{ margin: "10px 0 0", paddingLeft: 18 }}>
            {effectiveMode === "approved" && pact
              ? pact.constraints.filter((rule) => rule.severity === "hard").map((rule) => <li key={rule.id}>{rule.description}</li>)
              : INSPECTION_DEMO_RULES.map((rule) => <li key={rule.id}>{rule.label}</li>)}
          </ul>
          {!canUseApproved && <p className="pp-tiny pp-muted" style={{ marginTop: 8 }}>Want it checked against your own rules? <a href="/">Set them on the Shop page</a> first.</p>}
        </section>

        <section className="pp-card" aria-labelledby="inspect-title">
          <h2 className="pp-h3" id="inspect-title">2 · Inspect it</h2>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={`Checkout page: ${label}`} style={{ width: "100%", borderRadius: 12, border: "1px solid var(--pp-line)", marginTop: 10 }} />
          ) : <p className="pp-muted" style={{ marginTop: 10 }}>Pick a sample or upload a screenshot to begin.</p>}
          <button type="button" className="pp-btn pp-btn-primary pp-btn-block" style={{ marginTop: 14 }} onClick={() => void inspect()} disabled={!image || busy || suiteBusy}>
            {busy ? <><span className="pp-spinner" aria-hidden="true" /> Muse is reading the page twice…</> : "Inspect this checkout"}
          </button>
          {error && <p className="pp-callout pp-callout-bad" role="alert" style={{ marginTop: 12 }}>{error}</p>}
        </section>
      </div>

      {result && (
        <section className={`pp-result pp-result-${tone} pp-enter`} style={{ marginTop: 24 }} aria-live="polite">
          <h1>{result.inspection.headline}</h1>
          {result.inspection.reasons.length > 0 && <ul style={{ margin: "14px 0 0", paddingLeft: 20, display: "grid", gap: 6 }}>{result.inspection.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table className="pp-receipt">
              <thead><tr><th>Rule</th><th>Approved</th><th>The page shows</th><th>Result</th></tr></thead>
              <tbody>
                {result.inspection.rows.map((row) => (
                  <tr key={row.ruleId}><td>{row.label}</td><td className="pp-num">{row.expected}</td><td className="pp-num">{row.observed}</td>
                    <td><span className={`pp-badge ${row.status === "pass" ? "pp-badge-good" : row.status === "fail" ? "pp-badge-bad" : "pp-badge-warn"}`}>{row.status.toUpperCase()}</span></td></tr>
                ))}
                <tr><td>The charges add up to the total</td><td>itemized lines = total</td><td className="pp-num">{result.inspection.arithmetic.checked ? `${result.inspection.arithmetic.itemsSum?.toFixed(2)} vs ${result.inspection.arithmetic.statedTotal?.toFixed(2)}` : "not enough lines"}</td>
                  <td><span className={`pp-badge ${!result.inspection.arithmetic.checked || result.inspection.arithmetic.incomplete ? "pp-badge-warn" : result.inspection.arithmetic.ok ? "pp-badge-good" : "pp-badge-bad"}`}>{!result.inspection.arithmetic.checked || result.inspection.arithmetic.incomplete ? "UNKNOWN" : result.inspection.arithmetic.ok ? "PASS" : "FAIL"}</span></td></tr>
                <tr><td>Nothing on the page is aimed at an AI</td><td>no instructions</td><td>{result.inspection.injection.length === 0 ? "none found" : `found by ${result.inspection.injectionReaders.map((n) => `reader ${n}`).join(" and ")}`}</td>
                  <td><span className={`pp-badge ${result.inspection.injection.length === 0 ? "pp-badge-good" : "pp-badge-bad"}`}>{result.inspection.injection.length === 0 ? "PASS" : "FAIL"}</span></td></tr>
                <tr><td>Two independent readings agree</td><td>same total, price, currency</td><td>{result.inspection.readingsAgree === null ? "n/a" : result.inspection.readingsAgree ? "agree" : "disagree"}</td>
                  <td><span className={`pp-badge ${result.inspection.readingsAgree ? "pp-badge-good" : "pp-badge-warn"}`}>{result.inspection.readingsAgree ? "PASS" : "UNKNOWN"}</span></td></tr>
              </tbody>
            </table>
          </div>
          {result.inspection.injection.length > 0 && (
            <div className="pp-callout pp-callout-bad" style={{ marginTop: 14, background: "rgba(255,255,255,.7)" }}>
              <p style={{ fontWeight: 700 }}>Text found on the page that is aimed at an AI</p>
              {result.inspection.injection.slice(0, 3).map((finding) => <p className="pp-small" key={finding.rule} style={{ marginTop: 6 }}>“{finding.excerpt}”</p>)}
            </div>
          )}
          <div className="pp-reader">
            {result.readers.map((reader, index) => (
              <span key={index}>Reader {index + 1}: {reader.modelLabel}{reader.openWeights ? " · open weights" : " · Meta Model API"} · {(reader.ms / 1000).toFixed(1)}s{reader.tokens ? ` · ${reader.tokens.toLocaleString()} tokens` : ""}</span>
            ))}
            <span>{result.crossModel ? "Two different Meta models agreed independently" : "Two independent reads by one model"}</span>
          </div>
          <p className="pp-small" style={{ marginTop: 12 }}>The decision above was made by fixed rules, not by the model.{result.attached ? " It is now attached to your order: settlement will honor it." : ""}</p>
        </section>
      )}

      <section className="pp-card" style={{ marginTop: 24 }} aria-labelledby="suite-title">
        <div className="pp-card-head">
          <div>
            <h2 className="pp-h3" id="suite-title">Prove it: run all {INSPECTION_SAMPLES.length} samples</h2>
            <p className="pp-small pp-muted" style={{ marginTop: 4 }}>Sends each sample to Muse and checks the verdict against what it must be: one safe, three hostile or over-budget, one unreadable.</p>
          </div>
          <button type="button" className="pp-btn pp-btn-secondary" onClick={() => void runSuite()} disabled={suiteBusy || busy}>
            {suiteBusy ? <><span className="pp-spinner pp-spinner-dark" aria-hidden="true" /> Running…</> : suite ? "Run again" : "Run the suite"}
          </button>
        </div>
        {suite && suite.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="pp-receipt pp-suite">
              <thead><tr><th>Checkout page</th><th>Must be</th><th>Muse + gate said</th><th>Result</th></tr></thead>
              <tbody>
                {suite.map((row) => (
                  <tr key={row.id}><td>{row.title}</td><td>{OUTCOME_LABEL[row.expected]}</td><td>{OUTCOME_LABEL[row.got]}</td>
                    <td><span className={`pp-badge ${row.got === row.expected ? "pp-badge-good" : "pp-badge-bad"}`}>{row.got === row.expected ? "CORRECT" : "MISSED"}</span></td></tr>
                ))}
              </tbody>
            </table>
            {!suiteBusy && <p className="pp-small" style={{ marginTop: 12, fontWeight: 700 }}>{correct} of {suite.length} verdicts correct.</p>}
          </div>
        )}
      </section>
    </AppShell>
  );
}
