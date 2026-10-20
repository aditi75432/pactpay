"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { PurchasePact } from "@pactpay/pact-core";

type LiveOffer = {
  snapshotId: string;
  productId: string;
  productTitle: string;
  description: string | null;
  brand: string | null;
  imageUrl: string | null;
  offerDomain: string;
  offerUrl: string;
  price: number;
  currency: string;
  availability: string | null;
  condition: string | null;
  ramGb: number | null;
  structuredAttributes: Record<string, unknown>;
  fetchedAt: string;
  validUntil: string;
};

type SearchDiagnostics = {
  productCount: number;
  rawOfferCount: number;
  acceptedOfferCount: number;
  skippedOfferCount: number;
};

type RefreshResult = {
  checkId: string;
  status: "MATCHED_WITH_CHANGES" | "MATCHED_UNCHANGED" | "OFFER_NOT_FOUND";
  previousSnapshotId: string;
  observedAt: string;
  changedFields: string[];
  refreshedOffer: LiveOffer | null;
  note: string;
  paymentAction: "NONE";
  capturePerformedByPactPay: false;
};

type EvalResult = {
  runId: string;
  offer: {
    id: string; productId: string; title: string; brand: string | null; imageUrl: string | null;
    domain: string; url: string; itemPrice: number; currency: string; availability: string | null;
    condition: string | null; ramGb: number | null; fetchedAt: string; validUntil: string; itemPriceOnly: true;
  };
  verification: { verifiedAt: string; evidenceFresh: boolean; evidenceAttributable: boolean; securityClear: boolean; results: Array<{ constraintId: string; severity?: "hard" | "soft"; status: "pass" | "fail" | "unknown"; actual?: string | number | boolean; evidenceIds: string[]; reason: string }> };
  summary: { decision: "capture" | "block"; reason: string; hardPasses: number; hardFailures: number; softFailures: number };
  missingHardEvidence: Array<{ constraintId: string; reason: string }>;
  paymentAction: "NONE";
  capturePerformedByPactPay: false;
  note: string;
};

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function money(value: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${value.toFixed(2)} ${currency}`; }
}

/** Mirrors the displayed Sandbox quote only. The server recomputes every amount from the stored snapshot. */
function sandboxTestQuote(itemPrice: number) {
  const itemCents = Math.round(itemPrice * 100);
  const shippingCents = 499;
  const taxCents = Math.round((itemCents + shippingCents) * 0.08);
  return {
    item: itemCents / 100,
    shipping: shippingCents / 100,
    tax: taxCents / 100,
    total: (itemCents + shippingCents + taxCents) / 100,
  };
}

type OfferVerdict = "unchecked" | "pass" | "needs-evidence" | "blocked" | "safety-hold";
type VerdictFilter = "all" | "pass" | "needs-evidence" | "blocked";
type ResultKindFilter = "all" | "other" | "accessories";

function getOfferVerdict(result: EvalResult | undefined | null): OfferVerdict {
  if (!result) return "unchecked";
  if (!result.verification.securityClear) return "safety-hold";
  const hardResults = result.verification.results.filter((item) => (item.severity ?? "hard") === "hard");
  if (hardResults.some((item) => item.status === "fail")) return "blocked";
  if (hardResults.some((item) => item.status === "unknown")) return "needs-evidence";
  if (!result.verification.evidenceFresh || !result.verification.evidenceAttributable) return "safety-hold";
  return result.summary.decision === "capture" ? "pass" : "blocked";
}

function verdictLabel(verdict: OfferVerdict): string {
  switch (verdict) {
    case "pass": return "RULES PASS · NO PAYMENT ACTION";
    case "needs-evidence": return "NEEDS EVIDENCE";
    case "blocked": return "BLOCKED · HARD RULE FAILED";
    case "safety-hold": return "SAFETY HOLD";
    default: return "NOT CHECKED AGAINST PACT";
  }
}

function verdictColor(verdict: OfferVerdict): string {
  switch (verdict) {
    case "pass": return "#7fe2ab";
    case "needs-evidence": return "#ffd891";
    case "blocked": return "#ffb8b8";
    case "safety-hold": return "#d7c9ff";
    default: return "#a5b8b0";
  }
}

function verdictReason(result: EvalResult | undefined | null, pact: PurchasePact | null): string {
  const verdict = getOfferVerdict(result);
  if (!result) return "Check this live listing against your approved Purchase Pact to see what matches and what still needs evidence.";
  if (verdict === "pass") return "All evaluated hard rules passed on fresh, attributable catalog evidence. This is not checkout or payment confirmation.";
  if (verdict === "safety-hold") return "PactPay cannot rely on this result because freshness, attribution or a security prerequisite needs review.";

  const hardResults = result.verification.results.filter((item) => (item.severity ?? "hard") === "hard");
  const issue = verdict === "blocked"
    ? hardResults.find((item) => item.status === "fail")
    : hardResults.find((item) => item.status === "unknown");
  if (!issue) return verdict === "blocked" ? "At least one hard requirement failed." : "A required fact has not been verified yet.";

  const rule = pact?.constraints.find((constraint) => constraint.id === issue.constraintId);
  const observed = issue.actual === undefined || issue.actual === null ? "not provided" : String(issue.actual);
  if (!rule) return verdict === "blocked" ? "This listing fails a hard Purchase Pact requirement." : "A hard Purchase Pact requirement still needs evidence.";

  if (issue.status === "fail" && rule.field === "attributes.itemPrice" && rule.comparator === "lte") {
    const cap = typeof rule.expected === "number" ? money(rule.expected, result.offer.currency) : String(rule.expected);
    const actualPrice = typeof issue.actual === "number" ? issue.actual : typeof issue.actual === "string" ? Number(issue.actual) : NaN;
    if (Number.isFinite(actualPrice)) return `Item price ${money(actualPrice, result.offer.currency)} is above your ${cap} limit.`;
    return `${rule.description} The catalog price value could not be interpreted safely.`;
  }
  if (issue.status === "fail" && rule.field === "attributes.brand") {
    return `Brand mismatch: the listing reports ${observed}; your rule requires ${String(rule.expected)}.`;
  }
  if (issue.status === "unknown") {
    return `${rule.description} The catalog does not provide this fact, so it cannot be treated as a pass.`;
  }
  return `${rule.description} Observed value: ${observed}.`;
}

// This is a UI-only title heuristic. It never changes deterministic policy results.
const ACCESSORY_TITLE_TERMS = /\b(case|cover|protector|sleeve|skin|holder|charm|strap|replacement|ear\s?tips?|earbud\s?tips?|carry(?:ing)?\s?pouch|protective\s?wrap|mount|clip)\b/i;
function looksLikeAccessory(offer: LiveOffer, userQuery: string): boolean {
  // If the user explicitly asked for an accessory category, don't move it to the secondary group.
  if (ACCESSORY_TITLE_TERMS.test(userQuery)) return false;
  return ACCESSORY_TITLE_TERMS.test(offer.productTitle);
}

function cardFactLabels(offer: LiveOffer, pact: PurchasePact | null): string[] {
  const labels: string[] = [];
  const requires = (field: string) => Boolean(pact?.constraints.some((rule) => rule.field === field && rule.severity === "hard"));

  if (offer.availability) labels.push(offer.availability);
  else if (requires("attributes.availability")) labels.push("Availability not listed");

  if (offer.condition) labels.push(offer.condition);
  else if (requires("attributes.condition")) labels.push("Condition not listed");

  // Show RAM only when the catalog supplied it or the approved Pact actually requires it.
  // This avoids irrelevant “RAM unknown” noise on products such as headphones and AirPods.
  if (offer.ramGb !== null) labels.push(`${offer.ramGb} GB RAM · structured catalog fact`);
  else if (requires("attributes.ramGb")) labels.push("RAM not listed");

  return labels;
}

const palette = {
  text: "#edf7f2", muted: "#a5b8b0", green: "#7fe2ab", border: "#28443a", panel: "#0e1c19",
  bg: "radial-gradient(ellipse at 15% 0%, #16372d 0%, #091311 48%, #07100e 100%)",
};

export default function DiscoverPage() {
  const [query, setQuery] = useState("");
  const [activePact, setActivePact] = useState<PurchasePact | null>(null);
  const [intentMeta, setIntentMeta] = useState<{ title?: string; originalIntent?: string; searchQuery?: string; compiler?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [latestRefresh, setLatestRefresh] = useState<RefreshResult | null>(null);
  const [offers, setOffers] = useState<LiveOffer[]>([]);
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<SearchDiagnostics | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<EvalResult | null>(null);
  const [offerEvaluations, setOfferEvaluations] = useState<Record<string, EvalResult>>({});
  const [bulkEvaluating, setBulkEvaluating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number } | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");
  const [resultKindFilter, setResultKindFilter] = useState<ResultKindFilter>("all");
  const [checkoutOffer, setCheckoutOffer] = useState<LiveOffer | null>(null);
  const [checkoutAcknowledged, setCheckoutAcknowledged] = useState(false);
  const [checkoutStarting, setCheckoutStarting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [focusSnapshotId, setFocusSnapshotId] = useState<string | null>(null);
  const [agentHandoffMode, setAgentHandoffMode] = useState(false);
  const [agentHandoffMissing, setAgentHandoffMissing] = useState(false);

  async function search(searchTerm: string = query) {
    setAgentHandoffMode(false); setAgentHandoffMissing(false);
    try { window.sessionStorage.removeItem("pactpay.agent.discovery.v1"); } catch { /* Search still works if storage is unavailable. */ }
    setLoading(true); setMessage(null); setEvaluation(null); setOfferEvaluations({}); setBulkProgress(null); setVerdictFilter("all"); setResultKindFilter("all"); setOffers([]); setDiagnostics(null); setLatestRefresh(null);
    try {
      const response = await fetch("/api/discovery/search", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searchTerm }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Product search failed.");
      const returnedOffers = payload.offers as LiveOffer[];
      const returnedDiagnostics = payload.diagnostics as SearchDiagnostics | undefined;
      setOffers(returnedOffers);
      setDiagnostics(returnedDiagnostics ?? null);
      setSearchedAt(payload.fetchedAt as string);
      if (returnedOffers.length > 0) {
        setMessage(`Found ${returnedOffers.length} offer listings from Channel3.`);
      } else if (returnedDiagnostics?.productCount === 0) {
        setMessage('Channel3 returned zero product records for this query. Try a broad query such as "laptop" or "wireless headphones".');
      } else if (returnedDiagnostics && returnedDiagnostics.rawOfferCount === 0) {
        setMessage(`Channel3 returned ${returnedDiagnostics.productCount} product record(s), but none contained merchant offers. Try another query; see the diagnostic counts below.`);
      } else if (returnedDiagnostics) {
        setMessage(`Channel3 returned ${returnedDiagnostics.productCount} product(s) and ${returnedDiagnostics.rawOfferCount} offer record(s), but PactPay accepted none. The response schema or one or more required offer fields may differ; diagnostic counts are shown below.`);
      } else {
        setMessage('Channel3 returned no usable offer listings. Try a broader query.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unexpected search error.");
    } finally { setLoading(false); }
  }

  async function refreshOffer(offer: LiveOffer) {
    setRefreshingId(offer.snapshotId);
    setMessage(null);
    setEvaluation(null);
    setOfferEvaluations((current) => { const next = { ...current }; delete next[offer.snapshotId]; return next; });
    try {
      const response = await fetch("/api/discovery/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId: offer.snapshotId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Offer refresh failed.");
      const result = payload as RefreshResult;
      setLatestRefresh(result);
      if (result.refreshedOffer) {
        setOffers((current) => current.map((item) => item.snapshotId === offer.snapshotId ? result.refreshedOffer! : item));
        setMessage(result.changedFields.length > 0
          ? `Catalog refresh found changes: ${result.changedFields.join(", ")}. The new observation is saved as a separate snapshot.`
          : "Catalog refresh matched the same merchant offer. A new immutable snapshot was saved.");
      } else {
        setMessage("Refresh could not uniquely match the same merchant offer. The old snapshot was preserved; run a fresh search before relying on current availability.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unexpected refresh error.");
    } finally {
      setRefreshingId(null);
    }
  }

  async function requestEvaluation(offer: LiveOffer): Promise<EvalResult> {
    if (!activePact) throw new Error("Approve a Purchase Pact in Pact Composer before checking offers.");
    const response = await fetch("/api/discovery/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshotId: offer.snapshotId, ...(activePact ? { pact: activePact } : {}) }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Pact evaluation failed.");
    return payload as EvalResult;
  }

  async function evaluate(offer: LiveOffer) {
    setEvaluatingId(offer.snapshotId); setMessage(null); setEvaluation(null);
    try {
      const result = await requestEvaluation(offer);
      setOfferEvaluations((current) => ({ ...current, [offer.snapshotId]: result }));
      setEvaluation(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unexpected evaluation error.");
    } finally { setEvaluatingId(null); }
  }

  async function evaluateAllOffers() {
    if (!activePact) { setMessage("Approve a Purchase Pact in the Pact Composer before checking offers."); return; }
    if (offers.length === 0 || bulkEvaluating || evaluatingId !== null || refreshingId !== null) return;
    const currentOffers = [...offers];
    setBulkEvaluating(true);
    setBulkProgress({ completed: 0, total: currentOffers.length });
    setEvaluation(null);
    setMessage(null);
    let succeeded = 0;
    let failed = 0;

    // Sequential requests keep the demo responsive and avoid bursting the local DB/API.
    // These calls only evaluate stored snapshots; they never create or settle PayPal orders.
    for (let index = 0; index < currentOffers.length; index += 1) {
      const offer = currentOffers[index];
      if (!offer) continue;
      try {
        const result = await requestEvaluation(offer);
        setOfferEvaluations((current) => ({ ...current, [offer.snapshotId]: result }));
        succeeded += 1;
      } catch {
        failed += 1;
      }
      setBulkProgress({ completed: index + 1, total: currentOffers.length });
    }

    setMessage(`Checked ${succeeded} of ${currentOffers.length} offer(s) against your approved Purchase Pact.${failed > 0 ? ` ${failed} evaluation(s) failed and need a retry.` : ""} No PayPal order, authorization, capture or void was created.`);
    setBulkEvaluating(false);
  }

  async function startOfferBoundSandboxCheckout() {
    if (!checkoutOffer || !activePact || !checkoutAcknowledged || checkoutStarting) return;
    setCheckoutStarting(true);
    setCheckoutError(null);
    try {
      const response = await fetch("/api/paypal/offer-demo/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId: checkoutOffer.snapshotId,
          pact: activePact,
          approved: true,
          sandboxQuoteAcknowledged: true,
        }),
        cache: "no-store",
      });
      const payload = await response.json() as { approvalUrl?: string; error?: string; transactionId?: string; amount?: string; quote?: { total?: number } };
      if (!response.ok || !payload.approvalUrl || !payload.transactionId) {
        throw new Error(payload.error ?? "PactPay could not create the bound Sandbox test checkout.");
      }
      // The server recalculates the total from the exact persisted Channel3 snapshot
      // and binds that snapshot, the approved Pact and quote before exposing this URL.
      window.location.assign(payload.approvalUrl);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Unexpected Sandbox checkout error.");
      setCheckoutStarting(false);
    }
  }

  useEffect(() => {
    try {
      const pactRaw = window.sessionStorage.getItem("pactpay.activePact.v1");
      if (pactRaw) {
        const parsed = JSON.parse(pactRaw) as PurchasePact;
        if (parsed && typeof parsed.id === "string" && Array.isArray(parsed.constraints)) setActivePact(parsed);
      }
      const metaRaw = window.sessionStorage.getItem("pactpay.activeIntent.v1");
      if (metaRaw) setIntentMeta(JSON.parse(metaRaw) as { title?: string; originalIntent?: string; searchQuery?: string; compiler?: string });
    } catch {
      setActivePact(null);
      setIntentMeta(null);
    }
    const routeParams = new URLSearchParams(window.location.search);
    const fromIntent = routeParams.get("query")?.trim();
    const fromAgent = routeParams.get("fromAgent") === "1";
    const selectedSnapshotId = routeParams.get("focusSnapshotId")?.trim();
    if (selectedSnapshotId) setFocusSnapshotId(selectedSnapshotId);
    if (fromAgent) {
      try {
        const cacheRaw = window.sessionStorage.getItem("pactpay.agent.discovery.v1");
        const cache = cacheRaw ? JSON.parse(cacheRaw) as { query?: string; offers?: LiveOffer[]; offerEvaluations?: Record<string, EvalResult>; searchedAt?: string | null; selectedSnapshotId?: string; createdAt?: string } : null;
        const selectedPresent = Boolean(selectedSnapshotId && cache?.offers?.some((offer) => offer.snapshotId === selectedSnapshotId));
        const selectedEvaluationPresent = Boolean(selectedSnapshotId && cache?.offerEvaluations?.[selectedSnapshotId]);
        const ageMs = cache?.createdAt ? Date.now() - Date.parse(cache.createdAt) : 0;
        const cacheFresh = !cache?.createdAt || (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 30 * 60 * 1000);
        if (cache && Array.isArray(cache.offers) && cache.offers.length > 0 && cache.offers.length <= 3 && cache.offerEvaluations && cache.query?.trim() === fromIntent && cache.selectedSnapshotId === selectedSnapshotId && selectedPresent && selectedEvaluationPresent && cacheFresh) {
          setQuery(cache.query);
          setOffers(cache.offers);
          setOfferEvaluations(cache.offerEvaluations);
          setSearchedAt(cache.searchedAt ?? null);
          setAgentHandoffMode(true);
          setMessage(`Loaded ${cache.offers.length} re-confirmed Shopping Agent shortlist offer(s), including your selected item. No new search was run.`);
          // Keep the handoff in this browser session so refresh/back navigation can't silently
          // replace the selected shortlist with a new, unfiltered search.
        } else if (fromIntent) {
          setQuery(fromIntent);
          setAgentHandoffMissing(true);
          setMessage("We couldn't restore this agent shortlist from the current browser session. No replacement search was run, so the selected offer won't be silently changed.");
        }
      } catch {
        if (fromIntent) {
          setQuery(fromIntent);
          setAgentHandoffMissing(true);
          setMessage("We couldn't restore this agent shortlist. No replacement search was run. You can explicitly search the full live catalog below.");
        }
      }
    } else if (fromIntent) {
      setQuery(fromIntent);
      void search(fromIntent);
    }
    // A fresh route entry should seed the search exactly once from the approved intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!focusSnapshotId || offers.length === 0) return;
    const target = document.getElementById(`offer-${focusSnapshotId}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setMessage("The Shopping Agent selected this exact saved snapshot. Confirm the decision and evidence before continuing.");
    }
    setFocusSnapshotId(null);
  }, [focusSnapshotId, offers]);

  const boxStyle: CSSProperties = { background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 18, padding: 20 };
  const buttonStyle: CSSProperties = { border: `1px solid ${palette.border}`, borderRadius: 10, padding: "11px 14px", background: "#17422f", color: palette.text, fontWeight: 800, cursor: "pointer", fontSize: 13 };
  const intentForRelevance = [intentMeta?.originalIntent, intentMeta?.searchQuery, query].filter(Boolean).join(" ");
  const accessoryCount = offers.filter((offer) => looksLikeAccessory(offer, intentForRelevance)).length;
  const otherListingCount = offers.length - accessoryCount;
  const currentVerdicts = offers.map((offer) => getOfferVerdict(offerEvaluations[offer.snapshotId]));
  const verdictCounts = {
    all: offers.length,
    pass: currentVerdicts.filter((item) => item === "pass").length,
    needsEvidence: currentVerdicts.filter((item) => item === "needs-evidence").length,
    blocked: currentVerdicts.filter((item) => item === "blocked" || item === "safety-hold").length,
  };
  const evaluatedOffers = offers.filter((offer) => Boolean(offerEvaluations[offer.snapshotId]));
  const evaluatedPassCount = evaluatedOffers.filter((offer) => getOfferVerdict(offerEvaluations[offer.snapshotId]) === "pass").length;
  const evaluatedNeedsEvidenceCount = evaluatedOffers.filter((offer) => getOfferVerdict(offerEvaluations[offer.snapshotId]) === "needs-evidence").length;
  const evaluatedBlockedCount = evaluatedOffers.filter((offer) => {
    const verdict = getOfferVerdict(offerEvaluations[offer.snapshotId]);
    return verdict === "blocked" || verdict === "safety-hold";
  }).length;
  const failuresForField = (field: string) => {
    const ruleIds = new Set((activePact?.constraints ?? []).filter((rule) => rule.field === field && rule.severity === "hard").map((rule) => rule.id));
    if (ruleIds.size === 0) return 0;
    return evaluatedOffers.filter((offer) => offerEvaluations[offer.snapshotId]?.verification.results.some((result) => ruleIds.has(result.constraintId) && result.status === "fail")).length;
  };
  const itemPriceFailureCount = failuresForField("attributes.itemPrice");
  const brandFailureCount = failuresForField("attributes.brand");
  const visibleOffers = offers
    .filter((offer) => {
      const verdict = getOfferVerdict(offerEvaluations[offer.snapshotId]);
      if (verdictFilter === "pass" && verdict !== "pass") return false;
      if (verdictFilter === "needs-evidence" && verdict !== "needs-evidence") return false;
      if (verdictFilter === "blocked" && verdict !== "blocked" && verdict !== "safety-hold") return false;
      const accessory = looksLikeAccessory(offer, intentForRelevance);
      if (resultKindFilter === "accessories" && !accessory) return false;
      if (resultKindFilter === "other" && accessory) return false;
      return true;
    })
    // Main listings appear before title-identified accessories; this does not alter evaluation.
    .sort((a, b) => Number(looksLikeAccessory(a, intentForRelevance)) - Number(looksLikeAccessory(b, intentForRelevance)));
  return (
    <main style={{ minHeight: "100vh", background: palette.bg, color: palette.text, padding: "28px 20px 64px", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 34 }}>
          <a href="/" style={{ color: palette.text, textDecoration: "none", fontWeight: 900, letterSpacing: 2 }}>PACTPAY <span style={{ color: palette.green }}>///</span></a>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}><a href="/agent" style={{ color: palette.green }}>Shopping Agent ↗</a><a href="/control-center" style={{ color: palette.green }}>Control Center ↗</a><a href="/" style={{ color: palette.muted }}>Pact Composer ↗</a><a href="/evidence" style={{ color: palette.muted }}>Evidence Desk ↗</a><a href="/pact-lab" style={{ color: palette.muted }}>Policy Lab ↗</a><a href="/protected-demo" style={{ color: palette.muted }}>Sandbox lab ↗</a></div>
        </header>
        <section style={{ maxWidth: 900, marginBottom: 28 }}>
          <p style={{ color: palette.green, fontSize: 12, letterSpacing: 2, fontWeight: 900 }}>02 · LIVE OFFER DISCOVERY</p>
          <h1 style={{ fontSize: "clamp(34px, 5vw, 60px)", lineHeight: 1, letterSpacing: -2, margin: "12px 0 18px" }}>Real offers.<br /><span style={{ color: palette.green }}>No invented proof.</span></h1>
          <p style={{ color: palette.muted, fontSize: 16, lineHeight: 1.7, maxWidth: 780 }}>Discover real catalog listings, compare the facts each source can actually support, and run a deterministic check against the Purchase Pact you approved. PactPay keeps item price separate from shipping, returns, delivery and the final landed total.</p>
        </section>

        {activePact && <section style={{ ...boxStyle, marginBottom: 18, borderColor: "#557c45", background: "linear-gradient(110deg, #10241d 0%, #112c20 72%, #1b3322 100%)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ minWidth: 0, flex: "1 1 420px" }}>
              <p style={{ color: palette.green, fontSize: 10, fontWeight: 900, letterSpacing: 1.7, margin: "0 0 7px" }}>YOUR APPROVED PURCHASE PACT · v{activePact.version}</p>
              <h2 style={{ margin: 0, fontSize: 21, lineHeight: 1.3 }}>Live offers, checked against your rules.</h2>
              {intentMeta?.originalIntent && <p style={{ margin: "8px 0 0", color: palette.muted, fontSize: 12, lineHeight: 1.6 }}>“{intentMeta.originalIntent}”</p>}
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              <span style={{ border: "1px solid #42664c", borderRadius: 8, padding: "7px 9px", color: palette.green, fontSize: 12, fontWeight: 900 }}>{activePact.constraints.filter((item) => item.severity === "hard").length} HARD RULES</span>
              <span style={{ border: "1px solid #42664c", borderRadius: 8, padding: "7px 9px", color: "#d7c9ff", fontSize: 12, fontWeight: 900 }}>{activePact.constraints.filter((item) => item.severity === "soft").length} PREFERENCES</span>
              <button onClick={() => { window.sessionStorage.removeItem("pactpay.activePact.v1"); window.sessionStorage.removeItem("pactpay.activeIntent.v1"); window.location.href = "/"; }} style={{ ...buttonStyle, background: "transparent" }}>Edit pact ↗</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 15 }}>
            {activePact.constraints.map((constraint) => <span key={constraint.id} title={constraint.field} style={{ border: `1px solid ${constraint.severity === "hard" ? "#3a6845" : "#534b70"}`, color: constraint.severity === "hard" ? "#c7f1c0" : "#d7c9ff", background: constraint.severity === "hard" ? "#163324" : "#282239", borderRadius: 100, padding: "6px 9px", fontSize: 12 }}>{constraint.severity === "hard" ? "◆" : "◇"} {constraint.description}</span>)}
          </div>
          <p style={{ margin: "13px 0 0", color: "#a5b8b0", fontSize: 11, lineHeight: 1.6 }}>AI proposes the draft; PactPay validates it at the API boundary. Catalog item price is not the final landed total. Missing, stale or conflicting evidence stays UNKNOWN and blocks hard requirements.</p>
        </section>}

        <section style={{ ...boxStyle, marginBottom: 22 }}>
          <label htmlFor="product-query" style={{ display: "block", fontSize: 12, color: palette.muted, fontWeight: 800, marginBottom: 8 }}>PRODUCT SEARCH</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input id="product-query" value={query} onChange={(event) => setQuery(event.currentTarget.value)} maxLength={180} onKeyDown={(event) => { if (event.key === "Enter" && !loading) void search(); }} placeholder="e.g. wireless mouse, AirPods, USB-C charger" style={{ flex: "1 1 380px", minWidth: 0, border: `1px solid ${palette.border}`, background: "#07110e", color: palette.text, borderRadius: 10, padding: "13px 14px", fontSize: 15 }} />
            <button onClick={() => void search()} disabled={loading || !query.trim()} style={{ ...buttonStyle, opacity: loading || !query.trim() ? 0.6 : 1 }}>{loading ? "Searching Channel3…" : "Find real offers →"}</button>
          </div>
          {message && <p aria-live="polite" style={{ color: palette.muted, margin: "12px 0 0", fontSize: 13 }}>{message}</p>}
          {agentHandoffMode && <div role="status" style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", marginTop: 12, padding: 14, border: "1px solid #42664c", borderRadius: 12, background: "#10251d" }}><div><strong style={{ color: palette.green, fontSize: 13 }}>SHOPPING AGENT SHORTLIST</strong><p style={{ color: palette.muted, fontSize: 12, lineHeight: 1.55, margin: "5px 0 0" }}>Showing only up to three offers the agent re-confirmed and re-evaluated—not the full unfiltered catalog. Your selected offer is highlighted below.</p></div><a href="/agent" style={{ color: palette.green, fontSize: 13, fontWeight: 800, whiteSpace: "nowrap" }}>Back to agent ↗</a></div>}
          {agentHandoffMissing && <div role="alert" style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", marginTop: 12, padding: 14, border: "1px solid #705a2e", borderRadius: 12, background: "#302816" }}><div><strong style={{ color: "#ffd891", fontSize: 13 }}>AGENT SHORTLIST NOT RESTORED</strong><p style={{ color: palette.muted, fontSize: 12, lineHeight: 1.55, margin: "5px 0 0" }}>No automatic replacement search was run. Start a new live search only if you'd like to leave the agent shortlist.</p></div><button onClick={() => void search(query)} disabled={loading || !query.trim()} style={buttonStyle}>Search full catalog →</button></div>}
          {diagnostics && <p style={{ color: palette.muted, fontSize: 12, margin: "8px 0 0" }}>Search diagnostics · products: {diagnostics.productCount} · upstream offer records: {diagnostics.rawOfferCount} · accepted: {diagnostics.acceptedOfferCount} · skipped: {diagnostics.skippedOfferCount}</p>}
          {searchedAt && <p style={{ color: palette.muted, fontSize: 12, margin: "10px 0 0" }}>Snapshot retrieved {dateTime(searchedAt)} · local catalog freshness window 10 minutes · stale snapshots fail closed.</p>}
          {latestRefresh && <div style={{ marginTop: 12, padding: 12, border: `1px solid ${latestRefresh.status === "OFFER_NOT_FOUND" ? "#7f343f" : latestRefresh.changedFields.length ? "#6c5529" : palette.border}`, borderRadius: 10, background: "#07110e" }}>
            <p style={{ margin: "0 0 5px", fontWeight: 900, color: latestRefresh.status === "OFFER_NOT_FOUND" ? "#ffb8b8" : latestRefresh.changedFields.length ? "#ffd891" : palette.green, fontSize: 12 }}>
              {latestRefresh.status === "OFFER_NOT_FOUND" ? "SAME OFFER NOT CONFIRMED" : latestRefresh.changedFields.length ? `CATALOG CHANGES DETECTED · ${latestRefresh.changedFields.length}` : "FRESH CATALOG SNAPSHOT SAVED"}
            </p>
            <p style={{ margin: 0, color: palette.muted, fontSize: 12, lineHeight: 1.6 }}>{latestRefresh.note}</p>
            {latestRefresh.changedFields.length > 0 && <p style={{ margin: "6px 0 0", color: "#ffd891", fontSize: 11 }}>Changed fields: {latestRefresh.changedFields.join(", ")}</p>}
            <p style={{ margin: "6px 0 0", color: palette.muted, fontSize: 11 }}>Check {latestRefresh.checkId} · observed {dateTime(latestRefresh.observedAt)} · payment action NONE</p>
          </div>}
        </section>

        <section style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 23 }}>Offer decision workspace</h2>
              <p style={{ color: palette.muted, fontSize: 13, margin: "6px 0 0", lineHeight: 1.55 }}>Compare real catalog listings, then see what passes, fails, or still needs evidence.</p>
            </div>
            <span style={{ color: palette.muted, fontSize: 13 }}>{offers.length} listing(s)</span>
          </div>

          {offers.length > 0 && <div style={{ ...boxStyle, marginBottom: 16, padding: 16, borderColor: "#365847", background: "linear-gradient(110deg, #10221d 0%, #0d1b17 100%)" }}>
            <div style={{ display: "flex", gap: 14, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 300px", minWidth: 0 }}>
                <p style={{ color: palette.green, fontSize: 12, letterSpacing: 1.4, fontWeight: 900, margin: "0 0 5px" }}>{activePact ? "DETERMINISTIC CHECK · YOUR APPROVED PACT" : "LIVE CATALOG · NOT EVALUATED"}</p>
                <p style={{ color: palette.muted, fontSize: 13, lineHeight: 1.55, margin: 0 }}>Evaluation checks server-stored offer snapshots only. A rules pass is not a verified checkout total and never triggers PayPal.</p>
              </div>
              {activePact ? <button onClick={() => void evaluateAllOffers()} disabled={offers.length === 0 || bulkEvaluating || evaluatingId !== null || refreshingId !== null || loading} style={{ ...buttonStyle, padding: "13px 17px", opacity: bulkEvaluating || evaluatingId !== null || refreshingId !== null || loading ? 0.6 : 1 }}>
                {bulkEvaluating ? `Checking ${bulkProgress?.completed ?? 0} of ${offers.length}…` : currentVerdicts.some((item) => item !== "unchecked") ? `Re-check all ${offers.length} offers →` : `Check all ${offers.length} offers →`}
              </button> : <a href="/" style={{ ...buttonStyle, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Approve a Purchase Pact first ↗</a>}
            </div>
            {bulkProgress && <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: palette.muted, fontSize: 12, marginBottom: 6 }}><span>{bulkEvaluating ? "Evaluating snapshots sequentially" : "Last evaluation batch"}</span><span>{bulkProgress.completed}/{bulkProgress.total}</span></div>
              <div role="progressbar" aria-valuemin={0} aria-valuemax={bulkProgress.total} aria-valuenow={bulkProgress.completed} style={{ height: 6, borderRadius: 99, overflow: "hidden", background: "#263b33" }}><div style={{ width: `${bulkProgress.total ? (bulkProgress.completed / bulkProgress.total) * 100 : 0}%`, height: "100%", background: palette.green, transition: "width 180ms ease" }} /></div>
            </div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              {([
                { value: "all", label: "All offers", count: verdictCounts.all },
                { value: "pass", label: "Rules pass", count: verdictCounts.pass },
                { value: "needs-evidence", label: "Needs evidence", count: verdictCounts.needsEvidence },
                { value: "blocked", label: "Blocked / safety hold", count: verdictCounts.blocked },
              ] as Array<{ value: VerdictFilter; label: string; count: number }>).map((item) => {
                const active = verdictFilter === item.value;
                const color = item.value === "pass" ? "#7fe2ab" : item.value === "needs-evidence" ? "#ffd891" : item.value === "blocked" ? "#ffb8b8" : palette.text;
                return <button key={item.value} onClick={() => setVerdictFilter(item.value)} aria-pressed={active} style={{ border: `1px solid ${active ? color : palette.border}`, borderRadius: 99, padding: "8px 12px", background: active ? `${color}18` : "transparent", color: active ? color : palette.muted, fontWeight: 800, fontSize: 13, cursor: "pointer" }}>{item.label} <span style={{ opacity: 0.85 }}>({item.count})</span></button>;
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <span style={{ color: palette.muted, fontSize: 12, fontWeight: 800 }}>LISTING TYPE · TITLE HINT ONLY</span>
              {([{ value: "all", label: "All listing types", count: offers.length }, { value: "other", label: "Other listings", count: otherListingCount }, { value: "accessories", label: "Likely accessories", count: accessoryCount }] as Array<{ value: ResultKindFilter; label: string; count: number }>).map((item) => {
                const active = resultKindFilter === item.value;
                return <button key={item.value} onClick={() => setResultKindFilter(item.value)} aria-pressed={active} style={{ border: `1px solid ${active ? palette.green : palette.border}`, borderRadius: 99, padding: "7px 11px", background: active ? "#173a2a" : "transparent", color: active ? palette.green : palette.muted, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>{item.label} ({item.count})</button>;
              })}
            </div>
          </div>}

          {!activePact && offers.length > 0 && <div role="status" style={{ ...boxStyle, borderColor: "#6c5529", marginBottom: 14 }}><strong>One quick step before evaluation</strong><p style={{ margin: "7px 0 10px", color: palette.muted }}>These are live catalog listings, but they have not been checked against your requirements. Create and approve a Purchase Pact first; PactPay will not silently substitute default laptop rules.</p><a href="/" style={{ color: palette.green, fontWeight: 800 }}>Open Pact Composer →</a></div>}

          {evaluatedOffers.length > 0 && activePact && <div role="status" aria-live="polite" style={{ ...boxStyle, marginBottom: 14, borderColor: evaluatedPassCount > 0 ? "#3a6845" : "#6c5529", background: evaluatedPassCount > 0 ? "#10251b" : "#19160e" }}>
            <p style={{ margin: "0 0 6px", color: palette.green, fontSize: 11, fontWeight: 900, letterSpacing: 1.3 }}>YOUR RESULTS · LIVE CATALOG FACTS</p>
            <h3 style={{ margin: 0, fontSize: 20, lineHeight: 1.35 }}>{evaluatedPassCount > 0 ? `${evaluatedPassCount} listing${evaluatedPassCount === 1 ? "" : "s"} meet every evaluated hard rule` : evaluatedOffers.length === offers.length ? "No current listings meet every hard rule" : "No checked listing meets all hard rules yet"}</h3>
            <p style={{ margin: "7px 0 0", color: palette.muted, fontSize: 13, lineHeight: 1.6 }}>Checked {evaluatedOffers.length} of {offers.length} listings: {evaluatedBlockedCount} blocked, {evaluatedNeedsEvidenceCount} need evidence, {evaluatedPassCount} pass. These are catalog-policy results—not a verified final checkout total.</p>
            {(itemPriceFailureCount > 0 || brandFailureCount > 0) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 11 }}>
              {itemPriceFailureCount > 0 && <span style={{ border: `1px solid ${palette.border}`, borderRadius: 9, padding: "7px 9px", fontSize: 12 }}>Price limit failed on {itemPriceFailureCount} listing{itemPriceFailureCount === 1 ? "" : "s"}</span>}
              {brandFailureCount > 0 && <span style={{ border: `1px solid ${palette.border}`, borderRadius: 9, padding: "7px 9px", fontSize: 12 }}>Brand requirement failed on {brandFailureCount} listing{brandFailureCount === 1 ? "" : "s"}</span>}
            </div>}
            <p style={{ margin: "9px 0 0", color: palette.muted, fontSize: 11, lineHeight: 1.5 }}>Accessory grouping is estimated from listing titles for navigation only; it does not change any pass/block decision.</p>
          </div>}

          {visibleOffers.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
            {visibleOffers.map((offer) => {
              const storedEvaluation = offerEvaluations[offer.snapshotId];
              const verdict = getOfferVerdict(storedEvaluation);
              const statusColor = verdictColor(verdict);
              const hardFailCount = storedEvaluation?.verification.results.filter((item) => (item.severity ?? "hard") === "hard" && item.status === "fail").length ?? 0;
              const hardUnknownCount = storedEvaluation?.verification.results.filter((item) => (item.severity ?? "hard") === "hard" && item.status === "unknown").length ?? 0;
              return <article id={`offer-${offer.snapshotId}`} key={offer.snapshotId} style={{ ...boxStyle, borderColor: verdict === "unchecked" ? palette.border : `${statusColor}85`, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                {offer.imageUrl ? <img src={offer.imageUrl} alt={offer.productTitle} loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: 170, objectFit: "contain", background: "#07110e", borderRadius: 10 }} /> : <div style={{ height: 170, display: "grid", placeItems: "center", background: "#07110e", borderRadius: 10, color: palette.muted }}>No catalog image</div>}
                <div><p style={{ color: palette.green, fontSize: 12, fontWeight: 900, margin: "0 0 6px" }}>{offer.brand ?? "Brand not supplied"} · {offer.offerDomain}</p><h3 style={{ margin: 0, fontSize: 18, lineHeight: 1.4 }}>{offer.productTitle}</h3><p style={{ color: palette.muted, fontSize: 12, margin: "7px 0 0" }}>Product ID: {offer.productId}</p>{looksLikeAccessory(offer, intentForRelevance) && <p style={{ margin: "9px 0 0", display: "inline-flex", border: "1px solid #6c5529", borderRadius: 8, padding: "5px 8px", color: "#ffd891", fontSize: 11, fontWeight: 800 }}>LIKELY ACCESSORY · TITLE HINT</p>}</div>
                <p style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>{money(offer.price, offer.currency)} <span style={{ color: palette.muted, fontSize: 12, fontWeight: 500 }}>item price</span></p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {cardFactLabels(offer, activePact).map((label) => <span key={label} style={{ border: `1px solid ${palette.border}`, borderRadius: 100, padding: "5px 8px", color: palette.muted, fontSize: 12 }}>{label}</span>)}
                </div>
                <div style={{ padding: 12, borderRadius: 12, border: `1px solid ${verdict === "unchecked" ? palette.border : `${statusColor}70`}`, background: verdict === "unchecked" ? "#0a1512" : `${statusColor}0d` }}>
                  <p style={{ color: statusColor, fontSize: 12, fontWeight: 900, letterSpacing: 0.5, margin: "0 0 6px" }}>{verdictLabel(verdict)}</p>
                  <p style={{ color: palette.muted, fontSize: 13, lineHeight: 1.5, margin: 0 }}>{verdictReason(storedEvaluation, activePact)}</p>
                  {storedEvaluation && <p style={{ color: palette.muted, fontSize: 12, margin: "8px 0 0" }}>{hardFailCount} hard failure(s) · {hardUnknownCount} hard rule(s) needing evidence</p>}
                </div>
                <p style={{ margin: 0, color: palette.muted, fontSize: 12, lineHeight: 1.5 }}>Catalog observation: {dateTime(offer.fetchedAt)} · valid until {dateTime(offer.validUntil)}</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
                  <a href={offer.offerUrl} target="_blank" rel="noreferrer noopener" style={{ color: palette.green, padding: "9px 0", fontSize: 13, fontWeight: 800 }}>View merchant offer ↗</a>
                  <a href={`/evidence?snapshotId=${encodeURIComponent(offer.snapshotId)}`} style={{ color: palette.green, padding: "9px 0", fontSize: 13, fontWeight: 800 }}>Collect merchant evidence ↗</a>
                  <button onClick={() => void refreshOffer(offer)} disabled={refreshingId !== null || evaluatingId !== null || bulkEvaluating || loading} style={{ ...buttonStyle, flex: "1 1 140px", background: "#10231d", opacity: refreshingId !== null || evaluatingId !== null || bulkEvaluating || loading ? 0.6 : 1 }}>{refreshingId === offer.snapshotId ? "Refreshing…" : "Refresh catalog facts"}</button>
                  {storedEvaluation && <button onClick={() => setEvaluation(storedEvaluation)} disabled={bulkEvaluating || refreshingId !== null} style={{ ...buttonStyle, flex: "1 1 120px", background: "#10231d" }}>View decision details</button>}
                  <button onClick={() => void evaluate(offer)} disabled={!activePact || evaluatingId !== null || refreshingId !== null || bulkEvaluating || loading} title={!activePact ? "Approve a Purchase Pact before evaluation." : undefined} style={{ ...buttonStyle, flex: "1 1 140px", opacity: !activePact || evaluatingId !== null || refreshingId !== null || bulkEvaluating || loading ? 0.6 : 1 }}>{evaluatingId === offer.snapshotId ? "Evaluating…" : !activePact ? "Approve Pact first" : storedEvaluation ? "Re-check against Pact" : "Check against Pact"}</button>
                  <button
                    onClick={() => { setCheckoutOffer(offer); setCheckoutAcknowledged(false); setCheckoutError(null); }}
                    disabled={!activePact || offer.currency.trim().toUpperCase() !== "USD" || loading || bulkEvaluating || evaluatingId !== null || refreshingId !== null || checkoutStarting}
                    title={!activePact ? "Approve a Purchase Pact first." : offer.currency.trim().toUpperCase() !== "USD" ? "The protected Sandbox adapter currently supports USD only." : "Review a clearly labelled Sandbox test quote tied to this exact Channel3 snapshot."}
                    style={{ ...buttonStyle, flex: "1 1 210px", background: "#173b2a", borderColor: "#477a57", opacity: !activePact || offer.currency.trim().toUpperCase() !== "USD" || loading || bulkEvaluating || evaluatingId !== null || refreshingId !== null || checkoutStarting ? 0.55 : 1 }}
                  >Test selected offer in PayPal Sandbox →</button>
                </div>
              </article>;
            })}
          </div>}
          {offers.length > 0 && visibleOffers.length === 0 && <div style={{ ...boxStyle, color: palette.muted, fontSize: 14 }}>No offers match this status filter. Choose “All offers” to see the complete catalog response.</div>}
        </section>

        {evaluation && <section style={{ ...boxStyle, border: `1px solid ${verdictColor(getOfferVerdict(evaluation))}80`, marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}><div><p style={{ color: palette.green, fontSize: 12, letterSpacing: 1.8, fontWeight: 900, margin: "0 0 8px" }}>LIVE OFFER DECISION · NO PAYMENT ACTION</p><h2 style={{ margin: 0, fontSize: 26 }}>{getOfferVerdict(evaluation) === "pass" ? "POLICY PREREQUISITES PASS" : getOfferVerdict(evaluation) === "needs-evidence" ? "NEEDS EVIDENCE — SETTLEMENT BLOCKED" : getOfferVerdict(evaluation) === "safety-hold" ? "SAFETY HOLD — VERIFICATION INCOMPLETE" : "BLOCKED — A HARD RULE FAILED"}</h2></div><span style={{ border: `1px solid ${verdictColor(getOfferVerdict(evaluation))}`, color: verdictColor(getOfferVerdict(evaluation)), padding: "8px 10px", borderRadius: 8, fontWeight: 900, fontSize: 12 }}>{verdictLabel(getOfferVerdict(evaluation))}</span></div>
          <p style={{ color: palette.muted, fontSize: 14, lineHeight: 1.65 }}>{evaluation.note}</p>
          <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", minWidth: 650, fontSize: 13 }}><thead><tr style={{ color: palette.muted, textAlign: "left" }}>{["Constraint", "Status", "Observed value", "Reason"].map((header) => <th key={header} style={{ padding: "10px 8px", borderBottom: `1px solid ${palette.border}` }}>{header}</th>)}</tr></thead><tbody>{evaluation.verification.results.map((result) => <tr key={result.constraintId}><td style={{ padding: "11px 8px", borderBottom: `1px solid ${palette.border}`, fontWeight: 800 }}>{activePact?.constraints.find((constraint) => constraint.id === result.constraintId)?.description ?? result.constraintId}</td><td style={{ padding: "11px 8px", borderBottom: `1px solid ${palette.border}`, color: result.status === "pass" ? palette.green : result.status === "fail" ? "#ffb8b8" : "#ffd891", fontWeight: 900 }}>{result.status.toUpperCase()}</td><td style={{ padding: "11px 8px", borderBottom: `1px solid ${palette.border}` }}>{result.actual === undefined ? "Unknown" : String(result.actual)}</td><td style={{ padding: "11px 8px", borderBottom: `1px solid ${palette.border}`, color: palette.muted }}>{result.reason}</td></tr>)}</tbody></table></div>
          <p style={{ margin: "14px 0 0", fontSize: 12, color: palette.muted }}>Run ID: {evaluation.runId} · Payment action: {evaluation.paymentAction} · Capture performed: {evaluation.capturePerformedByPactPay ? "yes" : "no"}</p>
        </section>}

        {checkoutOffer && activePact && (() => {
          const quote = sandboxTestQuote(checkoutOffer.price);
          return <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !checkoutStarting) setCheckoutOffer(null); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0, 0, 0, 0.72)", display: "grid", placeItems: "center", padding: 18, overflowY: "auto" }}>
            <section role="dialog" aria-modal="true" aria-labelledby="sandbox-quote-title" style={{ ...boxStyle, width: "min(100%, 620px)", maxHeight: "min(92vh, 820px)", overflowY: "auto", borderColor: "#477a57", boxShadow: "0 24px 80px rgba(0,0,0,.45)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
                <div><p style={{ color: palette.green, fontSize: 11, fontWeight: 900, letterSpacing: 1.5, margin: "0 0 8px" }}>PAYPAL SANDBOX · TEST CHECKOUT</p><h2 id="sandbox-quote-title" style={{ margin: 0, fontSize: 25, lineHeight: 1.2 }}>Check this exact offer</h2></div>
                <button type="button" onClick={() => { if (!checkoutStarting) { setCheckoutOffer(null); setCheckoutError(null); } }} disabled={checkoutStarting} aria-label="Close test checkout quote" style={{ ...buttonStyle, padding: "8px 11px" }}>✕</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "88px minmax(0, 1fr)", gap: 14, marginTop: 20, alignItems: "center" }}>
                {checkoutOffer.imageUrl ? <img src={checkoutOffer.imageUrl} alt={checkoutOffer.productTitle} referrerPolicy="no-referrer" style={{ width: 88, height: 88, objectFit: "contain", borderRadius: 10, background: "#07110e" }} /> : <div style={{ width: 88, height: 88, display: "grid", placeItems: "center", background: "#07110e", borderRadius: 10, color: palette.muted }}>No image</div>}
                <div style={{ minWidth: 0 }}><h3 style={{ fontSize: 17, lineHeight: 1.4, margin: "0 0 6px" }}>{checkoutOffer.productTitle}</h3><p style={{ color: palette.muted, fontSize: 12, margin: 0 }}>{checkoutOffer.brand ?? "Brand not supplied"} · {checkoutOffer.offerDomain}</p><p style={{ color: palette.green, fontSize: 12, fontWeight: 800, margin: "5px 0 0" }}>Channel3 snapshot · {dateTime(checkoutOffer.fetchedAt)}</p></div>
              </div>
              <div style={{ border: `1px solid ${palette.border}`, borderRadius: 12, padding: 16, marginTop: 18, background: "#07110e" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0" }}><span style={{ color: palette.muted }}>Live catalog item price</span><strong>{money(quote.item, checkoutOffer.currency)}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0" }}><span style={{ color: palette.muted }}>Test shipping fixture</span><strong>{money(quote.shipping, "USD")}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0" }}><span style={{ color: palette.muted }}>Test tax fixture (8%)</span><strong>{money(quote.tax, "USD")}</strong></div>
                <div style={{ borderTop: `1px solid ${palette.border}`, marginTop: 8, paddingTop: 13, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}><span style={{ fontWeight: 900 }}>Sandbox amount to authorize</span><strong style={{ fontSize: 26 }}>{money(quote.total, "USD")}</strong></div>
              </div>
              <div style={{ border: "1px solid #6c5529", background: "#19160e", borderRadius: 11, padding: 13, marginTop: 14 }}>
                <p style={{ color: "#ffd891", fontWeight: 900, fontSize: 12, margin: "0 0 6px" }}>This is not a merchant checkout</p>
                <p style={{ color: palette.muted, fontSize: 13, lineHeight: 1.65, margin: 0 }}>The item title, merchant and item price come from the selected Channel3 catalog snapshot. Shipping ($4.99) and test tax (8%) are PactPay test-fixture terms. No retailer order is created, and the amount is only a PayPal Sandbox authorization using virtual funds. The server will recompute the quote and validate your approved Pact before creating an order.</p>
              </div>
              {checkoutError && <div role="alert" style={{ marginTop: 14, border: "1px solid #8b4246", background: "#2a1517", color: "#ffb8b8", borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 1.5 }}>{checkoutError}</div>}
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, color: palette.text, fontSize: 13, lineHeight: 1.55 }}><input type="checkbox" checked={checkoutAcknowledged} onChange={(event) => setCheckoutAcknowledged(event.currentTarget.checked)} disabled={checkoutStarting} style={{ marginTop: 3 }} /><span>I understand this is a Sandbox test quote, not an order with {checkoutOffer.offerDomain}. PactPay may capture this virtual Sandbox amount only if the offer-bound Purchase Pact, current Channel3 observations, test quote and server-side gate still pass.</span></label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end", marginTop: 18 }}><button type="button" onClick={() => { setCheckoutOffer(null); setCheckoutError(null); }} disabled={checkoutStarting} style={{ ...buttonStyle, background: "transparent" }}>Cancel</button><button type="button" onClick={() => void startOfferBoundSandboxCheckout()} disabled={!checkoutAcknowledged || checkoutStarting} style={{ ...buttonStyle, background: checkoutAcknowledged ? palette.green : "#263b33", color: checkoutAcknowledged ? "#07130e" : palette.muted, borderColor: palette.green, opacity: !checkoutAcknowledged || checkoutStarting ? 0.6 : 1 }}>{checkoutStarting ? "Creating bound Sandbox order…" : "Continue to PayPal Sandbox →"}</button></div>
            </section>
          </div>;
        })()}

        <aside style={{ ...boxStyle, border: "1px solid #6c5529", background: "#19160e" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 15, color: "#ffd891" }}>Catalog refresh is not settlement verification</h2>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: palette.muted }}>Refresh uses Channel3's official Product Detail endpoint to retrieve the canonical product and current offers. PactPay only accepts a uniquely matched product and merchant offer; an updated observation is stored as a new immutable snapshot rather than rewriting history. The source can refresh item price, availability, condition, and structured catalog attributes when present. It does not establish the final landed total, shipping cost, delivery date, return window, or merchant fulfillment performance. No PayPal order, authorization, capture, or void is created by this page.</p>
        </aside>
      </div>
    </main>
  );
}
