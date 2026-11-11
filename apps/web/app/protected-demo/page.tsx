"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";

type ConstraintResult = {
  constraintId: string;
  severity?: "hard" | "soft";
  status: "pass" | "fail" | "unknown";
  actual?: string | number | boolean;
  evidenceIds: string[];
  reason: string;
};

type Transaction = {
  transactionId: string;
  status: string;
  amount: string;
  currency: string;
  orderId: string | null;
  orderStatus: string | null;
  authorizationId: string | null;
  authorizationStatus: string | null;
  authorizationExpiresAt: string | null;
  offerSnapshotId?: string | null;
  captureId: string | null;
  captureOrigin: "PACTPAY_GATE" | "EXTERNAL_WEBHOOK" | null;
  capturedAt: string | null;
  voidedAt: string | null;
  lastError: string | null;
};

type PurchaseOffer = {
  id: string;
  currency: string;
  total?: number | null;
  shippingFee?: number | null;
  deliveryDate?: string | null;
  returnWindowDays?: number | null;
  attributes: Record<string, string | number | boolean | null | undefined>;
  checkoutAdapter?: string;
  sourceSnapshotId?: string;
  currentCatalogSnapshotId?: string;
  sourceProductId?: string;
  sourceTitle?: string;
  sourceDescription?: string | null;
  sourceBrand?: string | null;
  sourceImageUrl?: string | null;
  sourceDomain?: string;
  sourceOfferUrl?: string;
  sourceFetchedAt?: string;
  sourceValidUntil?: string;
  sourceItemPrice?: number;
  scenarioApplied?: { id: string; note: string; changedAt: string };
  sandboxQuote?: {
    itemPrice: number;
    shippingFee: number;
    taxRate: number;
    taxAmount: number;
    total: number;
    currency: string;
    disclaimer: string;
  };
};

type PurchaseContext = {
  mode: string;
  pactHash: string;
  pact: { id: string; currency: string; maxTotalAmount?: number; constraints: Array<{ id: string; description: string; severity: "hard" | "soft"; expected: string | number; field: string }> };
  currentOffer: PurchaseOffer;
  baselineOffer: PurchaseOffer;
  scenarioId: string;
  securityFinding: string | null;
  revision: number;
  gateDecision: "UNVERIFIED" | "PASS" | "BLOCK";
  gateVerification: { verifiedAt?: string; evidenceFresh?: boolean; evidenceAttributable?: boolean; securityClear?: boolean; results?: ConstraintResult[] } | null;
  gateHash: string | null;
  gateVerifiedAt: string | null;
  gateValidUntil: string | null;
};

type TransactionResponse = {
  transaction: Transaction;
  purchaseContext: PurchaseContext | null;
  auditIntegrity: { valid: boolean; eventCount: number; failedEventId: string | null };
};
type PayPalLiveState = {
  checkedAt: string;
  local: { status: string; amount: string; currency: string; orderId: string | null; authorizationId: string | null; captureId: string | null; captureStatus: string | null };
  paypal: {
    order: { id: string | null; status: string; referenceId: string | null; customId: string | null; amount: string | null; currency: string | null };
    authorization: { id: string; status: string; amount: string | null; currency: string | null; expiresAt: string | null } | null;
    capture: { id: string | null; status: string; amount: string | null; currency: string | null; finalCapture: boolean | null; directResourceRead: boolean } | null;
  };
  verification: { orderIdMatches: boolean; transactionBindingMatches: boolean; orderAmountMatches: boolean; authorizationAmountMatches: boolean; captureCompleted: boolean; captureAmountMatches: boolean | null; captureRelationshipMatches: boolean; auditValid: boolean; canReconcileCapture: boolean };
  auditIntegrity: { valid: boolean; eventCount: number };
  readOnly: true;
  paymentAction: "NONE";
  note: string;
};

type ApiError = { error?: string; message?: string; note?: string; transaction?: { status?: string } };
type SettlementResponse = {
  decision?: "PASS" | "BLOCK";
  decisionReason?: string;
  verification?: { verifiedAt: string; evidenceFresh: boolean; evidenceAttributable: boolean; securityClear: boolean; results: ConstraintResult[] };
  settlementOutcome?: string;
  gateHash?: string;
  gateValidUntil?: string;
  simulatorOnly?: boolean;
  liveOfferRevalidation?: {
    status: "MATCHED_UNCHANGED" | "MATCHED_WITH_CHANGES" | "OFFER_NOT_FOUND" | "UNAVAILABLE" | "BINDING_MISMATCH";
    previousSnapshotId: string;
    refreshedSnapshotId: string | null;
    observedAt: string;
    changedFields: string[];
    securityFinding: string | null;
    note: string;
  } | null;
  error?: string;
};

const SCENARIOS = [
  { id: "BASELINE", label: "Compliant offer", detail: "All hard conditions pass. In Sandbox, the gate should capture the authorized amount.", kind: "pass" },
  { id: "BUDGET_OVERRUN", label: "Budget overrun", detail: "Total rises above $900 and no longer matches the authorized amount.", kind: "attack" },
  { id: "PRODUCT_DOWNGRADE", label: "Product downgrade", detail: "RAM changes from 16 GB to 8 GB.", kind: "attack" },
  { id: "DELIVERY_SLIP", label: "Delivery deadline slip", detail: "Delivery moves beyond the approved deadline.", kind: "attack" },
  { id: "RETURNS_DOWNGRADE", label: "Return-policy downgrade", detail: "Returns fall from 30 days to 7 days.", kind: "attack" },
  { id: "PROMPT_INJECTION", label: "Untrusted merchant instruction", detail: "The simulator injects a security finding. This tests fail-closed handling; it is not a live prompt-injection detector.", kind: "attack" },
  { id: "CURRENCY_MISMATCH", label: "Currency mismatch", detail: "The observed offer currency differs from USD.", kind: "attack" },
] as const;


