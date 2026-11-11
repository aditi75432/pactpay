"use client";

import { useEffect, useState, type CSSProperties } from "react";

type ScenarioId =
  | "compliant"
  | "budget_overrun"
  | "ram_downgrade"
  | "delivery_slip"
  | "return_policy_downgrade"
  | "stale_evidence"
  | "conflicting_evidence"
  | "currency_mismatch"
  | "merchant_instruction";

type ConstraintResult = {
  constraintId: string;
  severity?: "hard" | "soft";
  status: "pass" | "fail" | "unknown";
  actual?: string | number | boolean;
  evidenceIds: string[];
  reason: string;
};

type EvaluationPayload = {
  runId: string;
  scenario: { id: ScenarioId; title: string; description: string; securityNote?: string };
  offer: {
    id: string;
    currency: string;
    total: number;
    shippingFee?: number | null;
    deliveryDate?: string | null;
    returnWindowDays?: number | null;
    attributes: Record<string, string | number | boolean | null | undefined>;
  };
  verification: {
    verifiedAt: string;
    evidenceFresh: boolean;
    evidenceAttributable: boolean;
    securityClear: boolean;
    results: ConstraintResult[];
  };
  summary: {
    decision: "capture" | "block";
    reason: string;
    hardPasses: number;
    hardFailures: number;
    softFailures: number;
  };
  mode: string;
  paymentAction: "NONE";
  capturePerformedByPactPay: false;
  note: string;
};

type RunRow = {
  id: string;
  scenario_id: string;
  pact_id: string;
  decision: "capture" | "block";
  decision_reason: string;
  security_clear: boolean;
  evidence_fresh: boolean;
  evidence_attributable: boolean;
  created_at: string;
};

const SCENARIOS: Array<{ id: ScenarioId; title: string; detail: string; kind: "pass" | "attack" }> = [
  { id: "compliant", title: "Compliant offer", detail: "All hard conditions and evidence gates pass.", kind: "pass" },
  { id: "budget_overrun", title: "Budget overrun", detail: "Total price rises above $900.", kind: "attack" },
  { id: "ram_downgrade", title: "Product downgrade", detail: "RAM changes from 16 GB to 8 GB.", kind: "attack" },
  { id: "delivery_slip", title: "Delivery deadline slip", detail: "Estimated delivery moves past the deadline.", kind: "attack" },
  { id: "return_policy_downgrade", title: "Return policy downgrade", detail: "Returns fall from 30 days to 7 days.", kind: "attack" },
  { id: "stale_evidence", title: "Expired evidence", detail: "Offer data remains plausible, but its evidence has expired.", kind: "attack" },
  { id: "conflicting_evidence", title: "Conflicting evidence", detail: "Fresh RAM evidence disagrees about the actual offer.", kind: "attack" },
  { id: "currency_mismatch", title: "Currency mismatch", detail: "Offer currency differs from the pact currency.", kind: "attack" },
  { id: "merchant_instruction", title: "Untrusted merchant instruction", detail: "A simulated security finding activates fail-closed behavior.", kind: "attack" },
];

function badgeStyle(status: "pass" | "fail" | "unknown" | "capture" | "block") {
  if (status === "pass" || status === "capture") return { color: "#9af0c2", background: "#123b2b", borderColor: "#276449" };
  if (status === "fail" || status === "block") return { color: "#ffb8b8", background: "#451f26", borderColor: "#7f343f" };
  return { color: "#ffd891", background: "#3d301b", borderColor: "#705526" };
}

function shortDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function PactLabPage() {
  const [selected, setSelected] = useState<ScenarioId>("compliant");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EvaluationPayload | null>(null);
  const [history, setHistory] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refreshHistory() {
    try {
      const response = await fetch("/api/pacts/runs", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && Array.isArray(payload.runs)) setHistory(payload.runs as RunRow[]);
    } catch {
      // Keep the evaluation usable if history is temporarily unavailable.
    }
  }

  useEffect(() => { void refreshHistory(); }, []);

  async function evaluateScenario() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/pacts/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: selected }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Evaluation failed.");
      setResult(payload as EvaluationPayload);
      await refreshHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected evaluation error.");
    } finally {
      setRunning(false);
    }
  }

  const selectedScenario = SCENARIOS.find((item) => item.id === selected)!;
  const card: CSSProperties = { background: "#0e1c19", border: "1px solid #263e37", borderRadius: 18, padding: 20 };
  const muted: CSSProperties = { color: "#a5b8b0" };
  const buttonBase: CSSProperties = { cursor: "pointer", borderRadius: 10, padding: "10px 12px", border: "1px solid #34544a", textAlign: "left", width: "100%", color: "#e7f3ed" };

  return (
    <main style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 15% 0%, #16372d 0%, #091311 48%, #07100e 100%)", color: "#edf7f2", fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif", padding: "32px 20px 64px" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 44 }}>
          <a href="/" aria-label="PactPay home" style={{ display: "inline-flex" }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/pactpay-logo-light.svg" alt="PactPay" height={32} style={{ height: 32, width: "auto" }} /></a>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ border: "1px solid #705526", color: "#ffd891", borderRadius: 100, padding: "6px 10px", fontSize: 11, letterSpacing: 1.2, fontWeight: 800 }}>SIMULATED COMMERCE DATA</span>
            <a href="/" style={{ color: "#a5b8b0", fontSize: 13 }}>Payment sandbox ↗</a>
          </div>
        </header>

        <section style={{ maxWidth: 850, marginBottom: 30 }}>
          <p style={{ color: "#7fe2ab", fontSize: 12, letterSpacing: 2.2, fontWeight: 800, marginBottom: 14 }}>M0.3 · POLICY LAB</p>
          <h1 style={{ fontSize: "clamp(34px, 5vw, 58px)", lineHeight: 1.02, letterSpacing: -2, margin: 0 }}>The pact is the rule.<br /><span style={{ color: "#7fe2ab" }}>Evidence is the proof.</span></h1>
          <p style={{ ...muted, maxWidth: 720, fontSize: 16, lineHeight: 1.7, marginTop: 22 }}>Run deterministic checks against a simulated laptop offer. PactPay evaluates hard constraints, freshness, evidence provenance, conflicting claims, and a security gate. No PayPal transaction is changed by this lab.</p>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))", gap: 18, alignItems: "start" }}>
          <section style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 15 }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>Choose a scenario</h2>
              <span style={{ ...muted, fontSize: 12 }}>9 fixtures</span>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {SCENARIOS.map((scenario) => {
                const active = selected === scenario.id;
                return (
                  <button key={scenario.id} onClick={() => setSelected(scenario.id)} style={{ ...buttonBase, background: active ? "#17392d" : "#101f1b", borderColor: active ? "#55b982" : "#263e37", boxShadow: active ? "inset 3px 0 #7fe2ab" : "none" }}>
                    <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: 13 }}>{scenario.title}</strong>
                      <span style={{ color: scenario.kind === "pass" ? "#7fe2ab" : "#ffb8b8", fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>{scenario.kind === "pass" ? "BASELINE" : "RED TEAM"}</span>
                    </span>
                    <span style={{ display: "block", color: "#a5b8b0", fontSize: 12, lineHeight: 1.5, marginTop: 5 }}>{scenario.detail}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: "#0a1512", border: "1px solid #263e37" }}>
              <p style={{ margin: "0 0 6px", color: "#7fe2ab", fontSize: 11, letterSpacing: 1.4, fontWeight: 800 }}>SELECTED FIXTURE</p>
              <strong>{selectedScenario.title}</strong>
              <p style={{ ...muted, fontSize: 12, lineHeight: 1.5, marginBottom: 0 }}>{selectedScenario.detail}</p>
            </div>
            <button onClick={evaluateScenario} disabled={running} style={{ width: "100%", marginTop: 14, padding: "14px 16px", border: "1px solid #8df0b9", borderRadius: 11, background: running ? "#315141" : "#7fe2ab", color: "#07130e", fontWeight: 900, fontSize: 14, cursor: running ? "wait" : "pointer" }}>
              {running ? "Evaluating policy…" : "Evaluate pact →"}
            </button>
            {error && <p role="alert" style={{ color: "#ffb8b8", fontSize: 13, marginBottom: 0 }}>{error}</p>}
          </section>

          <section style={{ ...card, minHeight: 420 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>Decision trace</h2>
              {result && <span style={{ ...badgeStyle(result.summary.decision), border: "1px solid", borderRadius: 100, padding: "6px 9px", fontSize: 10, letterSpacing: 1, fontWeight: 900 }}>{result.summary.decision === "block" ? "POLICY BLOCK" : "POLICY PASS"}</span>}
            </div>
            {!result ? (
              <div style={{ border: "1px dashed #34544a", borderRadius: 14, padding: 26, textAlign: "center", marginTop: 30 }}>
                <div style={{ color: "#7fe2ab", fontSize: 28, marginBottom: 10 }}>◈</div>
                <strong>Ready to evaluate</strong>
                <p style={{ ...muted, fontSize: 13, lineHeight: 1.6 }}>Choose a baseline or failure scenario, then run the evaluator to see the individual constraint results.</p>
              </div>
            ) : (
              <>
                <p style={{ margin: "0 0 7px", fontSize: 21, fontWeight: 850 }}>{result.summary.decision === "block" ? "Settlement prerequisites blocked" : "Hard constraints satisfied"}</p>
                <p style={{ ...muted, fontSize: 12, lineHeight: 1.5, marginTop: 0 }}>{result.scenario.description}</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, margin: "18px 0" }}>
                  {[
                    ["Hard pass", result.summary.hardPasses, "#7fe2ab"],
                    ["Hard block", result.summary.hardFailures, "#ffb8b8"],
                    ["Soft misses", result.summary.softFailures, "#ffd891"],
                  ].map(([label, value, color]) => <div key={String(label)} style={{ background: "#0a1512", border: "1px solid #263e37", borderRadius: 12, padding: 12 }}><div style={{ color: String(color), fontSize: 22, fontWeight: 900 }}>{value}</div><div style={{ ...muted, fontSize: 11 }}>{label}</div></div>)}
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {result.verification.results.map((item) => (
                    <div key={item.constraintId} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 0.65fr) minmax(0, 2fr) auto", gap: 10, alignItems: "start", padding: "11px 0", borderBottom: "1px solid #20352e" }}>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>{item.constraintId.replaceAll("-", " ")}</div>
                      <div><div style={{ ...muted, fontSize: 12, lineHeight: 1.5 }}>{item.reason}</div>{item.evidenceIds.length > 0 && <div style={{ color: "#6e8b7e", fontSize: 10, marginTop: 4 }}>{item.evidenceIds.length} evidence record(s)</div>}</div>
                      <span style={{ ...badgeStyle(item.status), border: "1px solid", borderRadius: 6, padding: "4px 6px", fontSize: 9, fontWeight: 900, letterSpacing: 0.6 }}>{item.status.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 18, padding: 14, background: "#0a1512", border: "1px solid #263e37", borderRadius: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><span style={muted}>Evidence fresh</span><strong style={{ color: result.verification.evidenceFresh ? "#7fe2ab" : "#ffb8b8" }}>{result.verification.evidenceFresh ? "YES" : "NO"}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 8 }}><span style={muted}>Evidence attributable</span><strong style={{ color: result.verification.evidenceAttributable ? "#7fe2ab" : "#ffb8b8" }}>{result.verification.evidenceAttributable ? "YES" : "NO"}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 8 }}><span style={muted}>Security gate</span><strong style={{ color: result.verification.securityClear ? "#7fe2ab" : "#ffb8b8" }}>{result.verification.securityClear ? "CLEAR" : "BLOCKED"}</strong></div>
                  <p style={{ color: "#7fe2ab", fontSize: 12, lineHeight: 1.5, marginBottom: 0, marginTop: 14 }}>Payment action: NONE. Even a policy pass does not call PayPal or execute capture.</p>
                </div>
                {result.scenario.securityNote && <p style={{ color: "#ffd891", fontSize: 12, lineHeight: 1.6 }}>{result.scenario.securityNote}</p>}
                <p style={{ ...muted, fontSize: 10, overflowWrap: "anywhere" }}>Run ID: {result.runId} · Verified: {shortDate(result.verification.verifiedAt)}</p>
              </>
            )}
          </section>
        </div>

        <section style={{ ...card, marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div><h2 style={{ margin: "0 0 5px", fontSize: 16 }}>Recent evaluation history</h2><p style={{ ...muted, margin: 0, fontSize: 12 }}>Persisted Policy Lab runs from this local database.</p></div>
            <button onClick={() => void refreshHistory()} style={{ background: "transparent", color: "#7fe2ab", border: "1px solid #34544a", borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}>Refresh history</button>
          </div>
          {history.length === 0 ? <p style={muted}>No saved runs yet. Evaluate a scenario to create the first run.</p> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620, fontSize: 12 }}>
                <thead><tr style={{ color: "#78968a", textAlign: "left" }}>{["Scenario", "Decision", "Evidence", "Run ID", "Created"].map((label) => <th key={label} style={{ padding: "10px 8px", borderBottom: "1px solid #34544a", fontWeight: 800 }}>{label}</th>)}</tr></thead>
                <tbody>{history.map((row) => <tr key={row.id}>
                  <td style={{ padding: "11px 8px", borderBottom: "1px solid #20352e" }}>{SCENARIOS.find((item) => item.id === row.scenario_id)?.title ?? row.scenario_id}</td>
                  <td style={{ padding: "11px 8px", borderBottom: "1px solid #20352e" }}><span style={{ ...badgeStyle(row.decision), border: "1px solid", borderRadius: 6, padding: "4px 6px", fontSize: 9, fontWeight: 900 }}>{row.decision === "block" ? "BLOCK" : "POLICY PASS"}</span></td>
                  <td style={{ padding: "11px 8px", borderBottom: "1px solid #20352e", color: row.evidence_fresh && row.evidence_attributable ? "#7fe2ab" : "#ffd891" }}>{row.evidence_fresh ? "fresh" : "stale/unknown"} · {row.evidence_attributable ? "attributed" : "unattributed"}</td>
                  <td style={{ padding: "11px 8px", borderBottom: "1px solid #20352e", fontFamily: "ui-monospace, monospace", color: "#a5b8b0" }}>{row.id.slice(0, 8)}…</td>
                  <td style={{ padding: "11px 8px", borderBottom: "1px solid #20352e", color: "#a5b8b0" }}>{shortDate(row.created_at)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </section>

        <footer style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginTop: 22, ...muted, fontSize: 11, lineHeight: 1.6 }}>
          <span>Simulated offers and evidence · Deterministic evaluation · No capture endpoint</span>
          <span>Hard rules are enforced in code, not in the language model.</span>
        </footer>
      </div>
    </main>
  );
}
