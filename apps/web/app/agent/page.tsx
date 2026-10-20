"use client";

import { useEffect, useMemo, useState } from "react";
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

type ConstraintResult = { constraintId: string; severity?: "hard" | "soft"; status: "pass" | "fail" | "unknown"; actual?: string | number | boolean; reason: string };
type EvalResult = {
  runId: string;
  offer: { id: string; title: string; itemPrice: number; currency: string; domain: string };
  verification: { securityClear: boolean; evidenceFresh: boolean; evidenceAttributable: boolean; results: ConstraintResult[] };
  summary: { decision: "capture" | "block"; reason: string; hardPasses: number; hardFailures: number; softFailures: number };
  missingHardEvidence: Array<{ constraintId: string; reason: string }>;
  paymentAction: "NONE";
  capturePerformedByPactPay: false;
  note: string;
};
type RefreshResult = { status: "MATCHED_WITH_CHANGES" | "MATCHED_UNCHANGED" | "OFFER_NOT_FOUND"; refreshedOffer: LiveOffer | null; changedFields: string[]; note: string; paymentAction: "NONE"; capturePerformedByPactPay: false };
type Verdict = "PASS" | "NEEDS_EVIDENCE" | "BLOCKED" | "SAFETY_HOLD";
type Candidate = { offer: LiveOffer; evaluation: EvalResult; verdict: Verdict; relevance: number; refreshed: boolean; refreshStatus: string; reason: string };
type StepStatus = "waiting" | "working" | "done" | "issue";
type AgentStep = { label: string; status: StepStatus; detail: string };

const STORAGE_KEY = "pactpay.activePact.v1";
const META_KEY = "pactpay.activeIntent.v1";
const ACCESSORY_TERMS = /\b(case|cover|protector|sleeve|skin|holder|charm|strap|replacement|ear\s?tips?|earbud\s?tips?|carry(?:ing)?\s?pouch|mount|clip)\b/i;
const STOP_WORDS = new Set(["find", "me", "a", "an", "the", "with", "under", "over", "less", "than", "at", "most", "least", "price", "catalog", "item", "in", "stock", "only", "brand", "prefer", "usd", "inr", "for", "of", "and", "or", "buy", "get", "want", "please"]);

function verdictFor(result: EvalResult): Verdict {
  if (!result.verification.securityClear) return "SAFETY_HOLD";
  const hard = result.verification.results.filter((item) => (item.severity ?? "hard") === "hard");
  if (hard.some((item) => item.status === "fail")) return "BLOCKED";
  if (hard.some((item) => item.status === "unknown") || !result.verification.evidenceFresh || !result.verification.evidenceAttributable) return "NEEDS_EVIDENCE";
  return result.summary.decision === "capture" ? "PASS" : "BLOCKED";
}

function relevanceScore(offer: LiveOffer, query: string): number {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? [];
  const title = offer.productTitle.toLowerCase();
  const brand = (offer.brand ?? "").toLowerCase();
  const description = (offer.description ?? "").toLowerCase();
  let score = 0;
  for (const token of new Set(tokens)) {
    if (title.includes(token)) score += 5;
    else if (brand.includes(token)) score += 3;
    else if (description.includes(token)) score += 1;
  }
  // This is only a relevance heuristic, not a policy check. The agent still exposes accessory-like results instead of silently deleting them.
  if (ACCESSORY_TERMS.test(offer.productTitle) && !ACCESSORY_TERMS.test(query)) score -= 8;
  return score;
}

