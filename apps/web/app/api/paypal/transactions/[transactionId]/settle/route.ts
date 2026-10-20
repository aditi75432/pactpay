import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ConstraintResult, Evidence, PurchasePact } from "@pactpay/pact-core";
import { evaluatePact, summarizeVerification, type OfferSnapshot } from "@pactpay/pact-core/policy";
import { evaluateSettlementGate } from "@pactpay/pact-core/settlement-state";
import {
  applyChannel3BoundTestScenario,
  applyProtectedDemoScenario,
  buildAuthorizedAmountPact,
  buildChannel3BoundTestOffer,
  isChannel3OfferPurchasable,
  type Channel3BoundSource,
  type Channel3BoundTestOffer,
  type ProtectedDemoScenarioId,
} from "@pactpay/pact-core/settlement-demo";
import {
  compareChannel3OfferRefresh,
  matchRefreshedChannel3Offer,
  normalizeChannel3SearchResponse,
} from "@pactpay/pact-core/channel3";
import {
  claimProtectedSettlementAction,
  finalizeProtectedCapture,
  finalizeProtectedVoid,
  getAuditEvents,
  getChannel3OfferSnapshot,
  getProtectedDemoContext,
  getTransactionById,
  isUuid,
  markProtectedSettlementUncertain,
  recordPolicyRun,
  storeChannel3RefreshCheck,
  updateProtectedDemoScenario,
  verifyAuditChain,
  type Channel3OfferSnapshotInput,
} from "../../../../../../../../lib/db";
import { hashCanonicalJson } from "../../../../../../../../lib/audit-chain";
import { captureAuthorizedPayment, getAuthorization, getCapture, isPayPalSandboxConfigured, voidAuthorization } from "../../../../../../../../lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOffer(value: unknown): OfferSnapshot | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.currency !== "string" ||
      !isRecord(value.attributes) || !Array.isArray(value.evidence)) return null;
  if (value.total !== null && value.total !== undefined && (typeof value.total !== "number" || !Number.isFinite(value.total))) return null;
  for (const raw of value.evidence) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.field !== "string" ||
        (typeof raw.value !== "string" && typeof raw.value !== "number" && typeof raw.value !== "boolean") ||
        typeof raw.collectedAt !== "string" || typeof raw.validUntil !== "string" ||
        typeof raw.subjectRef !== "string" || typeof raw.provenanceRef !== "string") return null;
  }
  return value as unknown as OfferSnapshot;
}

function asPact(value: unknown): PurchasePact | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.version !== 1 ||
      (value.currency !== "USD" && value.currency !== "INR") || !Array.isArray(value.constraints) ||
      !isRecord(value.authority) || value.authority.canCapture !== false || value.authority.canChangeHardConstraints !== false) return null;
  return value as unknown as PurchasePact;
}

function isApproval(details: unknown, pactHash: string): boolean {
  return isRecord(details) && details.explicitApproval === true && details.mode === "DEMO_SIMULATOR" && details.pactHash === pactHash;
}


const CHANNEL3_PRODUCT_DETAIL_BASE = "https://api.trychannel3.com/v1/products/";
const CHANNEL3_PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const CHANNEL3_REFRESH_TTL_MS = 10 * 60_000;

type RevalidationSummary = {
  status: "MATCHED_UNCHANGED" | "MATCHED_WITH_CHANGES" | "OFFER_NOT_FOUND" | "UNAVAILABLE" | "BINDING_MISMATCH";
  previousSnapshotId: string;
  refreshedSnapshotId: string | null;
  observedAt: string;
  changedFields: string[];
  securityFinding: string | null;
  note: string;
};

