"use client";

import type { Inspection } from "@pactpay/pact-core/checkout-inspection";

export type InspectionReader = { provider: string; model: string; modelLabel: string; openWeights: boolean; ms: number; tokens: number | null };
export type InspectionPayload = { inspection: Inspection; readers: InspectionReader[]; crossModel: boolean; rulesSource: "approved" | "demo"; attached: { id: string } | null };

/** The verdict, rule by rule. Shared by the Shop workflow and the lab. The decision is made by fixed rules, never the model. */
export default function InspectionResult({ result, attachedNote }: { result: InspectionPayload; attachedNote?: string }) {
  const { inspection } = result;
  const tone = inspection.outcome === "SAFE_TO_PAY" ? "good" : inspection.outcome === "DO_NOT_PAY" ? "bad" : "warn";
  const arithmeticUnknown = !inspection.arithmetic.checked || inspection.arithmetic.incomplete;
  return (
    <div className={`pp-result pp-result-${tone} pp-enter`} aria-live="polite">
      <h3 className="pp-h2" style={{ margin: 0 }}>{inspection.headline}</h3>
      {inspection.reasons.length > 0 && <ul style={{ margin: "12px 0 0", paddingLeft: 20, display: "grid", gap: 6 }}>{inspection.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
      <div style={{ overflowX: "auto", marginTop: 14 }}>
        <table className="pp-receipt">
          <thead><tr><th>Check</th><th>Approved</th><th>The page shows</th><th>Result</th></tr></thead>
          <tbody>
            {inspection.rows.map((row) => (
              <tr key={row.ruleId}><td>{row.label}</td><td className="pp-num">{row.expected}</td><td className="pp-num">{row.observed}</td>
                <td><span className={`pp-badge ${row.status === "pass" ? "pp-badge-good" : row.status === "fail" ? "pp-badge-bad" : "pp-badge-warn"}`}>{row.status.toUpperCase()}</span></td></tr>
            ))}
            <tr><td>The charges add up to the total</td><td>itemized lines = total</td>
              <td className="pp-num">{inspection.arithmetic.checked ? `${inspection.arithmetic.itemsSum?.toFixed(2)} vs ${inspection.arithmetic.statedTotal?.toFixed(2)}` : "not enough lines"}</td>
              <td><span className={`pp-badge ${arithmeticUnknown ? "pp-badge-warn" : inspection.arithmetic.ok ? "pp-badge-good" : "pp-badge-bad"}`}>{arithmeticUnknown ? "UNKNOWN" : inspection.arithmetic.ok ? "PASS" : "FAIL"}</span></td></tr>
            <tr><td>Nothing on the page is aimed at an AI</td><td>no instructions</td>
              <td>{inspection.injection.length === 0 ? "none found" : `found by ${inspection.injectionReaders.map((n) => `reader ${n}`).join(" and ")}`}</td>
              <td><span className={`pp-badge ${inspection.injection.length === 0 ? "pp-badge-good" : "pp-badge-bad"}`}>{inspection.injection.length === 0 ? "PASS" : "FAIL"}</span></td></tr>
            <tr><td>Two independent readings agree</td><td>same total, price, currency</td>
              <td>{inspection.readingsAgree === null ? "n/a" : inspection.readingsAgree ? "agree" : "disagree"}</td>
              <td><span className={`pp-badge ${inspection.readingsAgree ? "pp-badge-good" : "pp-badge-warn"}`}>{inspection.readingsAgree ? "PASS" : "UNKNOWN"}</span></td></tr>
          </tbody>
        </table>
      </div>
      {inspection.injection.length > 0 && (
        <div className="pp-callout pp-callout-bad" style={{ marginTop: 14, background: "rgba(255,255,255,.7)" }}>
          <p style={{ fontWeight: 700 }}>Text found on the page that is aimed at an AI</p>
          {inspection.injection.slice(0, 1).map((finding) => <p className="pp-small" key={finding.rule} style={{ marginTop: 6 }}>“{finding.excerpt}”</p>)}
        </div>
      )}
      <div className="pp-reader">
        {result.readers.map((reader, index) => (
          <span key={index}>Reader {index + 1}: {reader.modelLabel}{reader.openWeights ? " · open weights" : " · Meta Model API"} · {(reader.ms / 1000).toFixed(1)}s{reader.tokens ? ` · ${reader.tokens.toLocaleString()} tokens` : ""}</span>
        ))}
        <span>{result.crossModel ? "Two different Meta models read it independently" : "Two independent reads by one model"}</span>
      </div>
      <p className="pp-small" style={{ marginTop: 12 }}>The decision above was made by fixed rules, not by the model.{attachedNote ? ` ${attachedNote}` : ""}</p>
    </div>
  );
}