const CHANNEL3_BOUND_SCENARIOS = [
  { id: "BASELINE", label: "No deliberate drift", detail: "Re-fetch the same live Channel3 product and merchant offer, then evaluate its current catalog facts against the approved Pact. Shipping and tax remain test-fixture terms.", kind: "pass" },
  { id: "PRICE_INCREASE", label: "Simulate a price increase", detail: "Raise the test item price above the Pact's item-price cap when one exists. This mutation is local to the Sandbox fixture; it does not change Channel3 or the merchant listing.", kind: "attack" },
  { id: "OUT_OF_STOCK", label: "Simulate out of stock", detail: "Change the test-fixture availability to OutOfStock to exercise an in-stock hard rule. The original Channel3 observation is unchanged.", kind: "attack" },
  { id: "PROMPT_INJECTION", label: "Inject untrusted merchant text", detail: "Add a controlled test fixture that asks the agent to ignore the Pact. This checks fail-closed handling; it is not a claim of live prompt-injection detection.", kind: "attack" },
  { id: "CURRENCY_MISMATCH", label: "Simulate currency mismatch", detail: "Change the test-fixture quote currency to CAD while the PayPal Sandbox authorization remains USD.", kind: "attack" },
] as const;

const colors = {
  bg: "#08110f", panel: "#0f1c18", panelAlt: "#12241e", border: "#294139",
  text: "#eff8f3", muted: "#a4b9ae", green: "#83edb1", red: "#ffb3b3", amber: "#ffd58c",
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function decisionLabel(id: string, constraints: PurchaseContext["pact"]["constraints"]): string {
  const approved = constraints.find((constraint) => constraint.id === id);
  if (approved) return approved.description;
  const systemLabels: Record<string, string> = {
    "system.offer_availability": "Current offer availability",
    "system.authorized_amount_match": "Authorized amount matches the test quote",
    "system.authorized_currency_match": "Authorized currency matches the Pact",
    "system.budget_cap": "Purchase remains within the budget cap",
    "system.currency_match": "Offer currency matches the authorized currency",
  };
  return systemLabels[id] ?? id.replace(/[._-]+/g, " ").replace(/^\w/, (char) => char.toUpperCase());
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "bad" | "warn" | "neutral" }) {
  const toneStyle = tone === "good"
    ? { color: colors.green, borderColor: "#326b4e", background: "#123324" }
    : tone === "bad"
      ? { color: colors.red, borderColor: "#71383b", background: "#361c20" }
      : tone === "warn"
        ? { color: colors.amber, borderColor: "#705a2e", background: "#342b19" }
        : { color: colors.muted, borderColor: colors.border, background: colors.panelAlt };
  return <span style={{ display: "inline-flex", alignItems: "center", padding: "5px 8px", border: `1px solid ${toneStyle.borderColor}`, borderRadius: 999, background: toneStyle.background, color: toneStyle.color, fontSize: 11, fontWeight: 800, letterSpacing: 0.6 }}>{children}</span>;
}