function humanReason(candidate: Candidate, pact: PurchasePact): string {
  if (candidate.verdict === "SAFETY_HOLD") return candidate.refreshed ? "The latest check could not clear a required safety, freshness or source-attribution check." : "PactPay could not verify a required safety, freshness or source-attribution prerequisite. This listing is not recommended.";
  const hardFailures = candidate.evaluation.verification.results.filter((item) => (item.severity ?? "hard") === "hard" && item.status === "fail");
  if (hardFailures.length) {
    const first = hardFailures[0];
    const rule = pact.constraints.find((constraint) => constraint.id === first?.constraintId);
    if (rule?.field === "attributes.itemPrice" && rule.comparator === "lte" && typeof rule.expected === "number") return `Item price ${candidate.offer.price.toFixed(2)} ${candidate.offer.currency} exceeds your ${rule.expected.toFixed(2)} ${candidate.offer.currency} limit.`;
    if (rule?.field === "attributes.brand") return `The catalog brand is ${candidate.offer.brand ?? "not supplied"}; your Pact requires ${String(rule.expected)}.`;
    return rule?.description ? `Doesn't meet: ${rule.description}` : "At least one hard requirement failed.";
  }
  const missing = candidate.evaluation.verification.results.find((item) => (item.severity ?? "hard") === "hard" && item.status === "unknown");
  if (missing) {
    const rule = pact.constraints.find((constraint) => constraint.id === missing.constraintId);
    return rule ? `${rule.description} The live catalog doesn't provide enough evidence to verify it.` : "A required fact is missing from the current evidence.";
  }
  if (candidate.verdict === "PASS") {
    if (!candidate.refreshed) return "The initial hard-rule check passed, but this listing has not been re-confirmed. It is not a current recommendation yet.";
    const softFailures = candidate.evaluation.verification.results.filter((item) => item.severity === "soft" && item.status !== "pass").length;
    return softFailures ? `All hard rules passed after refresh; ${softFailures} preference(s) did not match.` : "The refreshed offer passes the approved hard rules. This is not proof of merchant checkout totals.";
  }
  return candidate.refreshed ? "This offer does not currently qualify for recommendation." : "This offer did not qualify during the initial policy check and was not refreshed.";
}

function money(amount: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
}
function localTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
function badgeColor(verdict: Verdict) { return verdict === "PASS" ? "#8ee5b0" : verdict === "BLOCKED" ? "#ffb9b9" : verdict === "SAFETY_HOLD" ? "#d5c8ff" : "#ffd891"; }

const initialSteps: AgentStep[] = [
  { label: "Search live catalog", status: "waiting", detail: "Channel3 will be called with your approved search query." },
  { label: "Evaluate the Purchase Pact", status: "waiting", detail: "Each saved offer snapshot will be checked by the server-side policy engine." },
  { label: "Refresh leading candidates", status: "waiting", detail: "Up to three non-blocked candidates will be re-fetched and re-evaluated." },
];

