"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PurchasePact } from "@pactpay/pact-core";
import { previewChannel3TestQuote } from "@pactpay/pact-core/settlement-demo";
import { applyCheckoutQuote } from "@pactpay/pact-core/checkout-quote";
import { describeAutonomy, shouldAutoHold, type Autonomy } from "@pactpay/pact-core/autonomy";
import { logEvent, readAutonomy, readExcluded } from "../components/agentLog";
import { offerKey } from "@pactpay/pact-core/seller-world";
import AppShell from "../components/AppShell";
import StepTracker from "../components/StepTracker";

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
const APPROVAL_KEY = "pactpay.activeApproval.v1";
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
          const evaluation = applyCheckoutQuote(payload as EvalResult, { price: offer.price, currency: offer.currency }, pact?.constraints ?? []);
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
          const freshEvaluation = applyCheckoutQuote(evalPayload as EvalResult, { price: refreshedOffer.price, currency: refreshedOffer.currency }, pact?.constraints ?? []);
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


  const [selected, setSelected] = useState<Candidate | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [holding, setHolding] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const autoStarted = useRef(false);
  const [autonomy, setAutonomy] = useState<Autonomy>({ mode: "ASK_ALWAYS", limitUsd: null });
  const [testAcknowledged, setTestAcknowledged] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [autopilotStopped, setAutopilotStopped] = useState(false);
  const [world, setWorld] = useState<Array<{ offerKey: string; scenarioId: string; reason: string | null }>>([]);

  async function loadWorld() {
    try {
      const response = await fetch("/api/seller-world", { cache: "no-store" });
      const payload = await response.json() as { effects?: Array<{ offerKey: string; scenarioId: string; reason: string | null }> };
      setWorld(Array.isArray(payload.effects) ? payload.effects : []);
    } catch { /* the simulation layer is optional */ }
  }
  useEffect(() => { void loadWorld(); }, []);

  async function resetSimulation() {
    try { await fetch("/api/seller-world", { method: "DELETE" }); } catch { /* ignore */ }
    try { window.sessionStorage.setItem("pactpay.excluded.v1", "[]"); } catch { /* ignore */ }
    setExcluded([]);
    setWorld([]);
    logEvent("you", "Reset the seller simulation so every offer shows its real catalog state again.");
    autoStarted.current = true;
    setAutopilotStopped(false);
    void runAgent();
  }

  useEffect(() => {
    const stored = readAutonomy();
    setAutonomy(stored.autonomy);
    setTestAcknowledged(stored.acknowledgedTest);
    setExcluded(readExcluded());
  }, []);

  useEffect(() => {
    if (loadingPact || !pact || !query.trim() || autoStarted.current) return;
    autoStarted.current = true;
    void runAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingPact, pact, query]);

  async function holdPayment(candidate: Candidate, automatic = false) {
    if (holding) return;
    if (!automatic && !acknowledged) return;
    if (automatic && !testAcknowledged) return;
    setHolding(true);
    if (!automatic) logEvent("you", `Chose “${candidate.offer.productTitle}” from ${candidate.offer.offerDomain} and confirmed test mode.`, `chose:${candidate.offer.snapshotId}`);
    setHoldError(null);
    try {
      let approvalId: string | null = null;
      try {
        const raw = window.sessionStorage.getItem(APPROVAL_KEY);
        const parsed = raw ? JSON.parse(raw) as { approvalId?: unknown; pactId?: unknown } : null;
        if (parsed && typeof parsed.approvalId === "string" && parsed.pactId === pact?.id) approvalId = parsed.approvalId;
      } catch { /* handled below */ }
      if (!approvalId) throw new Error("We can't find your saved approval. Go back and approve your rules again.");
      const response = await fetch("/api/paypal/offer-demo/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId: candidate.offer.snapshotId, approvalId, approved: true, sandboxQuoteAcknowledged: true }),
        cache: "no-store",
      });
      const payload = await response.json() as { approvalUrl?: string; transactionId?: string; error?: string };
      if (!response.ok || !payload.approvalUrl || !payload.transactionId) throw new Error(payload.error ?? "We couldn't place the payment hold.");
      logEvent("agent", `Placed a PayPal hold of ${money(previewChannel3TestQuote(candidate.offer.price).total, "USD")} (nothing charged) and sent you to PayPal to approve it.`, `hold:${payload.transactionId}`);
      window.location.assign(payload.approvalUrl);
    } catch (caught) {
      setHoldError(caught instanceof Error ? caught.message : "We couldn't place the payment hold.");
      setHolding(false);
      if (automatic) { setAutopilotStopped(true); setCountdown(null); }
    }
  }

  const keyOf = (offer: LiveOffer) => offerKey(offer.productId, offer.offerDomain);
  const worldReasonFor = (item: Candidate): string | null => world.find((effect) => effect.offerKey === keyOf(item.offer))?.reason ?? null;
  const isBlocked = (item: Candidate) => excluded.includes(keyOf(item.offer)) || worldReasonFor(item) !== null;
  const blockedText = (item: Candidate) => worldReasonFor(item) ?? "Skipped: this exact offer already failed its check earlier in this run, so the agent won't pick it again.";
  const ready = candidates.filter((item) => item.refreshed && item.verdict === "PASS" && !isBlocked(item)).sort((a, b) => b.relevance - a.relevance || a.evaluation.summary.softFailures - b.evaluation.summary.softFailures || a.offer.price - b.offer.price);
  const best = ready[0] ?? null;
  const others = candidates.filter((item) => item.offer.snapshotId !== best?.offer.snapshotId);
  const intentTitle = intent || query;
  const hardRules = pact?.constraints.filter((rule) => rule.severity === "hard" && rule.field !== "currency") ?? [];
  const totalRule = pact?.constraints.find((rule) => rule.field === "total" && rule.comparator === "lte" && typeof rule.expected === "number");
  const usdTotals = candidates.filter((item) => item.offer.currency === "USD" && !isBlocked(item)).map((item) => ({ item, total: previewChannel3TestQuote(item.offer.price).total }));
  const cheapestTotal = usdTotals.length ? usdTotals.reduce((low, row) => (row.total < low.total ? row : low)) : null;
  const totalLimit = typeof totalRule?.expected === "number" ? totalRule.expected : null;
  const totalIsTheBlocker = Boolean(!best && totalLimit !== null && cheapestTotal && cheapestTotal.total > totalLimit);
  const bestQuote = best ? previewChannel3TestQuote(best.offer.price) : null;
  const autoEligible = Boolean(best && bestQuote && best.offer.currency === "USD" && testAcknowledged && shouldAutoHold(autonomy, bestQuote.total));
  const waitingForYou = Boolean(best && bestQuote && autonomy.mode !== "ASK_ALWAYS" && !autoEligible);
  const bestId = best?.offer.snapshotId ?? null;
  const skippedCount = candidates.filter((item) => isBlocked(item)).length;

  useEffect(() => {
    if (!finished) return;
    if (bestId && best) logEvent("agent", `Searched live stores and checked every offer against your rules. ${ready.length} cleared them. Best match: “${best.offer.productTitle}” from ${best.offer.offerDomain} at ${money(best.offer.price, best.offer.currency)}${skippedCount ? ` (skipped ${skippedCount} that already failed)` : ""}.`, `found:${bestId}`);
    else logEvent("agent", "Searched live stores. No offer cleared every rule with fresh proof, so I stopped instead of guessing.", `none:${candidates.length}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, bestId]);

  useEffect(() => {
    if (!finished || !autoEligible || autopilotStopped) { setCountdown(null); return; }
    setCountdown(6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, autoEligible, autopilotStopped, bestId]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { if (best) void holdPayment(best, true); return; }
    const timer = window.setTimeout(() => setCountdown((value) => (value === null ? null : value - 1)), 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  function verdictBadge(item: Candidate) {
    if (item.refreshed && item.verdict === "PASS") return <span className="pp-badge pp-badge-good">Matches your rules</span>;
    if (item.verdict === "BLOCKED") return <span className="pp-badge pp-badge-bad">Breaks a rule</span>;
    if (item.verdict === "NEEDS_EVIDENCE") return <span className="pp-badge pp-badge-warn">Can&apos;t confirm yet</span>;
    return <span className="pp-badge pp-badge-neutral">Not verified</span>;
  }

  function OfferImage({ offer }: { offer: LiveOffer }) {
    // eslint-disable-next-line @next/next/no-img-element
    return offer.imageUrl ? <img className="pp-offer-img" src={offer.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="pp-offer-img pp-offer-img-empty">No photo</div>;
  }

  const stepsDone = steps.filter((step) => step.status === "done").length;
  const searching = running || (!finished && !error && Boolean(pact) && Boolean(query));

  return (
    <AppShell>
      <StepTracker current={2} />
      <div className="pp-stack" style={{ gap: 24 }}>
        <div>
          <p className="pp-eyebrow">Step 3 of 5</p>
          <h1 className="pp-h2" style={{ marginTop: 8 }}>{searching ? "Your agent is shopping…" : best ? "Here's the best match" : "Here's what the agent found"}</h1>
          {intentTitle && <p className="pp-muted" style={{ marginTop: 8, maxWidth: "44em" }}>You asked: “{intentTitle}”</p>}
        </div>

        {loadingPact && <div className="pp-card"><span className="pp-spinner pp-spinner-dark" aria-hidden="true" /> Loading your rules…</div>}

        {!loadingPact && !pact && (
          <div className="pp-card">
            <h2 className="pp-h3">We don&apos;t have your approved rules</h2>
            <p className="pp-muted" style={{ marginTop: 8 }}>{error ?? "Start by describing what you want and approving your rules."}</p>
            <a className="pp-btn pp-btn-primary" style={{ marginTop: 16 }} href="/">Start over</a>
          </div>
        )}

        {pact && (
          <div className="pp-card-flat">
            <div className="pp-row pp-between">
              <p className="pp-small" style={{ fontWeight: 700 }}>Your approved rules</p>
              <span className="pp-badge pp-badge-info">{hardRuleCount} must · {softRuleCount} nice-to-have</span>
            </div>
            <ul style={{ margin: "10px 0 0", paddingLeft: 18 }} className="pp-small">
              {hardRules.map((rule) => <li key={rule.id}>{rule.description}</li>)}
            </ul>
            {compiler === "RULE_BASED_FALLBACK" && <p className="pp-tiny pp-muted" style={{ marginTop: 8 }}>These rules were written by the basic parser because AI was unavailable.</p>}
          </div>
        )}

        {pact && <AgentAccess />}

        {pact && (searching || (steps.some((step) => step.status !== "waiting") && !finished)) && (
          <div className="pp-card" aria-live="polite">
            <div className="pp-progress">
              {steps.map((step, index) => (
                <div className="pp-progress-item" data-state={step.status === "done" ? "done" : step.status === "issue" ? "issue" : "todo"} key={step.label}>
                  <span className="pp-progress-icon">{step.status === "done" ? "✓" : step.status === "issue" ? "!" : step.status === "working" ? <span className="pp-spinner pp-spinner-dark" aria-hidden="true" /> : index + 1}</span>
                  <div>
                    <p style={{ fontWeight: 700 }}>{["Searching real stores", "Checking each offer against your rules", "Re-confirming the best ones"][index]}</p>
                    <p className="pp-small pp-muted">{step.status === "waiting" ? "Waiting" : step.detail}</p>
                    {index === 1 && step.status === "working" && progress.total > 0 && <p className="pp-tiny pp-muted pp-num">{progress.complete} of {progress.total} checked</p>}
                  </div>
                </div>
              ))}
            </div>
            <p className="pp-tiny pp-muted" style={{ marginTop: 14 }}>{stepsDone} of 3 steps done. No payment is made during shopping.</p>
          </div>
        )}

        {error && pact && <div className="pp-callout pp-callout-bad" role="alert">{error} <button type="button" className="pp-link-btn" onClick={() => { autoStarted.current = true; void runAgent(); }}>Try again</button></div>}

        {(world.length > 0 || excluded.length > 0) && finished && (
          <div className="pp-callout pp-callout-warn" role="status">
            <p style={{ fontWeight: 700 }}>The seller simulation is still in effect</p>
            <p className="pp-small" style={{ marginTop: 4 }}>{skippedCount} offer{skippedCount === 1 ? " is" : "s are"} being held in a changed state or already failed a check in this run. The agent will not pick {skippedCount === 1 ? "it" : "them"} again; it must choose a genuinely different offer, or stop.</p>
            <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" style={{ marginTop: 10 }} onClick={resetSimulation}>Reset the simulation and search again</button>
          </div>
        )}

        {finished && !best && (
          <div className="pp-callout pp-callout-warn" role="status">
            <p style={{ fontWeight: 700 }}>None of these offers can be chosen yet.</p>
            <p className="pp-small" style={{ marginTop: 4 }}>{notice ?? "Nothing matched every must-have rule with fresh proof."} Each offer below says exactly which rule it fails or can&apos;t prove.</p>
            {totalIsTheBlocker && cheapestTotal && totalLimit !== null && (
              <p className="pp-small" style={{ marginTop: 8 }}><strong>Your total limit is the blocker.</strong> The cheapest usable offer is {money(cheapestTotal.item.offer.price, "USD")} for the item, which comes to about <strong>{money(cheapestTotal.total, "USD")}</strong> with test shipping and tax. That is above your {money(totalLimit, "USD")} total limit. Raise the limit to at least {money(Math.ceil(cheapestTotal.total), "USD")}, or remove it and keep only the item-price limit.</p>
            )}
            {pact && pact.currency !== "USD" && (
              <p className="pp-small" style={{ marginTop: 8 }}><strong>Currency:</strong> test checkout supports US dollars only, but your rules are in {pact.currency}. Change your rules to USD.</p>
            )}
            <div className="pp-row" style={{ marginTop: 10 }}>
              <a className="pp-btn pp-btn-secondary pp-btn-sm" href="/">Change my rules</a>
              <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" onClick={() => { autoStarted.current = true; void runAgent(); }}>Search again</button>
            </div>
          </div>
        )}

        {finished && best && autonomy.mode !== "ASK_ALWAYS" && (
          <section className="pp-agent-card pp-enter" aria-live="polite" aria-label="Autopilot">
            <div className="pp-row pp-between">
              <strong>Autopilot · {describeAutonomy(autonomy).title}</strong>
              <a href="/" className="pp-link-btn" style={{ color: "#7fe2ab" }}>Change</a>
            </div>
            {countdown !== null && !holding && (
              <>
                <p style={{ marginTop: 8 }}>I picked this offer. I&apos;m placing the PayPal hold in <strong className="pp-num">{countdown}s</strong>. You won&apos;t be charged: PayPal only holds the money until the safety check passes.</p>
                <div className="pp-agent-bar" aria-hidden="true"><i style={{ width: `${((6 - countdown) / 6) * 100}%` }} /></div>
                <div className="pp-row" style={{ marginTop: 14 }}>
                  <button type="button" className="pp-btn pp-btn-primary pp-btn-sm" onClick={() => best && holdPayment(best, true)}>Hold now</button>
                  <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" onClick={() => { setAutopilotStopped(true); setCountdown(null); }}>Cancel autopilot</button>
                </div>
              </>
            )}
            {holding && <p style={{ marginTop: 8 }}><span className="pp-spinner" aria-hidden="true" /> Placing the hold and opening PayPal…</p>}
            {!holding && countdown === null && waitingForYou && bestQuote && (
              <p style={{ marginTop: 8 }}>The estimated total is {money(bestQuote.total, "USD")}, above the {money(autonomy.limitUsd ?? 0, "USD")} you let me handle alone. I&apos;m waiting for your OK below.</p>
            )}
            {!holding && countdown === null && autopilotStopped && <p style={{ marginTop: 8 }}>Autopilot is paused. Choose the offer yourself below.</p>}
            {!holding && countdown === null && !waitingForYou && !autopilotStopped && !testAcknowledged && <p style={{ marginTop: 8 }}>I need your test-mode confirmation first. Approve your rules again from the home page.</p>}
          </section>
        )}

        {best && (
          <section className="pp-card pp-offer-best pp-enter" aria-labelledby="best-title">
            <div className="pp-row pp-between" style={{ marginBottom: 14 }}>
              <span className="pp-badge pp-badge-good">Best match · re-confirmed just now</span>
              {verdictBadge(best)}
            </div>
            <div className="pp-offer">
              <OfferImage offer={best.offer} />
              <div>
                <h2 className="pp-h3" id="best-title">{best.offer.productTitle}</h2>
                <p className="pp-small pp-muted">{best.offer.brand ? `${best.offer.brand} · ` : ""}sold by {best.offer.offerDomain}</p>
                <p className="pp-price" style={{ marginTop: 8 }}>{money(best.offer.price, best.offer.currency)}</p>
                <p className="pp-small pp-muted">Catalog price · {best.offer.availability ? best.offer.availability.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() : "availability not listed"}</p>
                <EstimatedTotal offer={best.offer} />
              </div>
            </div>
            <p className="pp-small" style={{ marginTop: 14 }}>{best.reason}</p>
            <SellerClaims offer={best.offer} />

            {selected?.offer.snapshotId !== best.offer.snapshotId ? (
              <button type="button" className="pp-btn pp-btn-primary pp-btn-block" style={{ marginTop: 18 }} onClick={() => { setSelected(best); setAcknowledged(false); setHoldError(null); }}>Choose this one</button>
            ) : (
              <HoldPanel candidate={best} acknowledged={acknowledged} setAcknowledged={setAcknowledged} holding={holding} onHold={() => holdPayment(best)} onCancel={() => setSelected(null)} error={holdError} />
            )}
          </section>
        )}

        {finished && others.length > 0 && (
          <section aria-labelledby="others-title">
            <div className="pp-row pp-between">
              <h2 className="pp-h3" id="others-title">{best ? "Other offers the agent looked at" : "Offers the agent looked at"}</h2>
              <button type="button" className="pp-link-btn" onClick={() => setShowOthers((value) => !value)}>{showOthers || !best ? "Hide" : `Show ${others.length}`}</button>
            </div>
            {(showOthers || !best) && (
              <div className="pp-stack" style={{ marginTop: 14 }}>
                {others.map((item) => {
                  const canChoose = item.refreshed && item.verdict === "PASS" && !isBlocked(item);
                  return (
                    <article className="pp-card-flat pp-offer" key={item.offer.snapshotId}>
                      <OfferImage offer={item.offer} />
                      <div>
                        <div className="pp-row pp-between">
                          <h3 style={{ fontSize: 16, fontWeight: 700 }}>{item.offer.productTitle}</h3>
                          {verdictBadge(item)}
                        </div>
                        <p className="pp-small pp-muted">{item.offer.offerDomain} · <span className="pp-num">{money(item.offer.price, item.offer.currency)}</span> item{item.offer.currency === "USD" && <> · <span className="pp-num">≈ {money(previewChannel3TestQuote(item.offer.price).total, "USD")}</span> total</>}</p>
                        <p className="pp-small" style={{ marginTop: 6 }}>{isBlocked(item) ? blockedText(item) : item.reason}</p>
                        {canChoose && selected?.offer.snapshotId !== item.offer.snapshotId && <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" style={{ marginTop: 10 }} onClick={() => { setSelected(item); setAcknowledged(false); setHoldError(null); }}>Choose this one</button>}
                        {canChoose && selected?.offer.snapshotId === item.offer.snapshotId && <HoldPanel candidate={item} acknowledged={acknowledged} setAcknowledged={setAcknowledged} holding={holding} onHold={() => holdPayment(item)} onCancel={() => setSelected(null)} error={holdError} />}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {finished && (
          <p className="pp-small pp-muted">
            Want to look at every listing and the evidence behind each decision? <button type="button" className="pp-link-btn" onClick={() => { const target = best ?? candidates[0]; if (target) continueWith(target); }}>Open the full offer workspace</button>
          </p>
        )}
      </div>
    </AppShell>
  );
}

function HoldPanel(props: { candidate: Candidate; acknowledged: boolean; setAcknowledged: (value: boolean) => void; holding: boolean; onHold: () => void; onCancel: () => void; error: string | null }) {
  const { candidate } = props;
  const quote = previewChannel3TestQuote(candidate.offer.price);
  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--pp-line)", paddingTop: 18 }} className="pp-enter">
      <h3 className="pp-h3">Place a payment hold (test mode)</h3>
      <p className="pp-small pp-muted" style={{ margin: "6px 0 12px" }}>PayPal will hold this amount. It&apos;s only released if the offer still matches your rules.</p>
      <table className="pp-quote">
        <tbody>
          <tr><td>Item</td><td>{money(quote.itemPrice, "USD")}</td></tr>
          <tr><td>Shipping (test value)</td><td>{money(quote.shippingFee, "USD")}</td></tr>
          <tr><td>Tax (test value, 8%)</td><td>{money(quote.taxAmount, "USD")}</td></tr>
          <tr className="pp-quote-total"><td>Held on PayPal</td><td>{money(quote.total, "USD")}</td></tr>
        </tbody>
      </table>
      <label className="pp-check" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={props.acknowledged} onChange={(event) => props.setAcknowledged(event.target.checked)} />
        <span>I understand this uses PayPal Sandbox test money and fixed test shipping and tax. No store order is placed.</span>
      </label>
      {props.error && <p className="pp-callout pp-callout-bad" role="alert" style={{ marginTop: 12 }}>{props.error}</p>}
      <div className="pp-row" style={{ marginTop: 14 }}>
        <button type="button" className="pp-btn pp-btn-primary" onClick={props.onHold} disabled={!props.acknowledged || props.holding}>
          {props.holding ? <><span className="pp-spinner" aria-hidden="true" /> Opening PayPal…</> : "Hold payment with PayPal"}
        </button>
        <button type="button" className="pp-btn pp-btn-secondary" onClick={props.onCancel} disabled={props.holding}>Not this one</button>
      </div>
    </div>
  );
}


type ClaimsResponse = {
  available: boolean; reason?: string; error?: string; model?: string;
  claims: Array<{ field: string; label?: string; value: string | number; unit?: string; quote: string }>;
  rejected: number; findings: Array<{ rule: string; excerpt: string }>; securityTest: boolean; injectedSentence: string | null;
};
const FIELD_LABEL: Record<string, string> = { itemPrice: "Price", shippingFee: "Shipping", returnWindowDays: "Return window", deliveryDays: "Delivery", warrantyMonths: "Warranty", condition: "Condition", brand: "Brand", availability: "Availability" };
const FINDING_LABEL: Record<string, string> = {
  "override-instructions": "tries to override your rules", "ignore-the-user": "tells the agent to ignore you", "force-purchase": "tries to force the purchase",
  "move-money": "asks to move money", "addresses-agent": "speaks to AI agents directly", "role-marker": "fakes a system message", secrecy: "asks to hide things from you", "new-instructions": "claims to be new instructions",
};
function claimText(claim: ClaimsResponse["claims"][number]): string {
  const unit = claim.field === "returnWindowDays" || claim.field === "deliveryDays" ? " days" : claim.field === "warrantyMonths" ? " months" : claim.unit ? ` ${claim.unit}` : "";
  return claim.field === "itemPrice" || claim.field === "shippingFee" ? `$${Number(claim.value).toFixed(2)}` : `${claim.value}${unit}`;
}
function claimKey(claim: ClaimsResponse["claims"][number]) { return `${claim.field}|${claim.label ?? ""}|${String(claim.value).toLowerCase()}`; }

/** Reads the seller's own listing text with AI. Shows facts with their quotes, labelled seller-stated, plus a live injection test. */
function SellerClaims({ offer }: { offer: LiveOffer }) {
  const text = offer.description ?? "";
  const readable = text.trim().length >= 40;
  const [base, setBase] = useState<ClaimsResponse | null>(null);
  const [test, setTest] = useState<ClaimsResponse | null>(null);
  const [busy, setBusy] = useState<null | "base" | "test">(null);

  async function run(securityTest: boolean) {
    setBusy(securityTest ? "test" : "base");
    try {
      const response = await fetch("/api/evidence/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, securityTest }) });
      const payload = await response.json() as ClaimsResponse;
      if (securityTest) setTest(payload); else setBase(payload);
    } catch {
      const failed: ClaimsResponse = { available: false, reason: "We couldn't reach the AI reader.", claims: [], rejected: 0, findings: [], securityTest, injectedSentence: null };
      if (securityTest) setTest(failed); else setBase(failed);
    } finally { setBusy(null); }
  }

  useEffect(() => {
    setBase(null); setTest(null);
    if (readable) void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.snapshotId]);

  if (!readable) return <p className="pp-tiny pp-muted" style={{ marginTop: 12 }}>This listing has no description text for the AI to read.</p>;
  const baseKeys = new Set((base?.claims ?? []).map(claimKey));
  const testKeys = new Set((test?.claims ?? []).map(claimKey));
  const same = base !== null && test !== null && baseKeys.size === testKeys.size && [...baseKeys].every((key) => testKeys.has(key));

  return (
    <div className="pp-claims" style={{ marginTop: 16 }}>
      <div className="pp-row pp-between">
        <p style={{ fontWeight: 700 }}>What the seller&apos;s own listing says</p>
        <span className="pp-badge pp-badge-neutral">Seller-stated · not verified</span>
      </div>
      {busy === "base" && <p className="pp-small pp-muted" style={{ marginTop: 8 }}><span className="pp-spinner pp-spinner-dark" aria-hidden="true" /> AI is reading the listing…</p>}
      {base && !base.available && <p className="pp-small pp-muted" style={{ marginTop: 8 }}>{base.reason ?? "No facts were extracted."}</p>}
      {base?.available && base.claims.length === 0 && <p className="pp-small pp-muted" style={{ marginTop: 8 }}>The listing doesn&apos;t state any extra facts clearly enough to quote.</p>}
      {base?.available && base.claims.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {base.claims.map((claim) => (
            <div className="pp-claim" key={claimKey(claim)}>
              <strong>{claim.field === "spec" ? claim.label : FIELD_LABEL[claim.field] ?? claim.field}</strong>
              <span>{claimText(claim)}<br /><q>{claim.quote}</q></span>
            </div>
          ))}
        </div>
      )}
      <p className="pp-tiny pp-muted" style={{ marginTop: 8 }}>Every fact must be quoted word for word from the listing or it is thrown away. These facts are shown for your information. They never replace verified catalog data or change a payment decision.</p>

      {base?.available && (
        <div style={{ marginTop: 12 }}>
          <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" onClick={() => run(true)} disabled={busy !== null}>
            {busy === "test" ? "Running the security test…" : "Run a live security test"}
          </button>
          <p className="pp-tiny pp-muted" style={{ marginTop: 6 }}>Adds a hostile instruction to this listing, as a malicious seller might, and shows what happens.</p>
        </div>
      )}
      {test && (
        <div className="pp-callout pp-callout-bad" style={{ marginTop: 12 }} role="status">
          <p style={{ fontWeight: 700 }}>Security test: a hidden instruction was added</p>
          {test.injectedSentence && <p className="pp-small" style={{ marginTop: 6 }}>“{test.injectedSentence}”</p>}
          <p className="pp-small" style={{ marginTop: 8 }}>
            PactPay&apos;s scanner flagged {test.findings.length} problem{test.findings.length === 1 ? "" : "s"}: {test.findings.map((item) => FINDING_LABEL[item.rule] ?? item.rule).join("; ") || "none"}.
          </p>
          {test.available ? (
            <p className="pp-small" style={{ marginTop: 8 }}>
              The AI reader saw the instruction too. It returned {test.claims.length} fact{test.claims.length === 1 ? "" : "s"} (before: {base?.claims.length ?? 0}). {test.rejected > 0 ? `${test.rejected} suspicious item${test.rejected === 1 ? " was" : "s were"} thrown away. ` : ""}
              {same ? "The facts are identical to before, so the instruction changed nothing." : "Review the facts above: every one still has to be quoted from the listing and none may be an instruction."}
            </p>
          ) : <p className="pp-small" style={{ marginTop: 8 }}>{test.reason ?? "The AI reader didn't answer."} The scanner result above still stands.</p>}
          <p className="pp-tiny" style={{ marginTop: 8 }}>The text is treated as data. It can never approve, hold or release a payment.</p>
        </div>
      )}
    </div>
  );
}


/** Lets the shopper hand a limited key to their own AI agent. The key is bound to the rules approved here. */
function AgentAccess() {
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("pactpay.activeApproval.v1");
      const parsed = raw ? JSON.parse(raw) as { approvalId?: unknown } : null;
      if (parsed && typeof parsed.approvalId === "string") setApprovalId(parsed.approvalId);
    } catch { /* no approval stored */ }
  }, []);

  async function create() {
    if (!approvalId || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/agent-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvalId }) });
      const payload = await response.json() as { key?: string; expiresAt?: string; error?: string };
      if (!response.ok || !payload.key) throw new Error(payload.error ?? "Couldn't create a key.");
      setKey(payload.key); setExpiresAt(payload.expiresAt ?? null);
      logEvent("you", "Created a limited agent key for my own AI agent.", `key:${approvalId}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't create a key."); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!approvalId) return;
    setBusy(true);
    try { await fetch("/api/agent-keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvalId }) }); setKey(null); }
    finally { setBusy(false); }
  }
  async function copy(label: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); window.setTimeout(() => setCopied(null), 1600); } catch { /* clipboard unavailable */ }
  }
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const mcpConfig = JSON.stringify({ mcpServers: { pactpay: { command: "node", args: ["scripts/mcp-server.mjs"], env: { PACTPAY_URL: origin, PACTPAY_AGENT_KEY: key ?? "ppk_..." } } } }, null, 2);

  return (
    <details className="pp-card-flat">
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Connect your own AI agent <span className="pp-small pp-muted" style={{ fontWeight: 500 }}>· optional</span></summary>
      <div className="pp-stack" style={{ marginTop: 12, gap: 12 }}>
        <p className="pp-small">Give another AI agent a key that is limited to the rules you just approved. It can shortlist offers and ask for PayPal holds. It can&apos;t change your rules, and it can&apos;t release money above the autonomy limit you chose. You still approve every hold on PayPal.</p>
        {!key && <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" style={{ justifySelf: "start" }} onClick={create} disabled={busy || !approvalId}>{busy ? "Creating…" : "Create an agent key"}</button>}
        {error && <p className="pp-callout pp-callout-bad" role="alert">{error}</p>}
        {key && (
          <>
            <div>
              <p className="pp-small" style={{ fontWeight: 700 }}>Your agent key <span className="pp-muted" style={{ fontWeight: 500 }}>(shown once{expiresAt ? `, expires ${new Date(expiresAt).toLocaleString()}` : ""})</span></p>
              <pre className="pp-code">{key}</pre>
              <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" onClick={() => copy("key", key)}>{copied === "key" ? "Copied" : "Copy key"}</button>
            </div>
            <div>
              <p className="pp-small" style={{ fontWeight: 700 }}>MCP config (Claude Desktop, Cursor and others)</p>
              <pre className="pp-code">{mcpConfig}</pre>
              <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" onClick={() => copy("mcp", mcpConfig)}>{copied === "mcp" ? "Copied" : "Copy config"}</button>
            </div>
            <p className="pp-tiny pp-muted">Prove the limits: run <code>pnpm agent:redteam</code> with this key to watch a misbehaving agent get refused.</p>
            <button type="button" className="pp-link-btn" style={{ justifySelf: "start" }} onClick={revoke} disabled={busy}>Revoke this key</button>
          </>
        )}
      </div>
    </details>
  );
}


/** What the shopper will actually see on PayPal: item price plus the fixed test shipping and tax. */
function EstimatedTotal({ offer }: { offer: LiveOffer }) {
  if (offer.currency !== "USD") return null;
  const quote = previewChannel3TestQuote(offer.price);
  return (
    <p className="pp-small" style={{ marginTop: 6 }}>
      <strong>About <span className="pp-num">{money(quote.total, "USD")}</span> total at checkout</strong>
      <span className="pp-muted"> · item {money(quote.itemPrice, "USD")} + test shipping {money(quote.shippingFee, "USD")} + test tax {money(quote.taxAmount, "USD")}. This is the amount PayPal will show and hold.</span>
    </p>
  );
}