async function revalidateChannel3BoundOffer(args: {
  transactionId: string;
  transactionSnapshotId: string | null;
  stored: NonNullable<Awaited<ReturnType<typeof getProtectedDemoContext>>>;
  pact: PurchasePact;
}): Promise<{ stored: NonNullable<Awaited<ReturnType<typeof getProtectedDemoContext>>>; summary: RevalidationSummary }> {
  const baseline = args.stored.baseline_offer as Record<string, unknown>;
  const sourceSnapshotId = typeof baseline.sourceSnapshotId === "string" ? baseline.sourceSnapshotId : "";
  const now = new Date();
  const observedAt = now.toISOString();
  const failClosed = async (
    status: RevalidationSummary["status"],
    finding: string,
    note: string,
    changedFields: string[] = [],
  ) => {
    const current = args.stored.current_offer;
    await updateProtectedDemoScenario({
      transactionId: args.transactionId,
      expectedRevision: args.stored.revision,
      scenarioId: args.stored.scenario_id,
      currentOffer: current,
      securityFinding: finding,
    });
    const latest = await getProtectedDemoContext(args.transactionId);
    if (!latest) throw new Error("Protected context disappeared after recording failed live-offer revalidation.");
    return {
      stored: latest,
      summary: {
        status,
        previousSnapshotId: sourceSnapshotId || "(missing)",
        refreshedSnapshotId: null,
        observedAt,
        changedFields,
        securityFinding: finding,
        note,
      },
    };
  };

  if (!sourceSnapshotId || args.transactionSnapshotId !== sourceSnapshotId) {
    return failClosed(
      "BINDING_MISMATCH",
      "The transaction's selected Channel3 snapshot ID does not match the server-bound Purchase Pact context.",
      "PactPay could not verify the original selected-offer binding. Settlement is blocked.",
    );
  }
  const apiKey = process.env.CHANNEL3_API_KEY?.trim();
  if (!apiKey) {
    return failClosed(
      "UNAVAILABLE",
      "Channel3 credentials were unavailable during pre-settlement revalidation.",
      "PactPay could not query Channel3 immediately before settlement. The protected gate will fail closed.",
    );
  }
  const previous = await getChannel3OfferSnapshot(sourceSnapshotId);
  if (!previous || !CHANNEL3_PRODUCT_ID_PATTERN.test(previous.product_id)) {
    return failClosed(
      "BINDING_MISMATCH",
      "The original immutable Channel3 snapshot could not be loaded or its product identifier failed validation.",
      "PactPay could not prove which live merchant offer was selected. Settlement is blocked.",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${CHANNEL3_PRODUCT_DETAIL_BASE}${encodeURIComponent(previous.product_id)}`, {
      method: "GET",
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    const message = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "Channel3 timed out during pre-settlement revalidation."
      : "Channel3 could not be reached during pre-settlement revalidation.";
    return failClosed("UNAVAILABLE", message, `${message} No capture will be allowed; the known Sandbox authorization will be routed through the fail-closed gate.`);
  }
  if (!response.ok) {
    const message = response.status === 404
      ? "Channel3 no longer returns the selected product."
      : response.status === 429
        ? "Channel3 rate limit prevented pre-settlement revalidation."
        : `Channel3 revalidation returned HTTP ${response.status}.`;
    return failClosed("UNAVAILABLE", message, `${message} Settlement will fail closed rather than relying on the earlier catalog snapshot.`);
  }

  let detail: unknown;
  try { detail = await response.json(); }
  catch { return failClosed("UNAVAILABLE", "Channel3 returned invalid JSON during pre-settlement revalidation.", "Channel3's latest response was not valid JSON. Settlement is blocked."); }
  if (!isRecord(detail) || detail.id !== previous.product_id) {
    return failClosed("BINDING_MISMATCH", "Channel3's product detail ID did not match the originally selected product.", "PactPay could not re-confirm the same product ID. Settlement is blocked.");
  }

  let candidates: ReturnType<typeof normalizeChannel3SearchResponse>;
  try { candidates = normalizeChannel3SearchResponse({ products: [detail] }); }
  catch {
    return failClosed("UNAVAILABLE", "Channel3 returned an unsupported product-detail shape during revalidation.", "PactPay could not safely parse the latest merchant offer facts. Settlement is blocked.");
  }
  const matched = matchRefreshedChannel3Offer({
    productId: previous.product_id,
    offerDomain: previous.offer_domain,
    offerUrl: previous.offer_url,
  }, candidates);
  const oldNormalized = {
    productId: previous.product_id,
    productTitle: previous.product_title,
    offerDomain: previous.offer_domain,
    offerUrl: previous.offer_url,
    price: Number(previous.price),
    currency: previous.currency.trim(),
    availability: previous.availability,
    condition: previous.condition,
    ramGb: previous.ram_gb === null ? null : Number(previous.ram_gb),
  };
  const comparison = compareChannel3OfferRefresh(oldNormalized, matched);
  const checkId = randomUUID();
  const refreshedSnapshotId = matched ? randomUUID() : null;
  const validUntil = new Date(now.getTime() + CHANNEL3_REFRESH_TTL_MS).toISOString();
  const refreshedSnapshot: Channel3OfferSnapshotInput | null = matched && refreshedSnapshotId ? {
    id: refreshedSnapshotId,
    searchQuery: previous.search_query,
    productId: matched.productId,
    productTitle: matched.productTitle,
    description: matched.description,
    brand: matched.brand,
    imageUrl: matched.imageUrl,
    offerDomain: matched.offerDomain,
    offerUrl: matched.offerUrl,
    price: matched.price,
    currency: matched.currency,
    availability: matched.availability,
    condition: matched.condition,
    ramGb: matched.ramGb,
    structuredAttributes: matched.structuredAttributes,
    rawProduct: matched.rawProduct,
    rawOffer: matched.rawOffer,
    fetchedAt: observedAt,
    validUntil,
  } : null;
  await storeChannel3RefreshCheck({
    id: checkId,
    previousSnapshotId: previous.id,
    refreshedSnapshot,
    productId: previous.product_id,
    offerDomain: previous.offer_domain,
    status: matched ? "MATCHED" : "OFFER_NOT_FOUND",
    previousPrice: Number(previous.price),
    previousCurrency: previous.currency.trim(),
    currentPrice: matched?.price ?? null,
    currentCurrency: matched?.currency ?? null,
    changedFields: comparison.changedFields,
    comparison: comparison as unknown as Record<string, unknown>,
    fetchedAt: observedAt,
  });

  if (!matched || !refreshedSnapshot) {
    return failClosed(
      "OFFER_NOT_FOUND",
      "Channel3 no longer contains a uniquely matched offer for the same selected product and merchant.",
      "The exact product-plus-merchant offer could not be re-confirmed. PactPay will block settlement and attempt to void the Sandbox authorization.",
      comparison.changedFields,
    );
  }

  // Keep unexpected catalog drift inside the deterministic fail-closed path. Do not let
  // the offer builder throw before a gate decision if a live currency/price field changed.
  const refreshedCurrency = matched.currency.trim().toUpperCase();
  if (refreshedCurrency !== "USD") {
    return failClosed(
      "BINDING_MISMATCH",
      `The revalidated Channel3 offer currency changed to ${refreshedCurrency || "unknown"}; the bound Sandbox authorization is USD.`,
      `The latest offer currency is ${refreshedCurrency || "unknown"}. PactPay's protected test checkout only supports USD, so it will block settlement and attempt to void the Sandbox authorization.`,
      comparison.changedFields,
    );
  }
  if (!Number.isFinite(matched.price) || matched.price <= 0 || matched.price > 9_000) {
    return failClosed(
      "BINDING_MISMATCH",
      "The revalidated Channel3 item price is outside the supported positive Sandbox quote range.",
      "The refreshed catalog price cannot be safely represented by the protected Sandbox test quote. Settlement is blocked and the authorization will be routed through the fail-closed gate.",
      comparison.changedFields,
    );
  }

  const source: Channel3BoundSource = {
    snapshotId: sourceSnapshotId,
    currentObservationSnapshotId: refreshedSnapshot.id,
    productId: matched.productId,
    title: matched.productTitle,
    description: matched.description,
    brand: matched.brand,
    imageUrl: matched.imageUrl,
    domain: matched.offerDomain,
    offerUrl: matched.offerUrl,
    itemPrice: matched.price,
    currency: matched.currency,
    availability: matched.availability,
    condition: matched.condition,
    ramGb: matched.ramGb,
    structuredAttributes: matched.structuredAttributes,
    fetchedAt: observedAt,
    validUntil,
  };
  const refreshedBaseline = buildChannel3BoundTestOffer(args.transactionId, source, now);
  const mutation = applyChannel3BoundTestScenario(
    args.stored.scenario_id,
    refreshedBaseline,
    args.pact,
    now,
  );
  await updateProtectedDemoScenario({
    transactionId: args.transactionId,
    expectedRevision: args.stored.revision,
    scenarioId: args.stored.scenario_id,
    currentOffer: mutation.offer as unknown as Record<string, unknown>,
    securityFinding: mutation.securityFinding,
  });
  const latest = await getProtectedDemoContext(args.transactionId);
  if (!latest) throw new Error("Protected context disappeared after storing the fresh Channel3 revalidation.");
  return {
    stored: latest,
    summary: {
      status: comparison.changedFields.length > 0 ? "MATCHED_WITH_CHANGES" : "MATCHED_UNCHANGED",
      previousSnapshotId: previous.id,
      refreshedSnapshotId: refreshedSnapshot.id,
      observedAt,
      changedFields: comparison.changedFields,
      securityFinding: null,
      note: comparison.changedFields.length > 0
        ? `Channel3 confirmed the same product and merchant with changed catalog facts: ${comparison.changedFields.join(", ")}. The immutable refreshed observation is bound into the current test facts; amount drift will be checked against the existing authorization.`
        : "Channel3 re-confirmed the same product-plus-merchant offer immediately before settlement. Shipping and tax remain Sandbox test terms, not merchant checkout facts.",
    },
  };
}

