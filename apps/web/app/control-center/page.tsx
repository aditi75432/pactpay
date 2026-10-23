"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AllCommunityModule, themeQuartz, type ColDef } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";

type TransactionRow = {
  transaction_id: string;
  status: string;
  amount: string;
  currency: string;
  order_id: string | null;
  order_status: string | null;
  authorization_id: string | null;
  authorization_status: string | null;
  capture_id: string | null;
  capture_status: string | null;
  void_status: string | null;
  offer_snapshot_id: string | null;
  policy_run_id: string | null;
  pact_hash: string | null;
  capture_origin: string | null;
  autonomy_label?: string | null;
  attempt_no?: number;
  offer_title?: string | null;
  offer_domain?: string | null;
  injected_change?: string | null;
  failed_rules?: string | null;
  evidence_state?: string;
  captured_amount?: string;
  outcome?: string;
  created_at: string;
  authorized_at: string | null;
  captured_at: string | null;
  voided_at: string | null;
  last_error_message: string | null;
};

type PolicyRunRow = {
  id: string;
  scenario_id: string;
  pact_id: string;
  decision: "capture" | "block";
  decision_reason: string;
  security_clear: boolean;
  evidence_fresh: boolean;
  evidence_attributable: boolean;
  created_at: string;
  offer_snapshot: Record<string, unknown>;
  verification_result: Record<string, unknown>;
  pact_snapshot: Record<string, unknown>;
  policy_hash: string | null;
};

type ControlCenterPayload = {
  transactions: TransactionRow[];
  policyRuns: PolicyRunRow[];
  generatedAt: string;
  scope?: "session" | "all";
  paymentAction: "NONE";
  capturePerformedByPactPay: false;
};

type Tab = "transactions" | "policy-runs";
type SelectedRow = { kind: "transaction"; row: TransactionRow } | { kind: "policy-run"; row: PolicyRunRow } | null;

const modules = [AllCommunityModule];
const gridTheme = themeQuartz.withParams({
  backgroundColor: "#0e1c19",
  foregroundColor: "#edf7f2",
  headerBackgroundColor: "#152b23",
  headerTextColor: "#a5b8b0",
  borderColor: "#28443a",
  accentColor: "#7fe2ab",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontSize: 13,
  spacing: 8,
});

function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function compactId(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function truthLabel(value: boolean): string {
  return value ? "Verified" : "Needs review";
}

function json(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? "—"; }
  catch { return "This record cannot be displayed as JSON."; }
}

const baseColDef: ColDef = { sortable: true, filter: true, resizable: true, minWidth: 115, flex: 1, suppressMovable: false };

type LineageEvent = { id: string; type: string; actor: string; at: string; hash: string; details: Array<[string, string]> };

