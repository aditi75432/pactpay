"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";

type SnapshotSummary = {
  id: string;
  productId: string;
  title: string;
  brand: string | null;
  domain: string;
  offerUrl: string;
  itemPrice: number;
  currency: string;
  fetchedAt: string;
  validUntil: string;
  catalogFresh: boolean;
};

type EvidenceField =
  | "total"
  | "shippingFee"
  | "deliveryDate"
  | "returnWindowDays"
  | "attributes.itemPrice"
  | "attributes.ramGb"
  | "attributes.condition"
  | "attributes.availability";

type EvidenceItem = {
  id: string;
  field: EvidenceField;
  value: string | number | boolean;
  sourceUrl: string;
  sourceDomain: string;
  note: string | null;
  observedAt: string;
  validUntil: string;
  contentHash: string;
  reviewStatus: "SUBMITTED" | "HUMAN_REVIEWED" | "REJECTED";
  reviewerLabel: string | null;
  sourceInspected: boolean;
  reviewNote: string | null;
  reviewedAt: string | null;
};

type EvidenceResponse = {
  snapshot: SnapshotSummary;
  items: EvidenceItem[];
  policy: {
    paymentAction: "NONE";
    capturePerformedByPactPay: false;
    manuallySubmittedEvidenceIsNotIndependentlyAuthenticated: true;
    note: string;
  };
};

const FIELD_OPTIONS: Array<{ value: EvidenceField; label: string; hint: string }> = [
  { value: "total", label: "Final checkout total", hint: "Full total for this exact offer, including shipping/tax shown at checkout. Currency is inherited from the listing." },
  { value: "shippingFee", label: "Shipping fee", hint: "Shipping amount for the currently selected destination and exact offer." },
  { value: "deliveryDate", label: "Estimated delivery date", hint: "Use YYYY-MM-DD, as shown by the merchant for the selected destination." },
  { value: "returnWindowDays", label: "Return window (days)", hint: "Number of days in the merchant's stated return window for this exact item/category." },
  { value: "attributes.itemPrice", label: "Current item price", hint: "Use this only if you inspected the current merchant page; it can be used to compare against the older catalog observation." },
  { value: "attributes.ramGb", label: "RAM (GB)", hint: "Record an explicit specification from the merchant's exact product page. Do not infer from the title." },
  { value: "attributes.condition", label: "Item condition", hint: "Record the condition stated by the merchant, e.g. refurbished or new." },
  { value: "attributes.availability", label: "Availability", hint: "Record the current availability shown for this exact offer." },
];

const palette = {
  text: "#edf7f2",
  muted: "#a5b8b0",
  green: "#7fe2ab",
  border: "#28443a",
  panel: "#0e1c19",
  bg: "radial-gradient(ellipse at 15% 0%, #16372d 0%, #091311 48%, #07100e 100%)",
  amber: "#ffd891",
  red: "#ffb8b8",
};

function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function labelForField(field: EvidenceField): string {
  return FIELD_OPTIONS.find((item) => item.value === field)?.label ?? field;
}

function valueInputType(field: EvidenceField): "date" | "number" | "text" {
  if (field === "deliveryDate") return "date";
  if (field === "attributes.condition" || field === "attributes.availability") return "text";
  return "number";
}