export async function POST(_request: Request, routeContext: { params: Promise<{ transactionId: string }> }) {
  let claimedAction: "CAPTURE" | "VOID" | null = null;
  let transactionId: string | null = null;
  try {
    const { transactionId: rawId } = await routeContext.params;
    if (!isUuid(rawId)) return NextResponse.json({ error: "Invalid transaction ID." }, { status: 400 });
    transactionId = rawId;
    if (!isPayPalSandboxConfigured()) {
      return NextResponse.json({ error: "Protected settlement is disabled unless PAYPAL_BASE_URL points to a recognized PayPal Sandbox hostname." }, { status: 503 });
    }

    const tx = await getTransactionById(transactionId);
    if (!tx) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    if (tx.status === "CAPTURED" || tx.status === "VOIDED") {
      return NextResponse.json({
        transactionId,
        status: tx.status,
        idempotent: true,
        capturePerformedByPactPay: tx.capture_origin === "PACTPAY_GATE",
        note: "Terminal settlements are not repeated.",
      });
    }
    if (["VERIFYING", "CAPTURE_ELIGIBLE", "CAPTURING", "CAPTURE_REVIEW", "POLICY_BLOCKED", "VOIDING", "VOID_REVIEW"].includes(tx.status)) {
      return NextResponse.json({ error: `Settlement is already in progress or requires reconciliation (${tx.status}). Do not retry it manually.`, status: tx.status }, { status: 409 });
    }
    if (tx.status !== "AUTHORIZED" || !tx.authorization_id || !tx.paypal_order_id) {
      return NextResponse.json({ error: `Only an authorized, order-bound transaction can enter settlement; current state is ${tx.status}.` }, { status: 409 });
    }

    const initialStored = await getProtectedDemoContext(transactionId);
    if (!initialStored || initialStored.mode !== "DEMO_SIMULATOR") {
      return NextResponse.json({ error: "This transaction has no server-bound protected Purchase Pact. Generic PayPal Sandbox orders are ineligible for capture or void by this route." }, { status: 409 });
    }
    let stored = initialStored;
    const pact = asPact(stored.pact_json);
    let offer = asOffer(stored.current_offer);
    const baseline = asOffer(stored.baseline_offer);
    if (!pact || !offer || !baseline) {
      return NextResponse.json({ error: "Stored Purchase Pact or offer state is malformed. Settlement fails closed." }, { status: 409 });
    }

    let liveOfferRevalidation: RevalidationSummary | null = null;
    const baselineMetadata = stored.baseline_offer as Record<string, unknown>;
    const isChannel3BoundOffer = baselineMetadata.checkoutAdapter === "PACTPAY_CHANNEL3_TEST_CHECKOUT";
    if (isChannel3BoundOffer) {
      // Before asking PayPal to capture, query Channel3 for the same product + merchant
      // offer again. Never trust the browser's prior discovery result for settlement.
      const revalidated = await revalidateChannel3BoundOffer({
        transactionId,
        transactionSnapshotId: tx.offer_snapshot_id,
        stored,
        pact,
      });
      stored = revalidated.stored;
      liveOfferRevalidation = revalidated.summary;
      offer = asOffer(stored.current_offer);
      if (!offer) {
        return NextResponse.json({ error: "The revalidated offer context was malformed. No capture was issued; inspect the transaction and audit state." }, { status: 409 });
      }
    }

    // Re-query the actual PayPal authorization after the external offer revalidation and immediately before policy evaluation.
    const liveAuthorization = await getAuthorization(tx.authorization_id);
    const now = new Date();
    const liveExpiryMs = liveAuthorization.expiration_time ? Date.parse(liveAuthorization.expiration_time) : Number.NaN;
    const storedExpiryMs = tx.authorization_expires_at ? Date.parse(tx.authorization_expires_at) : Number.NaN;
    const authorizationNotExpired = Number.isFinite(liveExpiryMs) && liveExpiryMs > now.getTime() &&
      Number.isFinite(storedExpiryMs) && storedExpiryMs > now.getTime() &&
      Math.abs(liveExpiryMs - storedExpiryMs) < 5_000;
    const authorizationFieldsMatch = liveAuthorization.id === tx.authorization_id &&
      liveAuthorization.amount?.value !== undefined && liveAuthorization.amount.currency_code !== undefined &&
      Number(tx.amount).toFixed(2) === Number(liveAuthorization.amount.value).toFixed(2) &&
      tx.currency.trim() === liveAuthorization.amount.currency_code;
    if (liveAuthorization.status !== "CREATED" || !authorizationNotExpired || !authorizationFieldsMatch ||
        tx.paypal_authorization_status !== "CREATED" || tx.paypal_order_status !== "COMPLETED") {
      return NextResponse.json({
        error: "PayPal's latest authorization status/amount/currency/expiry does not match the stored authorization. No capture or void was attempted; manual reconciliation is required.",
        liveAuthorizationStatus: liveAuthorization.status,
        authorizationNotExpired,
        authorizationFieldsMatch,
        capturePerformedByPactPay: false,
      }, { status: 409 });
    }

    const auditChain = await verifyAuditChain(transactionId);
    const auditEvents = await getAuditEvents(transactionId);
    const auditHeadHash = auditEvents.at(-1)?.event_hash?.trim() ?? null;
    const auditSnapshotConsistent = auditChain.valid && auditChain.eventCount === auditEvents.length &&
      Boolean(auditHeadHash) && auditChain.lastHash === auditHeadHash;
    const approvalEvent = auditEvents.find((event) => event.event_type === "PURCHASE_PACT_APPROVED");
    const bindingEvent = auditEvents.find((event) => event.event_type === "PURCHASE_PACT_BOUND");
    const approvalMatches = Boolean(approvalEvent && isApproval(approvalEvent.details, stored.pact_hash.trim()));
    const bindingDetails = bindingEvent && isRecord(bindingEvent.details) ? bindingEvent.details : null;
    const bindingPactHash = typeof bindingDetails?.pactHash === "string" ? bindingDetails.pactHash.trim() : null;
    const bindingBaselineHash = typeof bindingDetails?.baselineOfferHash === "string" ? bindingDetails.baselineOfferHash.trim() : null;
    const bindingCurrentHash = typeof bindingDetails?.currentOfferHash === "string" ? bindingDetails.currentOfferHash.trim() : null;
    const computedPactHash = hashCanonicalJson(pact);
    const computedBaselineHash = hashCanonicalJson(baseline);
    const computedCurrentHash = hashCanonicalJson(offer);
    const pactHashMatches = computedPactHash === stored.pact_hash.trim().toLowerCase() &&
      bindingPactHash === stored.pact_hash.trim() && tx.pact_hash?.trim().toLowerCase() === stored.pact_hash.trim().toLowerCase();
    const baselineHashMatches = computedBaselineHash === stored.baseline_offer_hash.trim().toLowerCase() &&
      bindingBaselineHash === computedBaselineHash;
    const latestScenarioEvent = [...auditEvents].reverse().find((event) => event.event_type === "DEMO_SCENARIO_APPLIED");
    let currentOfferHashMatches = false;
    if (stored.revision === 1) {
      currentOfferHashMatches = computedCurrentHash === computedBaselineHash &&
        bindingCurrentHash === computedCurrentHash && bindingDetails?.scenarioId === stored.scenario_id;
    } else if (latestScenarioEvent && isRecord(latestScenarioEvent.details)) {
      currentOfferHashMatches = latestScenarioEvent.details.nextRevision === stored.revision &&
        latestScenarioEvent.details.scenarioId === stored.scenario_id &&
        typeof latestScenarioEvent.details.currentOfferHash === "string" &&
        latestScenarioEvent.details.currentOfferHash.trim() === computedCurrentHash;
    }
    const offerMetadata = offer as unknown as Record<string, unknown>;
    const sourceSnapshotBindingMatches = !isChannel3BoundOffer || (
      typeof baselineMetadata.sourceSnapshotId === "string" &&
      tx.offer_snapshot_id === baselineMetadata.sourceSnapshotId &&
      offerMetadata.sourceSnapshotId === baselineMetadata.sourceSnapshotId &&
      typeof offerMetadata.currentCatalogSnapshotId === "string" &&
      Boolean(liveOfferRevalidation && ["MATCHED_UNCHANGED", "MATCHED_WITH_CHANGES"].includes(liveOfferRevalidation.status))
    );
    const offerIdentityMatches = offer.id === baseline.id && offer.id === `pactpay-simulated-offer-${transactionId}` && sourceSnapshotBindingMatches;
    const currencyMatches = tx.currency.trim() === pact.currency && offer.currency === pact.currency;
    const securityClear = !stored.security_finding && auditSnapshotConsistent && pactHashMatches &&
      baselineHashMatches && currentOfferHashMatches && offerIdentityMatches && currencyMatches && approvalMatches && Boolean(bindingEvent);

    const authorizedPact = buildAuthorizedAmountPact(pact, tx.amount, tx.currency.trim());
    const policyVerification = evaluatePact(authorizedPact, offer, { securityClear, now });
    const bridgeAvailabilityEvidence = offer.evidence.filter((item: Evidence) =>
      item.field === "attributes.availability" && item.subjectRef === offer.id &&
      typeof item.provenanceRef === "string" && item.provenanceRef.trim().length > 0 &&
      Date.parse(item.collectedAt) <= now.getTime() && Date.parse(item.validUntil) > now.getTime() &&
      (item.sourceType === "channel3" || item.sourceType === "simulator") &&
      String(item.value).trim().toLocaleLowerCase("en-US") === String(offer.attributes.availability ?? "").trim().toLocaleLowerCase("en-US"),
    );
    const availabilityValue = offer.attributes.availability;
    const recognizedAvailable = isChannel3OfferPurchasable(availabilityValue);
    const knownUnavailable = typeof availabilityValue === "string" && ["outofstock", "unavailable", "discontinued"].includes(availabilityValue.toLocaleLowerCase("en-US").replace(/[\s_-]+/g, ""));
    const availabilityEvidenceFreshAndBound = bridgeAvailabilityEvidence.length > 0;
    const bridgeAvailabilityStatus: "pass" | "fail" | "unknown" | null = !isChannel3BoundOffer
      ? null
      : recognizedAvailable && availabilityEvidenceFreshAndBound
        ? "pass"
        : knownUnavailable && availabilityEvidenceFreshAndBound
          ? "fail"
          : "unknown";
    const bridgeAvailabilityResult: ConstraintResult | null = isChannel3BoundOffer ? {
      constraintId: "system.offer_availability",
      severity: "hard",
      status: bridgeAvailabilityStatus ?? "unknown",
      ...(availabilityValue !== null && availabilityValue !== undefined ? { actual: String(availabilityValue) } : {}),
      evidenceIds: bridgeAvailabilityEvidence.map((item: Evidence) => item.id),
      reason: bridgeAvailabilityStatus === "pass"
        ? `The latest bound catalog/test observation reports availability as ${String(availabilityValue)}.`
        : bridgeAvailabilityStatus === "fail"
          ? `The selected offer reports ${String(availabilityValue)}; an unavailable offer cannot proceed to payment.`
          : "PactPay could not verify a fresh, attributable positive availability state for this offer. Payment remains blocked.",
    } : null;
    const verification = bridgeAvailabilityResult
      ? {
          ...policyVerification,
          results: [...policyVerification.results, bridgeAvailabilityResult],
          evidenceFresh: policyVerification.evidenceFresh && bridgeAvailabilityStatus === "pass",
          evidenceAttributable: policyVerification.evidenceAttributable && availabilityEvidenceFreshAndBound,
        }
      : policyVerification;
    const summary = summarizeVerification(verification);
    const evidenceConflictFree = !verification.results.some((item) => item.status === "unknown" && /conflict/i.test(item.reason));
    const gateValidUntilMs = Math.min(
      liveExpiryMs,
      ...offer.evidence.map((item: Evidence) => Date.parse(item.validUntil)).filter((timestamp) => Number.isFinite(timestamp)),
    );
    const gateValidUntil = Number.isFinite(gateValidUntilMs) ? new Date(gateValidUntilMs).toISOString() : now.toISOString();
    const gate = evaluateSettlementGate({
      pactApproved: approvalMatches,
      transactionBindingValid: pactHashMatches && baselineHashMatches && offerIdentityMatches && Boolean(bindingEvent),
      currentSnapshotMatched: currentOfferHashMatches,
      authorizationId: liveAuthorization.id === tx.authorization_id ? liveAuthorization.id : null,
      authorizationStatus: liveAuthorization.status,
      authorizationNotExpired,
      authorizationAmount: liveAuthorization.amount?.value ?? "",
      authorizationCurrency: liveAuthorization.amount?.currency_code ?? "",
      verifiedTotal: typeof offer.total === "number" ? offer.total.toFixed(2) : "",
      verifiedCurrency: offer.currency,
      hardConstraintsPass: summary.decision === "capture",
      evidenceFresh: verification.evidenceFresh,
      evidenceAttributable: verification.evidenceAttributable,
      evidenceConflictFree,
      securityClear,
    });
    const decision = gate.decision === "CAPTURE_ELIGIBLE" ? "PASS" : "BLOCK";
    const decisionReason = decision === "PASS" ? "all_preconditions_satisfied" : gate.reasons.join(",") || summary.reason;
    const policyRunId = randomUUID();
    await recordPolicyRun({
      id: policyRunId,
      scenarioId: `protected_demo_${stored.scenario_id.toLowerCase()}`,
      pactId: authorizedPact.id,
      decision: decision === "PASS" ? "capture" : "block",
      decisionReason,
      securityClear: verification.securityClear && securityClear,
      evidenceFresh: verification.evidenceFresh,
      evidenceAttributable: verification.evidenceAttributable,
      offerSnapshot: offer as unknown as Record<string, unknown>,
      verificationResult: {
        verification,
        settlementGate: gate,
        authorizationRevalidation: {
          idMatches: liveAuthorization.id === tx.authorization_id,
          status: liveAuthorization.status,
          amountMatches: authorizationFieldsMatch,
          expiryMatches: authorizationNotExpired,
        },
        channel3LiveRevalidation: liveOfferRevalidation,
      } as unknown as Record<string, unknown>,
      pactSnapshot: authorizedPact as unknown as Record<string, unknown>,
    });

    const gatePayload = {
      transactionId,
      orderId: tx.paypal_order_id,
      authorizationId: liveAuthorization.id,
      pactHash: stored.pact_hash.trim(),
      revision: stored.revision,
      scenarioId: stored.scenario_id,
      currentOfferHash: computedCurrentHash,
      securityFindingPresent: Boolean(stored.security_finding),
      channel3LiveRevalidation: liveOfferRevalidation,
      gate,
      verification,
      decision,
      policyRunId,
      verifiedAt: verification.verifiedAt,
    };
    const gateHash = hashCanonicalJson(gatePayload);
    const claim = await claimProtectedSettlementAction({
      transactionId,
      expectedRevision: stored.revision,
      decision,
      reason: decisionReason,
      policyRunId,
      verification: { verification, settlementGate: gate, gateHash, gatePayload } as unknown as Record<string, unknown>,
      expectedPactHash: stored.pact_hash.trim(),
      expectedAuditHeadHash: auditHeadHash ?? "",
      gateHash,
      gateValidUntil,
    });
    if (!claim.claimed) {
      const status = claim.reason === "NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: `Settlement gate could not claim the action: ${claim.reason}. No PayPal settlement call was issued.`, reason: claim.reason }, { status });
    }
    claimedAction = claim.action;

    if (claim.action === "CAPTURE") {
      let capture = await captureAuthorizedPayment(claim.authorizationId, claim.amount, claim.currency, claim.requestId);

      // PayPal's default capture response can be minimal (id/status/links only). Never
      // infer the amount or currency from the request: fetch the capture resource by
      // ID before evaluating whether the external result matches the authorized value.
      // Preserve the original response ID before awaiting the lookup. TypeScript cannot
      // safely retain narrowing on a mutable object's optional property across an await.
      const returnedCaptureId = capture.id;
      const returnedCaptureStatus = capture.status;
      if (returnedCaptureId && (typeof capture.amount?.value !== "string" || typeof capture.amount?.currency_code !== "string")) {
        try {
          capture = await getCapture(returnedCaptureId);
        } catch (lookupError) {
          // The stable ID is guaranteed to be a string by the outer guard above.
          const captureId: string = returnedCaptureId;
          const captureStatus = typeof returnedCaptureStatus === "string" ? returnedCaptureStatus : "UNKNOWN";
          const final = await finalizeProtectedCapture({
            transactionId,
            captureId,
            captureStatus,
            amount: null,
            currency: null,
          });
          const updated = await getTransactionById(transactionId);
          console.error("PayPal capture was returned without amount/currency; capture lookup failed", lookupError instanceof Error ? lookupError.message : "unknown error");
          return NextResponse.json({
            transactionId,
            scenarioId: stored.scenario_id,
            settlementOutcome: final.status,
            transaction: updated ? { status: updated.status, amount: updated.amount, currency: updated.currency.trim(), captureId: updated.paypal_capture_id, captureStatus: updated.paypal_capture_status } : null,
            capturePerformedByPactPay: false,
            reconciliationRequired: true,
            error: "PayPal returned a capture ID but full amount/currency details could not be verified. The capture ID is preserved for reconciliation; do not retry this transaction.",
            simulatorOnly: true,
          }, { status: 502 });
        }
      }

      const final = await finalizeProtectedCapture({
        transactionId,
        captureId: typeof capture.id === "string" ? capture.id : "",
        captureStatus: typeof capture.status === "string" ? capture.status : "UNKNOWN",
        amount: typeof capture.amount?.value === "string" ? capture.amount.value : null,
        currency: typeof capture.amount?.currency_code === "string" ? capture.amount.currency_code : null,
      });
      const updated = await getTransactionById(transactionId);
      return NextResponse.json({
        transactionId,
        scenarioId: stored.scenario_id,
        decision,
        decisionReason,
        settlementGate: gate,
        verification,
        policyRunId,
        gateHash,
        gateValidUntil,
        liveOfferRevalidation,
        settlementOutcome: final.status,
        transaction: updated ? { status: updated.status, amount: updated.amount, currency: updated.currency.trim(), captureId: updated.paypal_capture_id, captureStatus: updated.paypal_capture_status } : null,
        capturePerformedByPactPay: final.status === "CAPTURED" && updated?.capture_origin === "PACTPAY_GATE",
        simulatorOnly: true,
        note: isChannel3BoundOffer
          ? "The test checkout was bound to a real Channel3 catalog snapshot and revalidated against the same product-plus-merchant listing before the gate. Shipping/tax are simulated fixture terms; this is not a retailer order."
          : "This capture is a PayPal Sandbox demonstration for a simulated offer, not payment to a Channel3-listed retailer.",
      }, { status: final.status === "CAPTURED" ? 200 : 502 });
    }

    await voidAuthorization(claim.authorizationId, claim.requestId);
    const finalStatus = await finalizeProtectedVoid(transactionId);
    const updated = await getTransactionById(transactionId);
    return NextResponse.json({
      transactionId,
      scenarioId: stored.scenario_id,
      decision,
      decisionReason,
      settlementGate: gate,
      verification,
      policyRunId,
      gateHash,
      gateValidUntil,
      liveOfferRevalidation,
      settlementOutcome: finalStatus,
      transaction: updated ? { status: updated.status, amount: updated.amount, currency: updated.currency.trim(), authorizationId: updated.authorization_id, voidStatus: updated.paypal_void_status } : null,
      capturePerformedByPactPay: false,
      simulatorOnly: true,
      note: isChannel3BoundOffer
        ? "The protected gate blocked the offer-bound Sandbox test checkout and PactPay attempted to void the authorization. Channel3 catalog facts are real observations; checkout terms and deliberate drift scenarios are test fixtures."
        : "The policy gate blocked this simulated purchase and PactPay attempted to void its Sandbox authorization.",
    });
  } catch (error) {
    if (transactionId && claimedAction) {
      try {
        await markProtectedSettlementUncertain({
          transactionId,
          action: claimedAction,
          message: error instanceof Error ? error.message : "Unknown PayPal settlement error.",
        });
      } catch (reconcileError) {
        console.error("Could not record protected settlement uncertainty", reconcileError instanceof Error ? reconcileError.message : "unknown error");
      }
    }
    console.error("Protected settlement gate failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({
      error: claimedAction
        ? "PayPal settlement outcome could not be confirmed. The transaction is in reconciliation review when possible; do not retry manually."
        : "Settlement verification failed before a PayPal settlement request was claimed. No capture or void request was issued.",
      capturePerformedByPactPay: false,
    }, { status: 502 });
  }
}