export default function ProtectedDemoPage() {
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [purchase, setPurchase] = useState<PurchaseContext | null>(null);
  const [auditValid, setAuditValid] = useState<boolean | null>(null);
  const [auditCount, setAuditCount] = useState(0);
  const [approvedTerms, setApprovedTerms] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<string>("BASELINE");
  const [applying, setApplying] = useState(false);
  const [settling, setSettling] = useState(false);
  const [result, setResult] = useState<SettlementResponse | null>(null);
  const [livePayPalState, setLivePayPalState] = useState<PayPalLiveState | null>(null);
  const [refreshingPayPalState, setRefreshingPayPalState] = useState(false);
  const [reconcilingCapture, setReconcilingCapture] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isChannel3BoundOffer = purchase?.baselineOffer.checkoutAdapter === "PACTPAY_CHANNEL3_TEST_CHECKOUT";
  const activeScenarios = isChannel3BoundOffer ? CHANNEL3_BOUND_SCENARIOS : SCENARIOS;
  const selected = activeScenarios.find((scenario) => scenario.id === selectedScenario) ?? activeScenarios[0];

  const loadTransaction = useCallback(async (id: string) => {
    const response = await fetch(`/api/paypal/protected-demo/transactions/${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = (await response.json()) as TransactionResponse & ApiError;
    if (!response.ok) throw new Error(data.error ?? "Unable to load transaction.");
    setTransaction(data.transaction);
    setPurchase(data.purchaseContext);
    setAuditValid(data.auditIntegrity?.valid ?? null);
    setAuditCount(data.auditIntegrity?.eventCount ?? 0);
    setSelectedScenario(data.purchaseContext?.scenarioId ?? "BASELINE");
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("transactionId");
    if (!id) return;
    setTransactionId(id);
    void loadTransaction(id).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load transaction."));
  }, [loadTransaction]);

  async function refreshPayPalState() {
    if (!transactionId || refreshingPayPalState) return;
    setRefreshingPayPalState(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/paypal/transactions/${encodeURIComponent(transactionId)}/refresh-state`, { cache: "no-store" });
      const data = await response.json() as PayPalLiveState & ApiError;
      if (!response.ok) throw new Error(data.error ?? `PayPal state check failed (${response.status}).`);
      setLivePayPalState(data);
      await loadTransaction(transactionId);
      if (data.verification.captureCompleted && data.verification.captureAmountMatches) {
        setMessage(data.local.status === "CAPTURED"
          ? "Checked PayPal directly: its capture is completed and the amount/currency match. No payment action was taken by this check."
          : "PayPal reports a completed capture for the expected amount. PactPay's saved state still needs reconciliation; do not submit another capture.");
      } else if (data.paypal.authorization?.status === "VOIDED") {
        setMessage("Checked PayPal directly: the authorization is voided. This refresh did not create or change a payment.");
      } else if (data.paypal.authorization?.status === "CREATED") {
        setMessage("Checked PayPal directly: the Sandbox authorization is still active. No capture was issued by this refresh.");
      } else {
        setMessage(`PayPal state checked at ${fmtDate(data.checkedAt)}. Review the live values below; this check made no payment changes.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not refresh PayPal state.");
    } finally { setRefreshingPayPalState(false); }
  }

  async function reconcileVerifiedCapture() {
    if (!transactionId || reconcilingCapture || !livePayPalState?.verification.canReconcileCapture) return;
    setReconcilingCapture(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/paypal/transactions/${encodeURIComponent(transactionId)}/reconcile-capture`, { method: "POST", cache: "no-store" });
      const data = await response.json() as { reconciliation?: string; transaction?: { status?: string; captureId?: string | null }; error?: string };
      if (!response.ok || data.reconciliation !== "VERIFIED" || data.transaction?.status !== "CAPTURED") {
        throw new Error(data.error ?? "PayPal was checked, but the saved capture could not be reconciled. Leave the transaction under review.");
      }
      await loadTransaction(transactionId);
      setLivePayPalState((current) => current ? { ...current, local: { ...current.local, status: "CAPTURED", captureId: data.transaction?.captureId ?? current.local.captureId, captureStatus: "COMPLETED" } } : current);
      setMessage("Capture verified and local state reconciled. PayPal Sandbox confirms the virtual test capture; no retailer order was created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Capture reconciliation failed. Do not retry settlement.");
    } finally { setReconcilingCapture(false); }
  }

  async function startProtectedDemo() {
    setStarting(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/paypal/protected-demo/orders", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }),
      });
      const data = (await response.json()) as { approvalUrl?: string; error?: string; transactionId?: string };
      if (!response.ok || !data.approvalUrl || !data.transactionId) throw new Error(data.error ?? "Could not create protected Sandbox order.");
      window.location.assign(data.approvalUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected start error.");
      setStarting(false);
    }
  }

  async function applyScenario() {
    if (!transactionId) return;
    setApplying(true); setError(null); setMessage(null); setResult(null);
    try {
      const response = await fetch(`/api/paypal/transactions/${encodeURIComponent(transactionId)}/scenario`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenarioId: selectedScenario }),
      });
      const data = (await response.json()) as ApiError;
      if (!response.ok) throw new Error(data.error ?? "Could not apply demo scenario.");
      await loadTransaction(transactionId);
      setMessage(isChannel3BoundOffer
        ? "Test condition saved. No PayPal API call was made; the original Channel3 snapshot remains unchanged."
        : "Scenario applied to the server-side simulator. No PayPal API call was made.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected scenario error.");
    } finally { setApplying(false); }
  }

  async function settle() {
    if (!transactionId) return;
    setSettling(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/paypal/transactions/${encodeURIComponent(transactionId)}/settle`, { method: "POST", cache: "no-store" });
      const data = (await response.json()) as SettlementResponse;
      setResult(data);
      if (!response.ok) throw new Error(data.error ?? `Settlement gate returned HTTP ${response.status}.`);
      await loadTransaction(transactionId);
      setMessage(data.settlementOutcome === "CAPTURED"
        ? "Gate passed. The Sandbox authorization was captured and reconciled against the returned amount and currency."
        : "Gate blocked the transaction. The Sandbox authorization was voided; no capture was performed.");
    } catch (caught) {
      if (transactionId) await loadTransaction(transactionId).catch(() => undefined);
      setError(caught instanceof Error ? caught.message : "Settlement could not be confirmed. Inspect transaction and audit state before retrying.");
    } finally { setSettling(false); }
  }

  const authorized = transaction?.status === "AUTHORIZED";
  const terminal = ["CAPTURED", "VOIDED", "CANCELLED", "FAILED"].includes(transaction?.status ?? "");
  const hardResults = result?.verification?.results ?? purchase?.gateVerification?.results ?? [];
  const decisionReason = result?.decisionReason ?? (purchase?.gateVerification?.securityClear === false
    ? "Security or binding integrity check failed."
    : "Stored gate verification loaded from the database.");
  const headingStyle: CSSProperties = { fontSize: 12, letterSpacing: 1.6, color: colors.green, fontWeight: 900 };
  const panel: CSSProperties = { background: colors.panel, border: `1px solid ${colors.border}`, borderRadius: 18, padding: 20 };
  const button: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", border: `1px solid ${colors.border}`, borderRadius: 11, padding: "12px 15px", background: colors.panelAlt, color: colors.text, fontWeight: 800, cursor: "pointer" };

  return (
    <main style={{ minHeight: "100vh", background: `radial-gradient(ellipse at 12% 0%, #153a2e 0%, ${colors.bg} 46%)`, color: colors.text, padding: "28px 18px 64px", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14, marginBottom: 34 }}>
          <a href="/" aria-label="PactPay home" style={{ display: "inline-flex" }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/pactpay-logo-light.svg" alt="PactPay" height={32} style={{ height: 32, width: "auto" }} /></a>
          <nav style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}><a href="/discover" style={{ color: colors.muted }}>Discovery ↗</a><a href="/pact-lab" style={{ color: colors.muted }}>Policy Lab ↗</a><a href="/evidence" style={{ color: colors.muted }}>Evidence Desk ↗</a></nav>
        </header>

        <section style={{ marginBottom: 24 }}>
          <p style={headingStyle}>{isChannel3BoundOffer ? "M0.13 · OFFER-BOUND SANDBOX CHECKOUT" : "M0.8 · PROTECTED SANDBOX LAB"}</p>
          <h1 style={{ maxWidth: 790, fontSize: "clamp(34px, 5vw, 58px)", lineHeight: 1.02, letterSpacing: -2, margin: "12px 0 16px" }}>The pact is the rule.<br/><span style={{ color: colors.green }}>Evidence is the proof.</span></h1>
          <p style={{ maxWidth: 800, fontSize: 16, lineHeight: 1.7, color: colors.muted }}>{isChannel3BoundOffer
            ? "This test checkout is bound to the selected, saved Channel3 product and merchant offer. The server re-fetches that same offer before evaluating the approved Pact. Catalog facts come from Channel3; the shipping, tax and deliberate drift in this Sandbox test are simulated—not a retailer checkout."
            : "The legacy fixed-fixture lab demonstrates how PactPay binds a PayPal Sandbox authorization to a Purchase Pact. For a product-led run, start from a live Channel3 offer in Discovery. The fixed laptop below is a repeatable simulator fixture, not a real retail order."}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}><Badge tone="good">PAYPAL SANDBOX ONLY</Badge>{isChannel3BoundOffer ? <><Badge tone="good">LIVE CHANNEL3 CATALOG BINDING</Badge><Badge tone="warn">SIMULATED CHECKOUT TERMS</Badge></> : <><Badge tone="warn">FIXED TEST FIXTURE</Badge><Badge>NO RETAILER ORDER</Badge></>}</div>
        </section>

        {error && <div role="alert" style={{ ...panel, borderColor: "#71383b", color: colors.red, marginBottom: 16 }}>{error}</div>}
        {message && <div role="status" style={{ ...panel, color: colors.green, marginBottom: 16 }}>{message}</div>}

        {!transactionId && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
            <section style={{ ...panel, borderColor: "#4e8269" }}>
              <p style={headingStyle}>RECOMMENDED · START WITH A REAL OFFER</p>
              <h2 style={{ margin: "10px 0", fontSize: 26 }}>Choose what you want to buy.</h2>
              <p style={{ color: colors.muted, fontSize: 15, lineHeight: 1.7 }}>Search the live Channel3 catalog, approve your Purchase Pact, choose a listing, and use <strong style={{ color: colors.text }}>Test selected offer in PayPal Sandbox</strong>. PactPay binds that exact saved listing to a clearly labelled test quote and revalidates the same product-plus-merchant offer before the gate.</p>
              <div style={{ padding: 14, border: `1px solid ${colors.border}`, borderRadius: 12, background: "#0a1512", margin: "16px 0" }}><div style={{ fontWeight: 850, marginBottom: 5 }}>What is live vs. simulated?</div><p style={{ margin: 0, color: colors.muted, fontSize: 13, lineHeight: 1.6 }}>Product title, merchant, catalog item price, availability and supplied attributes come from Channel3. Shipping, tax and intentional attack scenarios are test fixtures. PayPal uses virtual Sandbox funds, and no retailer order is created.</p></div>
              <a href="/discover" style={{ ...button, textDecoration: "none", background: colors.green, color: "#07130e", borderColor: colors.green }}>Open live offer discovery →</a>
            </section>
            <section style={panel}>
              <p style={headingStyle}>OPTIONAL · LEGACY FIXED-FIXTURE LAB</p>
              <h2 style={{ margin: "10px 0", fontSize: 22 }}>Repeatable laptop scenario</h2>
              <p style={{ color: colors.muted, fontSize: 14, lineHeight: 1.65 }}>Use this only when you need a stable, preconfigured safety test. It is not connected to a live retailer listing.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "14px 0" }}>{[["Test amount", "$849.00 USD"], ["Memory rule", "16 GB minimum"], ["Condition rule", "Refurbished"], ["Availability", "In stock"], ["Delivery", "Test deadline"], ["Returns", "14 days minimum"]].map(([label, value]) => <div key={label} style={{ padding: 11, border: `1px solid ${colors.border}`, borderRadius: 10, background: "#0a1512" }}><div style={{ color: colors.muted, fontSize: 11 }}>{label}</div><div style={{ fontWeight: 800, fontSize: 14, marginTop: 5 }}>{value}</div></div>)}</div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: "16px 0", lineHeight: 1.6, fontSize: 13 }}><input type="checkbox" checked={approvedTerms} onChange={(event) => setApprovedTerms(event.currentTarget.checked)} style={{ marginTop: 3 }} /><span>I understand this is a fixed Sandbox fixture, not a real retailer order. PactPay may capture only if the stored Pact, simulated evidence, security state and amount/currency bindings pass.</span></label>
              <button style={{ ...button, background: approvedTerms && !starting ? colors.panelAlt : "#24372f", color: approvedTerms ? colors.text : colors.muted, opacity: approvedTerms ? 1 : 0.65 }} disabled={!approvedTerms || starting} onClick={startProtectedDemo}>{starting ? "Creating Sandbox order…" : "Start fixed-fixture test →"}</button>
            </section>
          </div>
        )}

        {transactionId && (
          <>
            <section style={{ ...panel, marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div><p style={headingStyle}>TRANSACTION</p><h2 style={{ margin: "8px 0", fontSize: 23 }}>{transaction ? `${transaction.currency} ${transaction.amount}` : "Loading transaction…"}</h2><p style={{ color: colors.muted, fontSize: 12, overflowWrap: "anywhere", marginBottom: 0 }}>{transactionId}</p></div>
                <div style={{ display: "grid", gap: 7, justifyItems: "end" }}><Badge tone={transaction?.status === "AUTHORIZED" ? "warn" : transaction?.status === "CAPTURED" ? "good" : transaction?.status === "VOIDED" ? "bad" : "neutral"}>{transaction?.status ?? "LOADING"}</Badge><Badge tone={auditValid ? "good" : "bad"}>AUDIT {auditValid ? "VALID" : auditValid === false ? "INVALID" : "CHECKING"} · {auditCount} EVENTS</Badge></div>
              </div>
              {transaction && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginTop: 18 }}>
                {[ ["PayPal order", transaction.orderId ?? "—"], ["Authorization", transaction.authorizationId ?? "—"], ["Authorization status", transaction.authorizationStatus ?? "—"], ["Expires", fmtDate(transaction.authorizationExpiresAt)] ].map(([label, value]) => <div key={label} style={{ padding: 13, background: "#0a1512", border: `1px solid ${colors.border}`, borderRadius: 11 }}><div style={{ color: colors.muted, fontSize: 11, marginBottom: 6 }}>{label}</div><div style={{ fontSize: 12, fontWeight: 800, overflowWrap: "anywhere" }}>{value}</div></div>)}
              </div>}
              {transaction?.status === "ORDER_CREATED" || transaction?.status === "AUTHORIZING" ? <p style={{ color: colors.amber, lineHeight: 1.6 }}>Finish buyer approval on PayPal first. After it returns to PactPay, authorization will be recorded before the protected gate can run.</p> : null}
              {transaction && <div role="status" style={{ marginTop: 16, padding: 14, borderRadius: 12, border: `1px solid ${transaction.status === "CAPTURED" ? "#326b4e" : transaction.status === "VOIDED" ? "#71383b" : transaction.status === "CAPTURE_REVIEW" ? "#705a2e" : colors.border}`, background: transaction.status === "CAPTURED" ? "#123324" : transaction.status === "VOIDED" ? "#361c20" : transaction.status === "CAPTURE_REVIEW" ? "#302816" : "#0a1512" }}>
                <strong style={{ fontSize: 14, color: transaction.status === "CAPTURED" ? colors.green : transaction.status === "VOIDED" ? colors.red : transaction.status === "CAPTURE_REVIEW" ? colors.amber : colors.text }}>
                  {transaction.status === "CAPTURED" ? "Sandbox test complete — capture verified" : transaction.status === "VOIDED" ? "Sandbox test blocked — no capture" : transaction.status === "CAPTURE_REVIEW" ? "Payment result needs reconciliation" : transaction.status === "AUTHORIZED" ? "Test funds authorized — not captured yet" : "Sandbox transaction in progress"}
                </strong>
                <p style={{ color: colors.muted, fontSize: 13, lineHeight: 1.65, margin: "6px 0 0" }}>
                  {transaction.status === "CAPTURED"
                    ? "PayPal recorded a completed capture of virtual Sandbox funds because the protected gate passed. This demonstrates the payment-control path; it did not place an order with the displayed retailer or deliver a product."
                    : transaction.status === "VOIDED"
                      ? "PactPay blocked the test checkout and PayPal reports the Sandbox authorization was voided. No capture was performed, and no retailer order was placed."
                      : transaction.status === "CAPTURE_REVIEW"
                        ? "PayPal may have completed the capture, but PactPay has not yet verified the result against its saved record. Do not retry settlement; check live PayPal state below."
                        : transaction.status === "AUTHORIZED"
                          ? "The Sandbox buyer approved a test amount. These are virtual test funds, not a retailer payment. PactPay must re-check the same offer, quote and approved rules before any capture decision."
                          : "This is a PayPal Sandbox transaction using virtual test funds. It does not place a retailer order or ship the selected product."}
                </p>
              </div>}
            </section>

            {purchase && (
              <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, marginBottom: 18 }}>
                <div style={panel}>
                  <p style={headingStyle}>APPROVED PURCHASE PACT</p><h2 style={{ margin: "8px 0 12px", fontSize: 20 }}>Hard constraints</h2>
                  <div style={{ display: "grid", gap: 10 }}>{purchase.pact.constraints.map((constraint) => <div key={constraint.id} style={{ padding: 10, background: "#0a1512", border: `1px solid ${colors.border}`, borderRadius: 9 }}><div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "flex-start" }}><strong style={{ fontSize: 13 }}>{constraint.description}</strong><Badge tone={constraint.severity === "hard" ? "warn" : "neutral"}>{constraint.severity.toUpperCase()}</Badge></div><div style={{ color: colors.muted, fontSize: 11, marginTop: 5 }}>Field: {constraint.field} · Required: {String(constraint.expected)}</div></div>)}</div>
                  <p style={{ fontSize: 11, color: colors.muted, overflowWrap: "anywhere", marginBottom: 0 }}>Pact hash: {purchase.pactHash}</p>
                </div>
                <div style={panel}>
                  <p style={headingStyle}>{isChannel3BoundOffer ? "LIVE CATALOG FACTS + TEST QUOTE" : "SIMULATED TEST EVIDENCE"}</p>
                  <h2 style={{ margin: "8px 0 12px", fontSize: 20 }}>{isChannel3BoundOffer ? (purchase.currentOffer.sourceTitle ?? "Selected Channel3 offer") : "Fixed-fixture offer"}</h2>
                  {isChannel3BoundOffer && <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14 }}>
                    {safeHttpUrl(purchase.currentOffer.sourceImageUrl) && <img src={safeHttpUrl(purchase.currentOffer.sourceImageUrl) ?? undefined} alt="Selected catalog item" width={76} height={76} style={{ width: 76, height: 76, borderRadius: 12, objectFit: "contain", background: "#fff", padding: 5 }} />}
                    <div style={{ minWidth: 0 }}><div style={{ fontWeight: 850 }}>{purchase.currentOffer.sourceDomain ?? "Merchant not recorded"}</div><div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Product ID: {purchase.currentOffer.sourceProductId ?? "Not recorded"}</div>{safeHttpUrl(purchase.currentOffer.sourceOfferUrl) && <a href={safeHttpUrl(purchase.currentOffer.sourceOfferUrl) ?? undefined} target="_blank" rel="noreferrer" style={{ color: colors.green, fontSize: 12, display: "inline-block", marginTop: 6 }}>Open original merchant listing ↗</a>}</div>
                  </div>}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {(isChannel3BoundOffer
                      ? [
                          ["Catalog item price", `${purchase.currentOffer.currency} ${Number(purchase.currentOffer.sourceItemPrice ?? purchase.currentOffer.attributes.itemPrice ?? 0).toFixed(2)}`],
                          ["Test item price", `${purchase.currentOffer.currency} ${Number(purchase.currentOffer.attributes.itemPrice ?? 0).toFixed(2)}`],
                          ["Test shipping", purchase.currentOffer.sandboxQuote ? `${purchase.currentOffer.currency} ${purchase.currentOffer.sandboxQuote.shippingFee.toFixed(2)}` : "Not recorded"],
                          ["Test tax · 8%", purchase.currentOffer.sandboxQuote ? `${purchase.currentOffer.currency} ${purchase.currentOffer.sandboxQuote.taxAmount.toFixed(2)}` : "Not recorded"],
                          ["Sandbox quote total", purchase.currentOffer.sandboxQuote ? `${purchase.currentOffer.currency} ${purchase.currentOffer.sandboxQuote.total.toFixed(2)}` : "Not recorded"],
                          ["Availability", String(purchase.currentOffer.attributes.availability ?? "Unknown")],
                          ["Brand", String(purchase.currentOffer.attributes.brand ?? purchase.currentOffer.sourceBrand ?? "Unknown")],
                          ["Condition", String(purchase.currentOffer.attributes.condition ?? "Unknown")],
                          ["RAM", purchase.currentOffer.attributes.ramGb == null ? "Not supplied" : `${purchase.currentOffer.attributes.ramGb} GB`],
                          ["Catalog observed", fmtDate(purchase.currentOffer.sourceFetchedAt)],
                        ]
                      : [
                          ["Simulated total", purchase.currentOffer.total == null ? "Unknown" : `${purchase.currentOffer.currency} ${purchase.currentOffer.total.toFixed(2)}`],
                          ["Simulated shipping", purchase.currentOffer.shippingFee == null ? "Unknown" : `$${purchase.currentOffer.shippingFee}`],
                          ["RAM", purchase.currentOffer.attributes.ramGb == null ? "Not supplied" : `${purchase.currentOffer.attributes.ramGb} GB`],
                          ["Condition", String(purchase.currentOffer.attributes.condition ?? "Unknown")],
                          ["Delivery", String(purchase.currentOffer.deliveryDate ?? "Unknown")],
                          ["Returns", purchase.currentOffer.returnWindowDays == null ? "Unknown" : `${purchase.currentOffer.returnWindowDays} days`],
                        ]
                    ).map(([label, value]) => <div key={label} style={{ padding: 12, background: "#0a1512", border: `1px solid ${colors.border}`, borderRadius: 10 }}><div style={{ color: colors.muted, fontSize: 11 }}>{label}</div><div style={{ fontWeight: 850, marginTop: 6, overflowWrap: "anywhere" }}>{value}</div></div>)}
                  </div>
                  {isChannel3BoundOffer && <div style={{ padding: 12, marginTop: 12, border: "1px solid #705a2e", background: "#302816", borderRadius: 10, color: colors.amber, fontSize: 12, lineHeight: 1.6 }}>{purchase.currentOffer.sandboxQuote?.disclaimer ?? "Shipping, tax and quote total are simulated test terms, not retailer checkout terms."} <span>Original selected snapshot: {purchase.currentOffer.sourceSnapshotId ?? "Missing"}. Latest stored catalog observation: {purchase.currentOffer.currentCatalogSnapshotId ?? "Not revalidated yet"}. {purchase.currentOffer.sourceValidUntil ? `Snapshot validity ended ${fmtDate(purchase.currentOffer.sourceValidUntil)}.` : "Snapshot validity time not recorded."}</span></div>}
                  <p style={{ color: colors.muted, fontSize: 12, lineHeight: 1.6 }}>Test scenario: <strong style={{ color: colors.text }}>{activeScenarios.find((scenario) => scenario.id === purchase.scenarioId)?.label ?? purchase.scenarioId}</strong> · Revision {purchase.revision}</p>
                  {purchase.currentOffer.scenarioApplied && <div style={{ padding: 12, border: "1px solid #705a2e", background: "#302816", borderRadius: 10, color: colors.amber, fontSize: 12, lineHeight: 1.6 }}>{purchase.currentOffer.scenarioApplied.note}</div>}
                  {purchase.securityFinding && <div style={{ padding: 12, border: "1px solid #71383b", background: "#361c20", borderRadius: 10, color: colors.red, fontSize: 12 }}>Security gate finding: {purchase.securityFinding}</div>}
                </div>
              </section>
            )}

            {authorized && purchase && (
              <section style={{ ...panel, marginBottom: 18 }}>
                <p style={headingStyle}>{isChannel3BoundOffer ? "PRE-SETTLEMENT REVALIDATION" : "CONTROLLED RED-TEAM SCENARIO"}</p>
                <h2 style={{ margin: "8px 0", fontSize: 23 }}>{isChannel3BoundOffer ? "Same selected offer. Re-check the deal." : "Same authorization. Changed facts."}</h2>
                <p style={{ color: colors.muted, lineHeight: 1.6, maxWidth: 830 }}>{isChannel3BoundOffer
                  ? "PactPay will request the latest Channel3 product detail for the same product and merchant offer, save a new immutable observation, then re-evaluate the current test quote and approved Pact. Any deliberate drift below is a PactPay-only test fixture—not a change made to the live merchant listing."
                  : "The legacy simulator changes server-side offer facts after buyer approval. PactPay then evaluates the bound Pact and evidence again. This makes the failure repeatable without relying on a real merchant changing a listing on cue."}</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginTop: 18 }}>{activeScenarios.map((scenario) => <button key={scenario.id} onClick={() => { setSelectedScenario(scenario.id); setResult(null); }} style={{ textAlign: "left", border: `1px solid ${selectedScenario === scenario.id ? colors.green : colors.border}`, borderRadius: 12, padding: 13, background: selectedScenario === scenario.id ? "#143529" : "#0a1512", color: colors.text, cursor: "pointer" }}><div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}><strong style={{ fontSize: 13 }}>{scenario.label}</strong><Badge tone={scenario.kind === "pass" ? "good" : "bad"}>{scenario.kind === "pass" ? "PASS TEST" : "TEST MUTATION"}</Badge></div><p style={{ margin: "7px 0 0", color: colors.muted, fontSize: 12, lineHeight: 1.5 }}>{scenario.detail}</p></button>)}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 12, marginTop: 15 }}>
                  <div style={{ border: "1px solid #705a2e", background: "#302816", padding: 14, borderRadius: 12 }}><Badge tone="warn">UNPROTECTED · COUNTERFACTUAL</Badge><p style={{ color: colors.text, fontWeight: 850, marginBottom: 5 }}>Approval-only agent</p><p style={{ margin: 0, color: colors.muted, fontSize: 12, lineHeight: 1.6 }}>A comparison model only. PactPay does not issue a bypass capture request, so the video must not claim that an unprotected payment was actually made.</p></div>
                  <div style={{ border: `1px solid ${colors.border}`, background: "#0a1512", padding: 14, borderRadius: 12 }}><Badge tone="good">PACTPAY · ENFORCED</Badge><p style={{ color: colors.text, fontWeight: 850, marginBottom: 5 }}>Revalidate before settlement</p><p style={{ margin: 0, color: colors.muted, fontSize: 12, lineHeight: 1.6 }}>The server checks the approved Pact hash, original snapshot binding, same live product-plus-merchant offer, evidence, freshness, authorization amount/currency and the policy decision. Passing may capture Sandbox funds; failure attempts to void the Sandbox authorization.</p></div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}><button style={button} disabled={applying || settling} onClick={applyScenario}>{applying ? "Applying…" : `Apply “${selected.label}”`}</button><button style={{ ...button, background: colors.green, color: "#07130e", borderColor: colors.green }} disabled={applying || settling} onClick={settle}>{settling ? "Revalidating & running gate…" : (isChannel3BoundOffer ? "Revalidate offer & run Sandbox gate →" : "Run gate & settle Sandbox →")}</button></div>
                <p style={{ marginBottom: 0, color: colors.muted, fontSize: 12, lineHeight: 1.6 }}>{isChannel3BoundOffer
                  ? "The real catalog item price is re-fetched, but the fixed $4.99 shipping and 8% test tax are not merchant quotes. Applying a drift scenario does not call PayPal or mutate the original Channel3 snapshot. The final PayPal action uses only the bound Sandbox authorization."
                  : "Applying a scenario makes no PayPal API call. Running the gate may capture the fixed $849 Sandbox authorization only if all server checks pass. A verified policy block attempts a void; uncertain outcomes require reconciliation. Never retry an uncertain settlement manually."}</p>
              </section>
            )}

            {(result || purchase?.gateVerification) && (
              <section style={{ ...panel, marginBottom: 18 }}>
                <p style={headingStyle}>SERVER-SIDE DECISION TRACE</p><h2 style={{ margin: "8px 0 12px", fontSize: 23 }}>{(result?.decision ?? purchase?.gateDecision) === "PASS" || result?.decision === "PASS" ? "POLICY PASS" : (result?.decision ?? purchase?.gateDecision) === "BLOCK" ? "POLICY BLOCK" : "VERIFICATION RESULT"}</h2>
                {result?.settlementOutcome && <p style={{ fontWeight: 900, fontSize: 18, color: result.settlementOutcome === "CAPTURED" ? colors.green : result.settlementOutcome === "VOIDED" ? colors.red : colors.amber }}>{result.settlementOutcome === "CAPTURED" ? "PAYPAL SANDBOX CAPTURED" : result.settlementOutcome === "VOIDED" ? "AUTHORIZATION VOIDED · NO CAPTURE" : `Settlement outcome: ${result.settlementOutcome}`}</p>}
                <p style={{ color: colors.muted, fontSize: 12, lineHeight: 1.6 }}>Decision reason: {decisionReason}</p>
                {isChannel3BoundOffer && result?.liveOfferRevalidation && <div role="status" style={{ padding: 13, marginBottom: 12, borderRadius: 11, border: `1px solid ${["MATCHED_UNCHANGED", "MATCHED_WITH_CHANGES"].includes(result.liveOfferRevalidation.status) ? "#326b4e" : "#705a2e"}`, background: ["MATCHED_UNCHANGED", "MATCHED_WITH_CHANGES"].includes(result.liveOfferRevalidation.status) ? "#123324" : "#302816" }}><strong style={{ color: ["MATCHED_UNCHANGED", "MATCHED_WITH_CHANGES"].includes(result.liveOfferRevalidation.status) ? colors.green : colors.amber }}>Live Channel3 revalidation · {result.liveOfferRevalidation.status.replaceAll("_", " ")}</strong><p style={{ color: colors.muted, fontSize: 12, lineHeight: 1.6, margin: "7px 0 0" }}>{result.liveOfferRevalidation.note}</p>{result.liveOfferRevalidation.changedFields.length > 0 && <p style={{ color: colors.muted, fontSize: 12, margin: "7px 0 0" }}>Catalog fields changed: {result.liveOfferRevalidation.changedFields.join(", ")}</p>}</div>}
                <div style={{ display: "grid", gap: 8 }}>{hardResults.map((item) => <div key={item.constraintId} style={{ display: "grid", gridTemplateColumns: "minmax(135px, 0.45fr) minmax(150px, 1fr)", gap: 12, padding: 11, background: "#0a1512", border: `1px solid ${colors.border}`, borderRadius: 10 }}><div style={{ fontWeight: 850, fontSize: 12 }}>{decisionLabel(item.constraintId, purchase?.pact.constraints ?? [])}<div style={{ marginTop: 5 }}><Badge tone={item.status === "pass" ? "good" : item.status === "fail" ? "bad" : "warn"}>{item.status.toUpperCase()}</Badge></div></div><div style={{ color: colors.muted, fontSize: 12, lineHeight: 1.55 }}>{item.reason}</div></div>)}</div>
                {result?.gateHash && <p style={{ color: colors.muted, fontSize: 11, overflowWrap: "anywhere", marginBottom: 0 }}>Gate hash: {result.gateHash} · evidence valid until {fmtDate(result.gateValidUntil)}</p>}
              </section>
            )}

            {transaction && <section style={{ ...panel, marginBottom: 18 }}>
              <p style={headingStyle}>PAYPAL LIVE STATE · READ ONLY</p>
              <h2 style={{ margin: "8px 0", fontSize: 20 }}>Check what PayPal currently records</h2>
              <p style={{ color: colors.muted, fontSize: 13, lineHeight: 1.65 }}>This button re-queries the PayPal Sandbox order, authorization and capture resources—not just PactPay's database. It never captures, voids, or changes payment state.</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <button style={{ ...button, background: colors.green, color: "#07130e", borderColor: colors.green, opacity: refreshingPayPalState ? 0.65 : 1 }} disabled={refreshingPayPalState} onClick={() => void refreshPayPalState()}>{refreshingPayPalState ? "Checking PayPal…" : "Check PayPal live state →"}</button>
                <button style={button} disabled={reconcilingCapture || transaction.status !== "CAPTURE_REVIEW" || !livePayPalState?.verification.canReconcileCapture} title={!livePayPalState?.verification.canReconcileCapture ? "First run a live PayPal check. This becomes available only when the existing capture and bindings verify." : "Reconcile the verified existing capture without issuing a new payment."} onClick={() => void reconcileVerifiedCapture()}>{reconcilingCapture ? "Reconciling existing capture…" : "Reconcile verified capture"}</button>
                <button style={button} onClick={() => window.location.assign("/protected-demo")}>Start another demo</button>
              </div>
              {livePayPalState && <div style={{ marginTop: 15, padding: 14, border: `1px solid ${livePayPalState.verification.orderIdMatches && livePayPalState.verification.transactionBindingMatches ? colors.border : "#71383b"}`, borderRadius: 12, background: "#0a1512" }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}><strong style={{ color: colors.text, fontSize: 14 }}>PayPal checked · {fmtDate(livePayPalState.checkedAt)}</strong><Badge tone={livePayPalState.verification.orderIdMatches && livePayPalState.verification.transactionBindingMatches ? "good" : "bad"}>{livePayPalState.verification.orderIdMatches && livePayPalState.verification.transactionBindingMatches ? "ORDER BINDING MATCHED" : "BINDING MISMATCH"}</Badge></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 9, marginTop: 12 }}>
                  {[["Local PactPay state", livePayPalState.local.status], ["PayPal order", livePayPalState.paypal.order.status], ["PayPal authorization", livePayPalState.paypal.authorization?.status ?? "Not found"], ["PayPal capture", livePayPalState.paypal.capture?.status ?? "No capture found"], ["PayPal amount", livePayPalState.paypal.capture ? `${livePayPalState.paypal.capture.amount ?? "?"} ${livePayPalState.paypal.capture.currency ?? ""}` : `${livePayPalState.paypal.authorization?.amount ?? livePayPalState.paypal.order.amount ?? "?"} ${livePayPalState.paypal.authorization?.currency ?? livePayPalState.paypal.order.currency ?? ""}`]].map(([label, value]) => <div key={String(label)} style={{ padding: 10, borderRadius: 9, border: `1px solid ${colors.border}` }}><div style={{ color: colors.muted, fontSize: 11 }}>{label}</div><div style={{ marginTop: 5, color: colors.text, fontSize: 13, fontWeight: 850, overflowWrap: "anywhere" }}>{value}</div></div>)}
                </div>
                {livePayPalState.paypal.capture?.id && <p style={{ color: colors.muted, fontSize: 12, overflowWrap: "anywhere", margin: "11px 0 0" }}>Live capture ID: <code>{livePayPalState.paypal.capture.id}</code>{livePayPalState.paypal.capture.directResourceRead ? " · capture resource fetched directly" : " · using capture details embedded in the refreshed PayPal order"}</p>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 11 }}>{[["Amount matches", livePayPalState.verification.captureAmountMatches ?? livePayPalState.verification.authorizationAmountMatches], ["Transaction binding", livePayPalState.verification.transactionBindingMatches], ["Audit valid", livePayPalState.verification.auditValid]].map(([label, passed]) => <Badge key={String(label)} tone={passed ? "good" : "bad"}>{label}: {passed ? "YES" : "NO"}</Badge>)}</div>
                {livePayPalState.verification.canReconcileCapture && <p style={{ color: colors.amber, fontSize: 12, lineHeight: 1.6, marginBottom: 0 }}>PayPal appears to have a completed capture matching the expected amount and bindings, while PactPay still says CAPTURE_REVIEW. Use “Reconcile verified capture” to verify and update the local record; no new capture is issued.</p>}
                <p style={{ color: colors.muted, fontSize: 11, lineHeight: 1.55, margin: "11px 0 0" }}>{livePayPalState.note}</p>
              </div>}
              <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 18, paddingTop: 17 }}><p style={headingStyle}>AUDIT INTEGRITY</p><h3 style={{ margin: "8px 0", fontSize: 18 }}>{auditValid ? "Hash chain verified" : "Audit chain requires investigation"}</h3><p style={{ color: colors.muted, fontSize: 12, lineHeight: 1.6 }}>The hash chain detects event tampering against stored hashes; without an external checkpoint, it cannot stop a privileged operator from rewriting the entire chain.</p>{transaction.captureId && <p style={{ fontSize: 13 }}>Saved PayPal capture ID: <code>{transaction.captureId}</code></p>}{transaction.captureOrigin && <p style={{ fontSize: 13 }}>Capture origin: <Badge tone={transaction.captureOrigin === "PACTPAY_GATE" ? "good" : "bad"}>{transaction.captureOrigin}</Badge></p>}{transaction.lastError && <p style={{ color: colors.amber, fontSize: 13 }}>Last recorded issue: {transaction.lastError}</p>}{terminal && <p style={{ color: colors.muted, fontSize: 12, marginBottom: 0 }}>This transaction is terminal. It cannot be mutated or settled again; the live state check above remains read-only.</p>}</div>
            </section>}
          </>
        )}

        <footer style={{ marginTop: 28, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: colors.muted }}><a href="/discover" style={{ color: colors.green }}>Real catalog discovery →</a><a href="/pact-lab" style={{ color: colors.green }}>Policy Lab →</a><a href="/" style={{ color: colors.green }}>PayPal Sandbox →</a></footer>
      </div>
    </main>
  );
}