export default function EvidenceDeskPage() {
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [field, setField] = useState<EvidenceField>("total");
  const [value, setValue] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [note, setNote] = useState("");
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedField = useMemo(() => FIELD_OPTIONS.find((item) => item.value === field) ?? {
    value: "total" as const,
    label: "Final checkout total",
    hint: "Full total for this exact offer, including shipping/tax shown at checkout. Currency is inherited from the listing.",
  }, [field]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/discovery/evidence?snapshotId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load the offer evidence.");
      setData(payload as EvidenceResponse);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unexpected evidence loading error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get("snapshotId");
    if (!id) {
      setError("No snapshot selected. Return to Discovery and select Collect merchant evidence on an offer.");
      return;
    }
    setSnapshotId(id);
    void load(id);
  }, [load]);

  async function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshotId) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/discovery/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId, field, value, sourceUrl, note }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Evidence submission failed.");
      setMessage(`Submitted ${labelForField(field)} for review. It is not yet used by the policy evaluator.`);
      setValue("");
      setNote("");
      if (snapshotUrlIsMerchant(data?.snapshot.domain, sourceUrl)) setSourceUrl(sourceUrl);
      await load(snapshotId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unexpected evidence submission error.");
    } finally {
      setSubmitting(false);
    }
  }

  async function reviewEvidence(item: EvidenceItem, decision: "HUMAN_REVIEWED" | "REJECTED") {
    if (!snapshotId) return;
    setReviewingId(item.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/discovery/evidence/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId,
          evidenceId: item.id,
          decision,
          sourceInspected: decision === "HUMAN_REVIEWED" && confirmed[item.id] === true,
          reviewNote: reviewNote[item.id] ?? "",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not record the evidence review.");
      setMessage(decision === "HUMAN_REVIEWED"
        ? "Human review recorded. The claim is eligible for policy evaluation while its local freshness window remains valid."
        : "Evidence marked rejected. It will not be used by the policy evaluator.");
      setConfirmed((current) => ({ ...current, [item.id]: false }));
      await load(snapshotId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unexpected evidence review error.");
    } finally {
      setReviewingId(null);
    }
  }

  const boxStyle: CSSProperties = { background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 18, padding: 20 };
  const buttonStyle: CSSProperties = { border: `1px solid ${palette.border}`, borderRadius: 10, padding: "10px 13px", background: "#17422f", color: palette.text, fontWeight: 800, cursor: "pointer" };
  const inputStyle: CSSProperties = { width: "100%", boxSizing: "border-box", background: "#07110e", border: `1px solid ${palette.border}`, borderRadius: 9, color: palette.text, padding: "11px 12px", fontSize: 14 };

  return (
    <main style={{ minHeight: "100vh", background: palette.bg, color: palette.text, padding: "28px 20px 64px", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 34 }}>
          <a href="/" aria-label="PactPay home" style={{ display: "inline-flex" }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/pactpay-logo-light.svg" alt="PactPay" height={32} style={{ height: 32, width: "auto" }} /></a>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}><a href="/discover" style={{ color: palette.green }}>← Discovery</a><a href="/pact-lab" style={{ color: palette.muted }}>Policy Lab ↗</a></div>
        </header>

        <section style={{ maxWidth: 900, marginBottom: 26 }}>
          <p style={{ color: palette.green, fontSize: 12, letterSpacing: 2, fontWeight: 900 }}>M0.6 · EVIDENCE DESK</p>
          <h1 style={{ fontSize: "clamp(34px, 5vw, 58px)", lineHeight: 1, letterSpacing: -2, margin: "12px 0 18px" }}>Claims need sources.<br /><span style={{ color: palette.green }}>Review before reliance.</span></h1>
          <p style={{ color: palette.muted, fontSize: 16, lineHeight: 1.7, maxWidth: 820 }}>Attach a merchant-page observation to the exact server-stored Channel3 offer. A submitted claim is not trusted by default. Only a claim you explicitly mark human-reviewed is eligible for deterministic policy evaluation, and PactPay still does not independently authenticate the merchant page or make payment calls.</p>
        </section>

        {error && <div role="alert" style={{ ...boxStyle, borderColor: "#7f343f", color: palette.red, marginBottom: 18 }}>{error}</div>}
        {message && <div role="status" style={{ ...boxStyle, borderColor: "#276449", color: palette.green, marginBottom: 18 }}>{message}</div>}
        {loading && !data && <div style={boxStyle}>Loading offer snapshot and evidence history…</div>}

        {data && <>
          <section style={{ ...boxStyle, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 400px" }}>
                <p style={{ color: palette.green, fontSize: 11, letterSpacing: 1.6, fontWeight: 900, margin: "0 0 8px" }}>SELECTED OFFER</p>
                <h2 style={{ fontSize: 23, lineHeight: 1.25, margin: "0 0 7px" }}>{data.snapshot.title}</h2>
                <p style={{ color: palette.muted, fontSize: 12, margin: 0 }}>{data.snapshot.brand ?? "Brand not supplied"} · {data.snapshot.domain} · Product {data.snapshot.productId}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 25, fontWeight: 900 }}>{new Intl.NumberFormat(undefined, { style: "currency", currency: data.snapshot.currency, maximumFractionDigits: 2 }).format(data.snapshot.itemPrice)}</div>
                <div style={{ color: palette.muted, fontSize: 11 }}>catalog item price only</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 16 }}>
              <a href={data.snapshot.offerUrl} target="_blank" rel="noreferrer noopener" style={{ color: palette.green, fontWeight: 800, fontSize: 13 }}>Open merchant offer ↗</a>
              <span style={{ color: data.snapshot.catalogFresh ? palette.green : palette.amber, fontSize: 11, fontWeight: 900 }}>{data.snapshot.catalogFresh ? "CATALOG SNAPSHOT FRESH" : "CATALOG SNAPSHOT STALE — REFRESH IN DISCOVERY"}</span>
              <span style={{ color: palette.muted, fontSize: 11 }}>Snapshot {data.snapshot.id}</span>
            </div>
          </section>

          <section style={{ ...boxStyle, marginBottom: 20 }}>
            <p style={{ color: palette.green, fontSize: 11, letterSpacing: 1.6, fontWeight: 900, margin: "0 0 8px" }}>ADD A MERCHANT-PAGE CLAIM</p>
            <h2 style={{ fontSize: 22, margin: "0 0 8px" }}>Capture one fact at a time</h2>
            <p style={{ color: palette.muted, fontSize: 12, lineHeight: 1.65, margin: "0 0 18px" }}>Open the merchant page, confirm it refers to this exact item and offer, then enter the displayed value and the page URL. PactPay does not fetch that page. Query strings and fragments are removed before storage to reduce the chance of retaining session or tracking tokens.</p>

            <form onSubmit={(event) => void submitEvidence(event)} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14 }}>
              <label style={{ display: "grid", gap: 7, color: palette.muted, fontSize: 12, fontWeight: 800 }}>
                Evidence field
                <select value={field} onChange={(event) => { setField(event.currentTarget.value as EvidenceField); setValue(""); }} style={inputStyle}>
                  {FIELD_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>

              <label style={{ display: "grid", gap: 7, color: palette.muted, fontSize: 12, fontWeight: 800 }}>
                Observed value
                {field === "attributes.condition" ? (
                  <select required value={value} onChange={(event) => setValue(event.currentTarget.value)} style={inputStyle}>
                    <option value="">Choose condition…</option><option value="new">New</option><option value="refurbished">Refurbished</option><option value="used">Used</option><option value="open-box">Open box</option><option value="unknown">Unknown</option>
                  </select>
                ) : field === "attributes.availability" ? (
                  <select required value={value} onChange={(event) => setValue(event.currentTarget.value)} style={inputStyle}>
                    <option value="">Choose availability…</option><option value="InStock">In stock</option><option value="OutOfStock">Out of stock</option><option value="PreOrder">Pre-order</option><option value="LimitedAvailability">Limited availability</option><option value="BackOrder">Back order</option><option value="Unknown">Unknown</option>
                  </select>
                ) : (
                  <input required type={valueInputType(field)} step={field === "total" || field === "shippingFee" || field === "attributes.itemPrice" ? "0.01" : field === "attributes.ramGb" ? "0.1" : "1"} min={field === "total" || field === "attributes.itemPrice" || field === "attributes.ramGb" ? "0.01" : field === "shippingFee" || field === "returnWindowDays" ? "0" : undefined} max={field === "returnWindowDays" ? "3650" : undefined} value={value} onChange={(event) => setValue(event.currentTarget.value)} placeholder={field === "deliveryDate" ? "YYYY-MM-DD" : field === "returnWindowDays" ? "14" : field === "attributes.ramGb" ? "16" : "0.00"} style={inputStyle} />
                )}
              </label>

              <label style={{ display: "grid", gap: 7, color: palette.muted, fontSize: 12, fontWeight: 800, gridColumn: "1 / -1" }}>
                Merchant source URL (HTTPS, same domain)
                <input required type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.currentTarget.value)} placeholder={`https://${data.snapshot.domain}/product-or-policy-page`} style={inputStyle} />
              </label>

              <label style={{ display: "grid", gap: 7, color: palette.muted, fontSize: 12, fontWeight: 800, gridColumn: "1 / -1" }}>
                Context note (optional, max 500 characters)
                <textarea value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={500} rows={2} placeholder="e.g. Checkout summary after selecting the displayed shipping destination" style={{ ...inputStyle, resize: "vertical" }} />
              </label>

              <div style={{ gridColumn: "1 / -1", border: `1px solid ${palette.border}`, borderRadius: 10, padding: 12, background: "#07110e" }}>
                <p style={{ margin: "0 0 6px", color: palette.text, fontWeight: 900, fontSize: 12 }}>{selectedField.label}</p>
                <p style={{ margin: 0, color: palette.muted, fontSize: 11, lineHeight: 1.65 }}>{selectedField.hint}</p>
              </div>
              <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                <button type="submit" disabled={submitting || !snapshotId} style={{ ...buttonStyle, opacity: submitting ? 0.6 : 1 }}>{submitting ? "Saving claim…" : "Submit claim for review"}</button>
                <span style={{ color: palette.muted, fontSize: 11 }}>No network request is sent to the merchant source. Payment action: NONE.</span>
              </div>
            </form>
          </section>

          <section style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 22 }}>Evidence history</h2>
              <button onClick={() => snapshotId && void load(snapshotId)} disabled={loading} style={{ ...buttonStyle, background: "#10231d", opacity: loading ? 0.6 : 1 }}>{loading ? "Refreshing…" : "Refresh history"}</button>
            </div>
            {data.items.length === 0 && <div style={boxStyle}><p style={{ margin: 0, color: palette.muted }}>No merchant evidence has been submitted for this snapshot. Submit a fact above; it will remain SUBMITTED until reviewed.</p></div>}
            <div style={{ display: "grid", gap: 12 }}>
              {data.items.map((item) => <article key={item.id} style={{ ...boxStyle, padding: 17 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 340px" }}>
                    <p style={{ margin: "0 0 5px", color: palette.green, fontSize: 11, fontWeight: 900, letterSpacing: 1.2 }}>{labelForField(item.field)}</p>
                    <h3 style={{ margin: 0, fontSize: 23 }}>{String(item.value)}{item.field === "returnWindowDays" ? " days" : item.field === "attributes.ramGb" ? " GB" : ""}</h3>
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer noopener" style={{ color: palette.green, fontSize: 12, overflowWrap: "anywhere" }}>{item.sourceUrl} ↗</a>
                    {item.note && <p style={{ color: palette.muted, fontSize: 12, lineHeight: 1.6, margin: "8px 0 0" }}>{item.note}</p>}
                  </div>
                  <span style={{ border: `1px solid ${item.reviewStatus === "HUMAN_REVIEWED" ? "#276449" : item.reviewStatus === "REJECTED" ? "#7f343f" : "#6c5529"}`, color: item.reviewStatus === "HUMAN_REVIEWED" ? palette.green : item.reviewStatus === "REJECTED" ? palette.red : palette.amber, borderRadius: 9, padding: "7px 9px", fontSize: 10, fontWeight: 900 }}>{item.reviewStatus.replaceAll("_", " ")}</span>
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: palette.muted, fontSize: 10, marginTop: 12 }}>
                  <span>Submitted {dateTime(item.observedAt)}</span><span>Eligible until {dateTime(item.validUntil)}</span><span>SHA-256 {item.contentHash.slice(0, 16)}…</span>
                  {item.reviewedAt && <span>Last review {dateTime(item.reviewedAt)} by {item.reviewerLabel ?? "local reviewer"}</span>}
                </div>
                {item.reviewStatus === "SUBMITTED" && <div style={{ borderTop: `1px solid ${palette.border}`, marginTop: 14, paddingTop: 13, display: "grid", gap: 10 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 9, color: palette.muted, fontSize: 12, lineHeight: 1.5 }}>
                    <input type="checkbox" checked={confirmed[item.id] ?? false} onChange={(event) => { const checked = event.currentTarget.checked; setConfirmed((current) => ({ ...current, [item.id]: checked })); }} style={{ marginTop: 2 }} />
                    I opened this merchant page, confirmed it is the exact selected product/offer, and checked this specific value. I understand PactPay does not independently authenticate the page.
                  </label>
                  <label style={{ display: "grid", gap: 6, color: palette.muted, fontSize: 11 }}>
                    Review note (optional)
                    <input value={reviewNote[item.id] ?? ""} onChange={(event) => { const nextValue = event.currentTarget.value; setReviewNote((current) => ({ ...current, [item.id]: nextValue })); }} maxLength={500} placeholder="Why this claim matches the source" style={inputStyle} />
                  </label>
                  <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                    <button onClick={() => void reviewEvidence(item, "HUMAN_REVIEWED")} disabled={reviewingId !== null || confirmed[item.id] !== true} style={{ ...buttonStyle, opacity: reviewingId !== null || confirmed[item.id] !== true ? 0.5 : 1 }}>{reviewingId === item.id ? "Recording…" : "Mark human-reviewed"}</button>
                    <button onClick={() => void reviewEvidence(item, "REJECTED")} disabled={reviewingId !== null} style={{ ...buttonStyle, background: "#2b1317", borderColor: "#7f343f", opacity: reviewingId !== null ? 0.5 : 1 }}>Reject claim</button>
                  </div>
                </div>}
                {item.reviewStatus !== "SUBMITTED" && item.reviewNote && <p style={{ margin: "11px 0 0", color: palette.muted, fontSize: 11 }}>Review note: {item.reviewNote}</p>}
              </article>)}
            </div>
          </section>

          <aside style={{ ...boxStyle, borderColor: "#6c5529", background: "#19160e", marginBottom: 20 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 15, color: palette.amber }}>Trust boundary — read before reviewing</h2>
            <p style={{ margin: 0, color: palette.muted, fontSize: 12, lineHeight: 1.7 }}>The current Evidence Desk is a local single-user prototype. It validates HTTPS, checks that the source host matches the merchant domain, removes URL query strings/fragments, timestamps the submission, hashes the submitted record, and keeps review decisions as separate append-only events. It does not retrieve the merchant page, verify the content cryptographically, or authenticate the reviewer. “Human-reviewed” means you attested that you inspected the source. Before public deployment, reviewer authentication/authorization, evidence-file capture, server-side source-fetch protections, and stronger provenance controls are required.</p>
          </aside>
          <p style={{ color: palette.muted, fontSize: 10, lineHeight: 1.6, overflowWrap: "anywhere" }}>Local transaction: {data.snapshot.id} · Payment action: NONE · Capture performed by PactPay: No</p>
        </>}
      </div>
    </main>
  );
}

function snapshotUrlIsMerchant(domain: string | undefined, rawUrl: string): boolean {
  if (!domain) return false;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    const base = domain.toLowerCase().replace(/^www\./, "");
    return host === base || host.endsWith(`.${base}`);
  } catch {
    return false;
  }
}