/** The hash-chained event history of one transaction, loaded when a row is opened. */
function Lineage({ transactionId }: { transactionId: string }) {
  const [events, setEvents] = useState<LineageEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setEvents(null); setFailed(false);
    void fetch(`/api/control-center/lineage/${encodeURIComponent(transactionId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ events: LineageEvent[] }> : Promise.reject(new Error("unavailable")))
      .then((payload) => { if (!cancelled) setEvents(payload.events); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [transactionId]);
  return (
    <div style={{ marginTop: 18 }}>
      <p style={{ margin: "0 0 8px", color: "#a5b8b0", fontSize: 13 }}>Event lineage · each event is hash-chained to the one before it</p>
      {failed && <p style={{ color: "#ffb8b8", fontSize: 13 }}>The event history isn't available for this row.</p>}
      {!failed && events === null && <p style={{ color: "#7c9387", fontSize: 13 }}>Loading events…</p>}
      {events && events.length === 0 && <p style={{ color: "#7c9387", fontSize: 13 }}>No events recorded.</p>}
      {events && events.length > 0 && (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {events.map((event) => (
            <li key={event.id} style={{ padding: "10px 12px", border: "1px solid #28443a", borderRadius: 10, background: "#091512" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ color: "#edf7f2", fontSize: 13 }}>{event.type.replace(/_/g, " ")}</strong>
                <span style={{ color: "#7c9387", fontSize: 12 }}>{dateTime(event.at)} · {event.actor} · #{event.hash}</span>
              </div>
              {event.details.length > 0 && <div style={{ marginTop: 6, color: "#a5b8b0", fontSize: 12, lineHeight: 1.6, overflowWrap: "anywhere" }}>{event.details.map(([key, value]) => `${key}: ${value}`).join(" · ")}</div>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function ControlCenterPage() {
  const [data, setData] = useState<ControlCenterPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("transactions");
  const [filterText, setFilterText] = useState("");
  const [selected, setSelected] = useState<SelectedRow>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/control-center", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load the Control Center.");
      setData(payload as ControlCenterPayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected Control Center error.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const transactionColumns = useMemo<ColDef<TransactionRow>[]>(() => [
    { field: "attempt_no", headerName: "Attempt", minWidth: 100, maxWidth: 110, valueFormatter: (p) => (p.value ? `#${p.value}` : "—") },
    { headerName: "Offer", minWidth: 250, valueGetter: (p) => (p.data?.offer_title ? `${p.data.offer_title} · ${p.data.offer_domain ?? ""}` : "—"), tooltipValueGetter: (p) => p.data?.offer_title ?? "" },
    { field: "transaction_id", headerName: "Transaction", minWidth: 165, valueFormatter: (p) => compactId(p.value) },
    { field: "outcome", headerName: "Outcome", minWidth: 220, cellStyle: (p) => ({ fontWeight: 800, color: String(p.value ?? "").startsWith("Captured") ? "#7fe2ab" : String(p.value ?? "").startsWith("Voided") ? "#ff9d8a" : String(p.value ?? "").startsWith("Needs") ? "#ffd28a" : "#bfe9d3" }) },
    { field: "captured_amount", headerName: "Captured", minWidth: 120, valueFormatter: (p) => `$${p.value ?? "0.00"}` },
    { field: "failed_rules", headerName: "Failed rules", minWidth: 280, valueFormatter: (p) => p.value ?? "—", tooltipField: "failed_rules", cellStyle: (p) => ({ color: p.value ? "#ff9d8a" : "#8aa99b" }) },
    { field: "evidence_state", headerName: "Evidence", minWidth: 160, cellStyle: (p) => ({ fontWeight: 700, color: p.value === "FRESH" ? "#7fe2ab" : p.value === "NOT CHECKED" ? "#8aa99b" : "#ffd28a" }) },
    { field: "injected_change", headerName: "Injected change", minWidth: 180, valueFormatter: (p) => p.value ?? "none", cellStyle: (p) => ({ color: p.value ? "#ffd28a" : "#8aa99b" }) },
    { field: "status", headerName: "Settlement", minWidth: 145, cellStyle: (p) => ({ fontWeight: 800, color: p.value === "CAPTURED" ? "#7fe2ab" : p.value === "VOIDED" || p.value === "POLICY_BLOCKED" ? "#ffb8b8" : p.value === "CAPTURE_REVIEW" || p.value === "VOID_REVIEW" || p.value === "AUTHORIZATION_REVIEW" ? "#ffd891" : "#edf7f2" }) },
    { field: "amount", headerName: "Amount", minWidth: 125, valueFormatter: (p) => `${p.data?.currency ?? ""} ${p.value ?? "—"}`.trim() },
    { field: "authorization_status", headerName: "Authorization", minWidth: 135 },
    { field: "capture_status", headerName: "Capture", minWidth: 120 },
    { field: "order_id", headerName: "PayPal order", minWidth: 155, valueFormatter: (p) => compactId(p.value) },
    { field: "autonomy_label", headerName: "Agent autonomy", minWidth: 190, valueFormatter: (p) => p.value ?? "—", cellStyle: (p) => ({ color: p.value === "Handles it within rules" ? "#7fe2ab" : p.value ? "#bfe9d3" : "#8aa99b", fontWeight: 700 }) },
    { field: "capture_origin", headerName: "Origin", minWidth: 140, valueFormatter: (p) => p.value === "PACTPAY_GATE" ? "PactPay gate" : p.value === "EXTERNAL_WEBHOOK" ? "PayPal webhook" : p.value ?? "—" },
    { field: "created_at", headerName: "Created", minWidth: 180, valueFormatter: (p) => dateTime(p.value) },
  ], []);

  const policyColumns = useMemo<ColDef<PolicyRunRow>[]>(() => [
    { field: "id", headerName: "Run", minWidth: 155, valueFormatter: (p) => compactId(p.value) },
    { field: "scenario_id", headerName: "Workflow / scenario", minWidth: 190 },
    { field: "decision", headerName: "Gate result", minWidth: 180, valueFormatter: (p) => p.value === "capture" ? "PASS · PRECONDITIONS" : "BLOCK", cellStyle: (p) => ({ fontWeight: 900, color: p.value === "capture" ? "#7fe2ab" : "#ffb8b8" }) },
    { field: "security_clear", headerName: "Security", minWidth: 120, valueFormatter: (p) => p.value ? "Clear" : "Hold", cellStyle: (p) => ({ color: p.value ? "#7fe2ab" : "#ffb8b8", fontWeight: 800 }) },
    { field: "evidence_fresh", headerName: "Evidence fresh", minWidth: 135, valueFormatter: (p) => p.value ? "Yes" : "No", cellStyle: (p) => ({ color: p.value ? "#7fe2ab" : "#ffd891" }) },
    { field: "evidence_attributable", headerName: "Evidence bound", minWidth: 140, valueFormatter: (p) => p.value ? "Yes" : "No", cellStyle: (p) => ({ color: p.value ? "#7fe2ab" : "#ffd891" }) },
    { field: "decision_reason", headerName: "Decision reason", minWidth: 250 },
    { field: "created_at", headerName: "Evaluated", minWidth: 180, valueFormatter: (p) => dateTime(p.value) },
  ], []);

  const allTransactions = data?.transactions ?? [];
  const [preset, setPreset] = useState<"all" | "captured" | "blocked" | "evidence" | "review" | "agent">("all");
  const matchesPreset = (tx: TransactionRow, which: typeof preset) =>
    which === "all" ? true
    : which === "captured" ? tx.status === "CAPTURED"
    : which === "blocked" ? ["VOIDED", "VOIDING", "POLICY_BLOCKED"].includes(tx.status)
    : which === "evidence" ? (tx.evidence_state !== undefined && tx.evidence_state !== "FRESH")
    : which === "review" ? ["CAPTURE_REVIEW", "VOID_REVIEW", "AUTHORIZATION_REVIEW", "FAILED"].includes(tx.status)
    : Boolean(tx.autonomy_label && tx.autonomy_label !== "Ask me every time");
  const transactions = allTransactions.filter((tx) => matchesPreset(tx, preset));
  const policyRuns = data?.policyRuns ?? [];
  const capturedCount = transactions.filter((tx) => tx.status === "CAPTURED" && tx.capture_status === "COMPLETED").length;
  const blockedCount = policyRuns.filter((run) => run.decision === "block").length;
  const reviewCount = transactions.filter((tx) => ["CAPTURE_REVIEW", "VOID_REVIEW", "AUTHORIZATION_REVIEW"].includes(tx.status)).length;
  const evidenceGaps = policyRuns.filter((run) => !run.evidence_fresh || !run.evidence_attributable || !run.security_clear).length;

  function selectTransaction(event: { data?: TransactionRow }) {
    if (event.data) setSelected({ kind: "transaction", row: event.data });
  }
  function selectPolicyRun(event: { data?: PolicyRunRow }) {
    if (event.data) setSelected({ kind: "policy-run", row: event.data });
  }

  return (
    <main style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 15% 0%, #16372d 0%, #091311 48%, #07100e 100%)", color: "#edf7f2", padding: "26px 20px 64px", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1440, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 38, paddingBottom: 18, borderBottom: "1px solid #28443a" }}>
          <a href="/" style={{ color: "#edf7f2", textDecoration: "none", fontWeight: 950, letterSpacing: 2 }}>PACTPAY <span style={{ color: "#7fe2ab" }}>///</span></a>
          <nav aria-label="Main navigation" style={{ display: "flex", gap: 17, flexWrap: "wrap", fontSize: 14 }}>
            <a href="/agent" style={{ color: "#a5b8b0" }}>Shopping Agent</a>
            <a href="/discover" style={{ color: "#a5b8b0" }}>Discovery</a>
            <a href="/evidence" style={{ color: "#a5b8b0" }}>Evidence Desk</a>
            <a href="/pact-lab" style={{ color: "#a5b8b0" }}>Policy Lab</a>
          </nav>
          <span style={{ border: "1px solid #3b624e", borderRadius: 999, padding: "8px 11px", fontSize: 11, color: "#7fe2ab", fontWeight: 900, letterSpacing: 1 }}>READ-ONLY CONTROL CENTER</span>
        </header>

        <section style={{ maxWidth: 860, marginBottom: 26 }}>
          <p style={{ color: "#7fe2ab", fontSize: 12, fontWeight: 900, letterSpacing: 2, margin: "0 0 12px" }}>ACTIVITY · OPERATOR VIEW</p>
          <h1 style={{ fontSize: "clamp(36px, 5vw, 58px)", lineHeight: 1.02, letterSpacing: -2.3, margin: 0 }}>See what the agent did.<br /><span style={{ color: "#7fe2ab" }}>Know why money moved.</span></h1>
          <p style={{ color: "#a5b8b0", fontSize: 16, lineHeight: 1.7, maxWidth: 800, marginTop: 18 }}>Live persisted transaction states and policy-run records from PactPay's database. Sort and filter the grid, open any row, and inspect the pact, offer snapshot, verification trace and payment identifiers. This page is read-only: it does not settle or mutate transactions.</p>
        </section>

        {data && data.scope !== "all" && (
          <div style={{ marginBottom: 18, padding: "12px 14px", borderRadius: 12, background: "#10261f", border: "1px solid #2d5545", color: "#bfe9d3", fontSize: 14, lineHeight: 1.6 }}>
            Showing activity from <strong>this browser session</strong> only. {data.transactions.length === 0 && data.policyRuns.length === 0 ? <>Nothing here yet. <a href="/" style={{ color: "#7fe2ab" }}>Run a purchase</a> and it will appear in this grid.</> : "Other visitors' payments are never shown."}
          </div>
        )}

        {error && <div role="alert" style={{ marginBottom: 18, padding: 14, borderRadius: 12, background: "#2a1517", border: "1px solid #8b4246", color: "#ffb8b8" }}>{error}</div>}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(185px,1fr))", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Persisted transactions", value: transactions.length, foot: "Most recent 100" },
            { label: "Verified captures", value: capturedCount, foot: "Status + PayPal capture agree" },
            { label: "Blocked policy runs", value: blockedCount, foot: "Deterministic gate decisions" },
            { label: "Review / evidence flags", value: reviewCount + evidenceGaps, foot: "Needs attention; counts may overlap" },
          ].map((item) => <article key={item.label} style={{ padding: 18, borderRadius: 15, border: "1px solid #28443a", background: "#0e1c19" }}>
            <p style={{ margin: 0, color: "#a5b8b0", fontSize: 12 }}>{item.label}</p>
            <p style={{ margin: "10px 0 6px", fontSize: 32, lineHeight: 1, fontWeight: 900, letterSpacing: -1 }}>{loading ? "—" : item.value}</p>
            <p style={{ margin: 0, color: "#7c9387", fontSize: 11 }}>{item.foot}</p>
          </article>)}
        </section>

        <section style={{ border: "1px solid #28443a", background: "#0e1c19", borderRadius: 17, padding: 16, marginBottom: 18 }}>
          {tab === "transactions" && (
            <div role="group" aria-label="Quick filters" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {([["all", "All attempts"], ["captured", "Captured"], ["blocked", "Voided · nothing captured"], ["evidence", "Stale or unchecked evidence"], ["review", "Needs review"], ["agent", "Run by the agent"]] as const).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={preset === key} onClick={() => setPreset(key)} style={{ border: "1px solid #42664c", borderRadius: 999, padding: "8px 14px", background: preset === key ? "#1e5a3f" : "transparent", color: "#edf7f2", fontWeight: 800, cursor: "pointer", fontSize: 14 }}>
                  {label} <span style={{ opacity: .75 }}>{allTransactions.filter((tx) => matchesPreset(tx, key)).length}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 15 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => { setTab("transactions"); setSelected(null); }} style={{ border: "1px solid #42664c", background: tab === "transactions" ? "#173b2b" : "transparent", color: tab === "transactions" ? "#7fe2ab" : "#a5b8b0", borderRadius: 9, padding: "10px 13px", fontWeight: 850, cursor: "pointer" }}>Transactions ({transactions.length})</button>
              <button type="button" onClick={() => { setTab("policy-runs"); setSelected(null); }} style={{ border: "1px solid #42664c", background: tab === "policy-runs" ? "#173b2b" : "transparent", color: tab === "policy-runs" ? "#7fe2ab" : "#a5b8b0", borderRadius: 9, padding: "10px 13px", fontWeight: 850, cursor: "pointer" }}>Policy runs ({policyRuns.length})</button>
            </div>
            <div style={{ display: "flex", gap: 8, flex: "1 1 250px", maxWidth: 480 }}>
              <input aria-label="Filter rows" value={filterText} onChange={(event) => setFilterText(event.currentTarget.value)} placeholder="Filter by ID, status, merchant, decision…" style={{ flex: 1, minWidth: 0, borderRadius: 9, border: "1px solid #28443a", padding: "10px 12px", background: "#07110e", color: "#edf7f2", fontSize: 14 }} />
              <button type="button" onClick={() => void load(true)} disabled={refreshing} style={{ border: "1px solid #42664c", borderRadius: 9, padding: "10px 13px", background: "#173b2b", color: "#edf7f2", fontWeight: 850, cursor: "pointer" }}>{refreshing ? "Refreshing…" : "Refresh"}</button>
            </div>
          </div>

          {loading ? <div style={{ minHeight: 360, display: "grid", placeItems: "center", color: "#a5b8b0" }}>Loading persisted records from PostgreSQL…</div> : <AgGridProvider modules={modules}>
            <div style={{ height: 500, width: "100%", border: "1px solid #28443a", borderRadius: 10, overflow: "hidden" }}>
              {tab === "transactions" ? <AgGridReact<TransactionRow>
                theme={gridTheme}
                rowData={transactions}
                columnDefs={transactionColumns}
                defaultColDef={baseColDef}
                quickFilterText={filterText}
                pagination
                paginationPageSize={10}
                paginationPageSizeSelector={[10, 20, 50]}
                getRowId={(params) => params.data.transaction_id}
                onRowClicked={selectTransaction}
                overlayNoRowsTemplate={'<span style="padding:12px;color:#a5b8b0;">No transactions yet. A first row appears after an authorization flow runs.</span>'}
              /> : <AgGridReact<PolicyRunRow>
                theme={gridTheme}
                rowData={policyRuns}
                columnDefs={policyColumns}
                defaultColDef={baseColDef}
                quickFilterText={filterText}
                pagination
                paginationPageSize={10}
                paginationPageSizeSelector={[10, 20, 50]}
                getRowId={(params) => params.data.id}
                onRowClicked={selectPolicyRun}
                overlayNoRowsTemplate={'<span style="padding:12px;color:#a5b8b0;">No policy runs yet. Evaluate an offer or run a Policy Lab scenario.</span>'}
              />}
            </div>
          </AgGridProvider>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", color: "#7c9387", fontSize: 11, marginTop: 12 }}>
            <span>Click a row to inspect its lineage and verification data.</span>
            <span>Updated {data ? dateTime(data.generatedAt) : "—"} · Read-only · No payment action</span>
          </div>
        </section>

        {selected && <section style={{ border: "1px solid #42664c", background: "#0e1c19", borderRadius: 17, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: "0 0 7px", color: "#7fe2ab", fontSize: 11, fontWeight: 900, letterSpacing: 1.4 }}>{selected.kind === "transaction" ? "TRANSACTION DETAIL" : "POLICY RUN DETAIL"}</p>
              <h2 style={{ margin: 0, fontSize: 22, overflowWrap: "anywhere" }}>{selected.kind === "transaction" ? selected.row.transaction_id : selected.row.id}</h2>
            </div>
            <button type="button" onClick={() => setSelected(null)} style={{ border: "1px solid #28443a", background: "transparent", color: "#a5b8b0", borderRadius: 8, padding: "8px 11px", cursor: "pointer" }}>Close details</button>
          </div>
          {selected.kind === "transaction" ? <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginTop: 17 }}>
              {[
                ["State", selected.row.status], ["Sandbox amount", `${selected.row.currency} ${selected.row.amount}`],
                ["PayPal order", selected.row.order_id ?? "—"], ["Authorization", `${selected.row.authorization_status ?? "—"} · ${selected.row.authorization_id ?? "—"}`],
                ["Capture", `${selected.row.capture_status ?? "—"} · ${selected.row.capture_id ?? "—"}`], ["Void", selected.row.void_status ?? "—"],
                ["Offer snapshot", selected.row.offer_snapshot_id ?? "—"], ["Pact hash", selected.row.pact_hash ?? "—"],
                ["Capture origin", selected.row.capture_origin ?? "—"], ["Agent autonomy", selected.row.autonomy_label ?? "—"], ["Created", dateTime(selected.row.created_at)],
                ["Captured at", dateTime(selected.row.captured_at)], ["Voided at", dateTime(selected.row.voided_at)],
              ].map(([label, value]) => <div key={label} style={{ padding: 12, border: "1px solid #28443a", borderRadius: 10, background: "#091512", minWidth: 0 }}><div style={{ color: "#7c9387", fontSize: 11, marginBottom: 6 }}>{label}</div><div style={{ fontSize: 13, fontWeight: 750, overflowWrap: "anywhere" }}>{value}</div></div>)}
            </div>
            {selected.row.failed_rules && <p style={{ color: "#ff9d8a", fontSize: 14, lineHeight: 1.6, marginTop: 14 }}>Failed rules: {selected.row.failed_rules}</p>}
            <Lineage transactionId={selected.row.transaction_id} />
            {selected.row.last_error_message && <p style={{ color: "#ffb8b8", fontSize: 13, lineHeight: 1.6 }}>Last error: {selected.row.last_error_message}</p>}
            <a href={`/protected-demo?transactionId=${encodeURIComponent(selected.row.transaction_id)}`} style={{ display: "inline-block", marginTop: 15, color: "#7fe2ab", fontWeight: 850 }}>Open transaction timeline ↗</a>
          </> : <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 17 }}>
              {[
                ["Scenario", selected.row.scenario_id], ["Gate result", selected.row.decision === "capture" ? "PRECONDITIONS PASS" : "BLOCK"],
                ["Security", truthLabel(selected.row.security_clear)], ["Evidence fresh", truthLabel(selected.row.evidence_fresh)],
                ["Evidence attributable", truthLabel(selected.row.evidence_attributable)], ["Policy hash", selected.row.policy_hash ?? "Not available"],
              ].map(([label, value]) => <div key={label} style={{ padding: 12, border: "1px solid #28443a", borderRadius: 10, background: "#091512", minWidth: 0 }}><div style={{ color: "#7c9387", fontSize: 11, marginBottom: 6 }}>{label}</div><div style={{ fontSize: 13, fontWeight: 750, overflowWrap: "anywhere" }}>{value}</div></div>)}
            </div>
            <p style={{ marginTop: 16, marginBottom: 7, color: "#a5b8b0", fontSize: 13 }}>Pact snapshot, offer observation and server-side verification trace</p>
            <pre style={{ margin: 0, padding: 14, borderRadius: 10, border: "1px solid #28443a", background: "#07110e", color: "#cfe4d6", fontSize: 12, lineHeight: 1.6, overflow: "auto", maxHeight: 420 }}>{json({ pact: selected.row.pact_snapshot, offer: selected.row.offer_snapshot, verification: selected.row.verification_result })}</pre>
          </>}
        </section>}

        <p style={{ margin: 0, color: "#7c9387", fontSize: 12, lineHeight: 1.6 }}>This grid uses AG Grid Community with live records from PostgreSQL. A policy “PASS” means the recorded hard-rule preconditions passed; it is not proof that a PayPal capture occurred. For transactions, confirm both PactPay state and PayPal capture status.</p>
      </div>
    </main>
  );
}