export default function ShoppingAgentPage() {
  const [pact, setPact] = useState<PurchasePact | null>(null);
  const [intent, setIntent] = useState("");
  const [query, setQuery] = useState("");
  const [compiler, setCompiler] = useState<string | null>(null);
  const [loadingPact, setLoadingPact] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>(initialSteps);
  const [progress, setProgress] = useState({ complete: 0, total: 0 });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      const storedPact = window.sessionStorage.getItem(STORAGE_KEY);
      if (storedPact) {
        const parsed = JSON.parse(storedPact) as PurchasePact;
        if (parsed && typeof parsed.id === "string" && Array.isArray(parsed.constraints)) setPact(parsed);
      }
      const metaRaw = window.sessionStorage.getItem(META_KEY);
      const meta = metaRaw ? JSON.parse(metaRaw) as { originalIntent?: string; searchQuery?: string; compiler?: string } : null;
      const urlQuery = new URLSearchParams(window.location.search).get("query")?.trim();
      setIntent(meta?.originalIntent ?? "");
      setQuery(urlQuery || meta?.searchQuery || "");
      setCompiler(meta?.compiler ?? null);
    } catch {
      setError("We couldn't read your approved Purchase Pact from this browser session. Please return to the Pact Composer and approve it again.");
    } finally {
      setLoadingPact(false);
    }
  }, []);

  const hardRuleCount = useMemo(() => pact?.constraints.filter((rule) => rule.severity === "hard").length ?? 0, [pact]);
  const softRuleCount = useMemo(() => pact?.constraints.filter((rule) => rule.severity === "soft").length ?? 0, [pact]);
  const passing = candidates.filter((candidate) => candidate.verdict === "PASS" && candidate.refreshed);
  const recommended = [...passing].sort((a, b) => b.relevance - a.relevance || a.evaluation.summary.softFailures - b.evaluation.summary.softFailures || a.offer.price - b.offer.price)[0] ?? null;

  function updateStep(index: number, status: StepStatus, detail?: string) {
    setSteps((current) => current.map((step, i) => i === index ? { ...step, status, ...(detail ? { detail } : {}) } : step));
  }

  async function runAgent() {
    if (!pact) { setError("Approve a Purchase Pact before running the shopping agent."); return; }
    if (!query.trim()) { setError("Enter a product search query first."); return; }
    setRunning(true);
    setError(null);
    setNotice(null);
    setFinished(false);
    setCandidates([]);
    setSearchedAt(null);
    setProgress({ complete: 0, total: 0 });
    setSteps(initialSteps.map((step, index) => ({ ...step, status: index === 0 ? "working" : "waiting" })));

    try {
      const searchResponse = await fetch("/api/discovery/search", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: query.trim() }), cache: "no-store",
      });
      const searchPayload = await searchResponse.json();
      if (!searchResponse.ok) throw new Error(searchPayload.error ?? "Channel3 search failed.");
      const offers = (Array.isArray(searchPayload.offers) ? searchPayload.offers : []) as LiveOffer[];
      setSearchedAt(typeof searchPayload.fetchedAt === "string" ? searchPayload.fetchedAt : new Date().toISOString());
      updateStep(0, "done", `Channel3 returned ${offers.length} listing(s); snapshots were saved before evaluation.`);
      if (!offers.length) {
        updateStep(1, "issue", "No offers were returned, so no candidate was evaluated and no payment action occurred.");
        updateStep(2, "waiting", "There are no candidates to refresh.");
        setNotice("No listing was found for this exact query. Try a broader phrase such as “wireless mouse” or “USB-C charger”.");
        setFinished(true);
        return;
      }

      updateStep(1, "working", `Checking 0 of ${offers.length} saved snapshots…`);
      setProgress({ complete: 0, total: offers.length });
      const evaluated: Candidate[] = [];
      for (let index = 0; index < offers.length; index += 1) {
        const offer = offers[index];
        if (!offer) continue;
        try {
          const response = await fetch("/api/discovery/evaluate", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ snapshotId: offer.snapshotId, pact }), cache: "no-store",
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Policy evaluation failed.");
          const evaluation = payload as EvalResult;
          evaluated.push({ offer, evaluation, verdict: verdictFor(evaluation), relevance: relevanceScore(offer, query), refreshed: false, refreshStatus: "Not refreshed", reason: "Evaluation complete; currentness not yet re-confirmed." });
        } catch (caught) {
          evaluated.push({
            offer,
            evaluation: { runId: "", offer: { id: offer.snapshotId, title: offer.productTitle, itemPrice: offer.price, currency: offer.currency, domain: offer.offerDomain }, verification: { securityClear: false, evidenceFresh: false, evidenceAttributable: false, results: [] }, summary: { decision: "block", reason: "evaluation_error", hardPasses: 0, hardFailures: 0, softFailures: 0 }, missingHardEvidence: [], paymentAction: "NONE", capturePerformedByPactPay: false, note: caught instanceof Error ? caught.message : "Evaluation failed." },
            verdict: "SAFETY_HOLD", relevance: relevanceScore(offer, query), refreshed: false, refreshStatus: "Evaluation failed", reason: "The server-side evaluation could not be completed. This candidate is not recommended.",
          });
        }
        setProgress({ complete: index + 1, total: offers.length });
        updateStep(1, "working", `Checked ${index + 1} of ${offers.length} saved snapshots…`);
      }
      updateStep(1, "done", `${evaluated.length} listing(s) evaluated by PactPay's deterministic policy engine. No PayPal order was created.`);

      const refreshTargets = [...evaluated]
        .filter((candidate) => candidate.verdict === "PASS" || candidate.verdict === "NEEDS_EVIDENCE")
        .sort((a, b) => (a.verdict === "PASS" ? 0 : 1) - (b.verdict === "PASS" ? 0 : 1) || b.relevance - a.relevance || a.evaluation.summary.softFailures - b.evaluation.summary.softFailures)
        .slice(0, 3);
      updateStep(2, "working", refreshTargets.length ? `Re-fetching ${refreshTargets.length} leading candidate(s) from Channel3…` : "No candidate survived the first hard-rule pass. Showing blockers rather than inventing a match.");
      const refined = [...evaluated];
      let refreshedCount = 0;
      for (const target of refreshTargets) {
        try {
          const response = await fetch("/api/discovery/refresh", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshotId: target.offer.snapshotId }), cache: "no-store",
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Channel3 revalidation failed.");
          const refresh = payload as RefreshResult;
          const index = refined.findIndex((candidate) => candidate.offer.snapshotId === target.offer.snapshotId);
          if (index < 0) continue;
          if (!refresh.refreshedOffer) {
            refined[index] = { ...target, verdict: "SAFETY_HOLD", refreshed: false, refreshStatus: "Same offer not confirmed", reason: "Channel3 could not uniquely re-confirm this product+merchant offer. It is not recommended." };
            continue;
          }
          const refreshedOffer = refresh.refreshedOffer;
          const evalResponse = await fetch("/api/discovery/evaluate", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshotId: refreshedOffer.snapshotId, pact }), cache: "no-store",
          });
          const evalPayload = await evalResponse.json();
          if (!evalResponse.ok) throw new Error(evalPayload.error ?? "Refreshed snapshot evaluation failed.");
          const freshEvaluation = evalPayload as EvalResult;
          const freshCandidate: Candidate = {
            offer: refreshedOffer,
            evaluation: freshEvaluation,
            verdict: verdictFor(freshEvaluation),
            relevance: relevanceScore(refreshedOffer, query),
            refreshed: true,
            refreshStatus: refresh.status === "MATCHED_WITH_CHANGES" ? `Re-confirmed · changes: ${refresh.changedFields.join(", ") || "catalog facts updated"}` : "Re-confirmed unchanged",
            reason: "",
          };
          freshCandidate.reason = humanReason(freshCandidate, pact);
          refined[index] = freshCandidate;
          refreshedCount += 1;
        } catch (caught) {
          const index = refined.findIndex((candidate) => candidate.offer.snapshotId === target.offer.snapshotId);
          if (index >= 0) refined[index] = { ...target, verdict: "SAFETY_HOLD", refreshed: false, refreshStatus: "Refresh failed", reason: caught instanceof Error ? `Couldn't re-confirm current catalog facts: ${caught.message}` : "Could not re-confirm current catalog facts." };
        }
      }
      const final = refined.map((candidate) => ({ ...candidate, reason: candidate.evaluation.runId ? humanReason(candidate, pact) : candidate.reason }));
      final.sort((a, b) => {
        const group = (item: Candidate) => item.refreshed && item.verdict === "PASS" ? 0 : item.refreshed && item.verdict === "NEEDS_EVIDENCE" ? 1 : item.verdict === "BLOCKED" ? 2 : 3;
        return group(a) - group(b) || b.relevance - a.relevance || a.evaluation.summary.softFailures - b.evaluation.summary.softFailures || a.offer.price - b.offer.price;
      });
      setCandidates(final);
      updateStep(2, refreshedCount ? "done" : refreshTargets.length ? "issue" : "done", refreshedCount ? `${refreshedCount} candidate(s) re-confirmed and evaluated again against a new immutable Channel3 snapshot.` : refreshTargets.length ? "No leading candidate could be fully re-confirmed; those listings are not presented as current recommendations." : "No candidate qualified for revalidation. See the hard-rule blockers below.");
      const passCount = final.filter((candidate) => candidate.refreshed && candidate.verdict === "PASS").length;
      const evidenceCount = final.filter((candidate) => candidate.refreshed && candidate.verdict === "NEEDS_EVIDENCE").length;
      setNotice(passCount ? `Agent run complete. ${passCount} re-confirmed offer(s) pass the current hard-rule evidence checks; review the reasons before choosing one.` : evidenceCount ? `Agent run complete. No fully verified match yet; ${evidenceCount} re-confirmed candidate(s) still need evidence.` : "Agent run complete. No offer passed the full hard-rule and revalidation sequence; PactPay has not created a PayPal order or moved funds.");
      setFinished(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The shopping agent could not finish this run.");
      setSteps((current) => current.map((step) => step.status === "working" ? { ...step, status: "issue", detail: caught instanceof Error ? caught.message : "Step failed." } : step));
    } finally {
      setRunning(false);
    }
  }

  function continueWith(candidate: Candidate) {
    // Discovery receives only the shortlist whose exact merchant offers were refreshed
    // and re-evaluated by the agent—not the full unfiltered Channel3 search result.
    const shortlist = candidates.filter((item) => item.refreshed && Boolean(item.offer.snapshotId));
    const selectedIsCurrent = shortlist.some((item) => item.offer.snapshotId === candidate.offer.snapshotId);
    if (!selectedIsCurrent) {
      setError("This offer is not part of the current re-confirmed shortlist. Run the shopping agent again before continuing.");
      return;
    }
    try {
      sessionStorage.setItem("pactpay.agent.discovery.v1", JSON.stringify({
        query,
        offers: shortlist.map((item) => item.offer),
        offerEvaluations: Object.fromEntries(shortlist.map((item) => [item.offer.snapshotId, item.evaluation])),
        searchedAt,
        selectedSnapshotId: candidate.offer.snapshotId,
        createdAt: new Date().toISOString(),
      }));
    } catch {
      setError("Your browser couldn't preserve this agent shortlist. Please run the agent again and retry.");
      return;
    }
    window.location.href = `/discover?query=${encodeURIComponent(query)}&fromAgent=1&focusSnapshotId=${encodeURIComponent(candidate.offer.snapshotId)}`;
  }

  return (
    <main style={{ minHeight: "100vh", padding: "28px 20px 64px", background: "radial-gradient(ellipse at 15% 0%, #16372d 0%, #091311 48%, #07100e 100%)", color: "#edf7f2", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", paddingBottom: 17, marginBottom: 34, borderBottom: "1px solid #28443a" }}>
          <a href="/" style={{ color: "#edf7f2", textDecoration: "none", fontWeight: 950, letterSpacing: 2 }}>PACTPAY <span style={{ color: "#7fe2ab" }}>///</span></a>
          <nav aria-label="Main navigation" style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14 }}><a href="/discover" style={{ color: "#a5b8b0" }}>Discovery</a><a href="/control-center" style={{ color: "#a5b8b0" }}>Control Center ↗</a><a href="/evidence" style={{ color: "#a5b8b0" }}>Evidence Desk</a><a href="/pact-lab" style={{ color: "#a5b8b0" }}>Policy Lab</a></nav>
          <span style={{ color: "#ffd891", border: "1px solid #705526", borderRadius: 999, padding: "7px 10px", fontSize: 10, fontWeight: 900, letterSpacing: 1 }}>AI ASSISTED · HUMAN APPROVAL</span>
        </header>

        <section style={{ maxWidth: 850, marginBottom: 24 }}>
          <p style={{ color: "#7fe2ab", fontSize: 12, fontWeight: 900, letterSpacing: 2, margin: "0 0 12px" }}>M0.14 · TOOL-USING SHOPPING AGENT</p>
          <h1 style={{ fontSize: "clamp(38px, 6vw, 66px)", letterSpacing: -2.8, lineHeight: 0.98, margin: 0 }}>Don't just find a deal.<br /><span style={{ color: "#7fe2ab" }}>Check it, then explain it.</span></h1>
          <p style={{ maxWidth: 820, color: "#a5b8b0", fontSize: 16, lineHeight: 1.75, marginTop: 19 }}>PactPay's shopping agent chains three real tools: live Channel3 search, deterministic Purchase Pact evaluation, and a fresh product+merchant re-check for leading candidates. It recommends; you choose. It never creates a PayPal order or captures funds during this run.</p>
        </section>

        {loadingPact ? <section style={{ padding: 20, border: "1px solid #28443a", background: "#0e1c19", borderRadius: 15, color: "#a5b8b0" }}>Loading your approved Purchase Pact…</section> : !pact ? <section style={{ padding: 22, border: "1px solid #6c5529", background: "#19160e", borderRadius: 15 }}><h2 style={{ marginTop: 0 }}>Approve a Purchase Pact first</h2><p style={{ color: "#a5b8b0", lineHeight: 1.7 }}>The Shopping Agent must not invent a budget or use unrelated default laptop rules. Create and approve the rules you want enforced, then return here.</p><a href="/" style={{ color: "#7fe2ab", fontWeight: 850 }}>Open Pact Composer →</a></section> : <>
          <section style={{ padding: 18, border: "1px solid #42664c", background: "linear-gradient(110deg,#10241d,#112c20 72%,#1b3322)", borderRadius: 16, marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 400px", minWidth: 0 }}><p style={{ margin: "0 0 8px", color: "#7fe2ab", fontSize: 11, fontWeight: 900, letterSpacing: 1.5 }}>YOUR APPROVED PURCHASE PACT</p><h2 style={{ margin: 0, fontSize: 22 }}>{intent || "Approved purchase request"}</h2><p style={{ margin: "8px 0 0", color: "#a5b8b0", fontSize: 12 }}>Pact ID: {pact.id} · {hardRuleCount} hard rule(s) · {softRuleCount} preference(s) · AI source: {compiler === "GROQ" ? "Groq" : compiler === "RULE_BASED_FALLBACK" ? "labelled local fallback" : "not recorded"}</p></div>
              <a href="/" style={{ color: "#a5b8b0", fontSize: 13 }}>Edit Pact ↗</a>
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 14 }}>{pact.constraints.map((rule) => <span key={rule.id} style={{ border: `1px solid ${rule.severity === "hard" ? "#3a6845" : "#534b70"}`, color: rule.severity === "hard" ? "#c7f1c0" : "#d7c9ff", background: rule.severity === "hard" ? "#163324" : "#282239", borderRadius: 100, padding: "6px 9px", fontSize: 12 }}>{rule.severity === "hard" ? "HARD" : "PREFERENCE"} · {rule.description}</span>)}</div>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(290px,.85fr)", gap: 16, alignItems: "start", marginBottom: 20 }}>
            <div style={{ padding: 20, border: "1px solid #28443a", background: "#0e1c19", borderRadius: 16 }}>
              <label htmlFor="agent-query" style={{ display: "block", color: "#a5b8b0", fontSize: 12, fontWeight: 800, marginBottom: 8 }}>WHAT SHOULD THE AGENT SEARCH FOR?</label>
              <input id="agent-query" value={query} onChange={(event) => setQuery(event.currentTarget.value)} maxLength={180} onKeyDown={(event) => { if (event.key === "Enter" && !running) void runAgent(); }} placeholder="e.g. wireless mouse, USB-C charger" style={{ width: "100%", border: "1px solid #28443a", background: "#07110e", borderRadius: 10, color: "#edf7f2", padding: "13px 14px", fontSize: 16 }} />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 13 }}><button type="button" onClick={() => void runAgent()} disabled={running || !query.trim()} style={{ border: "1px solid #8df0b9", borderRadius: 10, padding: "13px 17px", background: running ? "#315141" : "#7fe2ab", color: "#07130e", fontWeight: 900, fontSize: 14, cursor: running ? "wait" : "pointer", opacity: !query.trim() ? 0.5 : 1 }}>{running ? "Agent working…" : finished ? "Run again →" : "Run shopping agent →"}</button><span style={{ color: "#7c9387", fontSize: 12 }}>No PayPal side effects</span></div>
              {error && <p role="alert" style={{ color: "#ffb8b8", fontSize: 13, lineHeight: 1.6, marginBottom: 0 }}>{error}</p>}
            </div>
            <div style={{ padding: 19, border: "1px solid #28443a", background: "#0e1c19", borderRadius: 16 }}>
              <h2 style={{ margin: "0 0 13px", fontSize: 17 }}>What the agent actually does</h2>
              <div style={{ display: "grid", gap: 12 }}>
                {["Calls Channel3 and saves actual merchant offer snapshots", "Asks PactPay's deterministic policy engine to check every returned snapshot", "Refreshes up to three leading candidates from the same product+merchant offer and checks the new snapshot again"].map((line, index) => <div key={line} style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: 9, alignItems: "start" }}><span style={{ display: "grid", placeItems: "center", width: 25, height: 25, borderRadius: 8, background: "#173b2b", color: "#7fe2ab", fontSize: 12, fontWeight: 900 }}>{index + 1}</span><span style={{ color: "#a5b8b0", fontSize: 12, lineHeight: 1.6 }}>{line}</span></div>)}
              </div>
            </div>
          </section>

          <section style={{ padding: 20, border: "1px solid #28443a", background: "#0e1c19", borderRadius: 16, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 15 }}><h2 style={{ margin: 0, fontSize: 19 }}>Agent activity</h2>{running && progress.total > 0 && <span style={{ color: "#7fe2ab", fontSize: 12, fontWeight: 850 }}>Evaluated {progress.complete} / {progress.total}</span>}</div>
            <div style={{ display: "grid", gap: 10 }}>{steps.map((step, index) => {
              const color = step.status === "done" ? "#7fe2ab" : step.status === "issue" ? "#ffd891" : step.status === "working" ? "#c7f1c0" : "#7c9387";
              return <div key={step.label} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr)", gap: 11, padding: 12, borderRadius: 10, border: `1px solid ${step.status === "working" ? "#42664c" : "#20372f"}`, background: step.status === "working" ? "#10251d" : "#091512" }}><span style={{ display: "grid", placeItems: "center", width: 27, height: 27, borderRadius: 8, background: `${color}1e`, color, fontWeight: 950 }}>{step.status === "done" ? "✓" : step.status === "working" ? "…" : step.status === "issue" ? "!" : index + 1}</span><div><div style={{ fontWeight: 850, fontSize: 14, color }}>{step.label}</div><p style={{ margin: "4px 0 0", color: "#a5b8b0", fontSize: 12, lineHeight: 1.55 }}>{step.detail}</p></div></div>;
            })}</div>
          </section>

          {notice && <section role="status" style={{ padding: 17, borderRadius: 13, border: `1px solid ${recommended ? "#42664c" : "#705526"}`, background: recommended ? "#10251d" : "#19160e", marginBottom: 18 }}><h2 style={{ margin: "0 0 7px", fontSize: 18, color: recommended ? "#7fe2ab" : "#ffd891" }}>{recommended ? "A current candidate meets the known rules" : "No fully verified match yet"}</h2><p style={{ margin: 0, color: "#c2d2c8", fontSize: 14, lineHeight: 1.65 }}>{notice}</p></section>}

          {finished && <section style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 13 }}><h2 style={{ margin: 0, fontSize: 22 }}>What the agent found</h2><span style={{ color: "#7c9387", fontSize: 12 }}>{candidates.length} listing(s) · {searchedAt ? `searched ${localTime(searchedAt)}` : "latest run"}</span></div>
            {recommended && <article style={{ display: "grid", gridTemplateColumns: "112px minmax(0,1fr)", gap: 17, padding: 19, borderRadius: 16, border: "1px solid #54835a", background: "linear-gradient(110deg,#10251d,#122b20 72%,#1d3725)", marginBottom: 14 }}>
              {recommended.offer.imageUrl ? <img src={recommended.offer.imageUrl} alt={recommended.offer.productTitle} loading="lazy" referrerPolicy="no-referrer" style={{ width: 112, height: 112, objectFit: "contain", background: "#07110e", borderRadius: 10 }} /> : <div style={{ display: "grid", placeItems: "center", width: 112, height: 112, background: "#07110e", color: "#7c9387", borderRadius: 10 }}>No image</div>}
              <div style={{ minWidth: 0 }}><p style={{ margin: "0 0 6px", color: "#7fe2ab", fontSize: 11, fontWeight: 950, letterSpacing: 1.2 }}>BEST CURRENT CANDIDATE · RE-CHECKED</p><h3 style={{ margin: 0, fontSize: 21, lineHeight: 1.35 }}>{recommended.offer.productTitle}</h3><p style={{ color: "#a5b8b0", fontSize: 13, margin: "6px 0 8px" }}>{recommended.offer.brand ?? "Brand not supplied"} · {recommended.offer.offerDomain} · {localTime(recommended.offer.fetchedAt)}</p><p style={{ margin: "0 0 9px", fontWeight: 900, fontSize: 25 }}>{money(recommended.offer.price, recommended.offer.currency)} <span style={{ color: "#a5b8b0", fontSize: 12, fontWeight: 500 }}>catalog item price</span></p><p style={{ margin: "0 0 13px", color: "#c2d2c8", fontSize: 13, lineHeight: 1.6 }}>{recommended.reason}</p><div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}><button type="button" onClick={() => continueWith(recommended)} style={{ border: "1px solid #8df0b9", borderRadius: 9, padding: "10px 13px", background: "#7fe2ab", color: "#07130e", fontWeight: 900, cursor: "pointer" }}>Continue with this offer →</button><a href={recommended.offer.offerUrl} target="_blank" rel="noreferrer noopener" style={{ display: "inline-flex", alignItems: "center", color: "#7fe2ab", padding: "9px 2px", fontSize: 13, fontWeight: 800 }}>Open merchant listing ↗</a></div></div>
            </article>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
              {candidates.filter((candidate) => candidate.offer.snapshotId !== recommended?.offer.snapshotId).slice(0, 8).map((candidate) => <article key={candidate.offer.snapshotId} style={{ display: "grid", gridTemplateColumns: "72px minmax(0,1fr)", gap: 12, padding: 14, borderRadius: 13, border: "1px solid #28443a", background: "#0e1c19" }}>
                {candidate.offer.imageUrl ? <img src={candidate.offer.imageUrl} alt={candidate.offer.productTitle} loading="lazy" referrerPolicy="no-referrer" style={{ width: 72, height: 72, objectFit: "contain", background: "#07110e", borderRadius: 8 }} /> : <div style={{ width: 72, height: 72, background: "#07110e", borderRadius: 8 }} />}
                <div style={{ minWidth: 0 }}><div style={{ color: badgeColor(candidate.verdict), fontSize: 10, fontWeight: 950, letterSpacing: 0.7 }}>{candidate.refreshed ? candidate.verdict.replace(/_/g, " ") : "NOT RE-CONFIRMED"}</div><h3 style={{ margin: "5px 0", fontSize: 15, lineHeight: 1.35 }}>{candidate.offer.productTitle}</h3><p style={{ margin: 0, color: "#a5b8b0", fontSize: 12 }}>{money(candidate.offer.price, candidate.offer.currency)} · {candidate.offer.offerDomain}</p><p style={{ margin: "6px 0 0", color: "#9fb2a7", fontSize: 12, lineHeight: 1.5 }}>{candidate.reason}</p>{candidate.refreshed && <button type="button" onClick={() => continueWith(candidate)} style={{ marginTop: 9, border: "1px solid #42664c", borderRadius: 8, background: "transparent", color: "#7fe2ab", padding: "8px 10px", fontWeight: 800, cursor: "pointer" }}>Inspect offer →</button>}</div>
              </article>)}
            </div>
            <p style={{ margin: "15px 0 0", color: "#7c9387", fontSize: 12, lineHeight: 1.6 }}>A rules pass is not a merchant checkout confirmation. Shipping, tax, delivery and returns remain unknown unless supported by separate current evidence. This agent run created no PayPal order, authorization, capture or void.</p>
          </section>}
        </>}
      </div>
    </main>
  );
}
