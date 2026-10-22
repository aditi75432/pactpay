import type { Evidence, PurchasePact } from "./index.js";
import type { OfferSnapshot } from "./policy.js";

export const PROTECTED_DEMO_AMOUNT = "849.00";
export const PROTECTED_DEMO_CURRENCY = "USD" as const;
export const PROTECTED_DEMO_EVIDENCE_TTL_MS = 5 * 60 * 1000;

export const PROTECTED_DEMO_SCENARIOS = [
  { id: "BASELINE", label: "Compliant offer", description: "All pact conditions are satisfied." },
  { id: "PRICE_INCREASE", label: "Catalog price increased", description: "The test adapter raises the selected offer price after authorization." },
  { id: "OUT_OF_STOCK", label: "Offer becomes unavailable", description: "The selected offer is changed to out of stock in the test fixture." },
  { id: "BUDGET_OVERRUN", label: "Budget overrun", description: "The final total rises above the authorized amount and budget." },
  { id: "PRODUCT_DOWNGRADE", label: "Product downgrade", description: "RAM changes from 16 GB to 8 GB." },
  { id: "DELIVERY_SLIP", label: "Delivery deadline slip", description: "Delivery moves beyond the promised deadline." },
  { id: "RETURNS_DOWNGRADE", label: "Return-policy downgrade", description: "The return window falls below the minimum." },
  { id: "PROMPT_INJECTION", label: "Untrusted merchant instruction", description: "Merchant text asks the agent to ignore the pact and pay immediately." },
  { id: "CURRENCY_MISMATCH", label: "Currency mismatch", description: "The observed offer currency differs from the approved currency." },
] as const;

export type ProtectedDemoScenarioId = (typeof PROTECTED_DEMO_SCENARIOS)[number]["id"];

export interface ProtectedDemoContext {
  transactionId: string;
  mode: "DEMO_SIMULATOR";
  pact: PurchasePact;
  pactHash: string;
  baselineOffer: OfferSnapshot;
  currentOffer: OfferSnapshot;
  scenarioId: ProtectedDemoScenarioId;
  securityFinding: string | null;
  revision: number;
  gateDecision: "UNVERIFIED" | "PASS" | "BLOCK";
  gateVerification: Record<string, unknown> | null;
  gateHash: string | null;
  gateVerifiedAt: string | null;
  gateValidUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalize(source[key])]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function utcDatePlusDays(now: Date, days: number): string {
  const date = new Date(now.getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function createOffer(args: {
  transactionId: string;
  now: Date;
  total: number;
  itemPrice: number;
  shippingFee: number;
  ramGb: number;
  deliveryDate: string;
  returnWindowDays: number;
  currency: string;
  condition: string;
  availability: string;
}): OfferSnapshot {
  const id = `pactpay-simulated-offer-${args.transactionId}`;
  const collectedAt = args.now.toISOString();
  const validUntil = new Date(args.now.getTime() + PROTECTED_DEMO_EVIDENCE_TTL_MS).toISOString();
  const provenanceRef = `simulator://pactpay/${args.transactionId}/revision/${collectedAt}`;
  const fields: Array<{ field: string; value: string | number }> = [
    { field: "total", value: args.total },
    { field: "currency", value: args.currency },
    { field: "shippingFee", value: args.shippingFee },
    { field: "deliveryDate", value: args.deliveryDate },
    { field: "returnWindowDays", value: args.returnWindowDays },
    { field: "attributes.itemPrice", value: args.itemPrice },
    { field: "attributes.ramGb", value: args.ramGb },
    { field: "attributes.condition", value: args.condition },
    { field: "attributes.availability", value: args.availability },
    { field: "attributes.brand", value: "Lenovo" },
  ];
  const evidence: Evidence[] = fields.map(({ field, value }, index) => ({
    id: `sim-${args.transactionId}-${index}-${collectedAt}`,
    source: "PactPay controlled merchant simulator",
    sourceType: "simulator",
    collectedAt,
    validUntil,
    claim: `Simulator fixture observed ${field}=${String(value)}. This is test data, not a real merchant statement.`,
    value,
    provenanceRef,
    field,
    subjectRef: id,
  }));

  return {
    id,
    currency: args.currency,
    total: args.total,
    shippingFee: args.shippingFee,
    deliveryDate: args.deliveryDate,
    returnWindowDays: args.returnWindowDays,
    attributes: {
      itemPrice: args.itemPrice,
      ramGb: args.ramGb,
      condition: args.condition,
      availability: args.availability,
      brand: "Lenovo",
    },
    evidence,
  };
}

export function buildProtectedDemoPact(transactionId: string, now = new Date()): PurchasePact {
  const deadline = utcDatePlusDays(now, 4);
  return {
    id: `pactpay-demo-pact-${transactionId}`,
    version: 1,
    currency: PROTECTED_DEMO_CURRENCY,
    maxTotalAmount: 900,
    authority: {
      canSearch: true,
      canCompare: true,
      canCreateOrder: true,
      canAuthorize: true,
      canCapture: false,
      canSubstitute: false,
      canChangeHardConstraints: false,
    },
    constraints: [
      { id: "ram", kind: "attribute", severity: "hard", description: "Laptop must have at least 16 GB RAM.", expected: 16, comparator: "gte", field: "attributes.ramGb" },
      { id: "condition", kind: "attribute", severity: "hard", description: "Laptop must be refurbished.", expected: "refurbished", comparator: "eq", field: "attributes.condition" },
      { id: "availability", kind: "attribute", severity: "hard", description: "Offer must be in stock.", expected: "InStock", comparator: "eq", field: "attributes.availability" },
      { id: "delivery", kind: "delivery_deadline", severity: "hard", description: `Delivery must be on or before ${deadline}.`, expected: deadline, comparator: "lte", field: "deliveryDate" },
      { id: "returns", kind: "return_window", severity: "hard", description: "Return window must be at least 14 days.", expected: 14, comparator: "gte", field: "returnWindowDays" },
      { id: "shipping", kind: "shipping_fee", severity: "hard", description: "Shipping must be no more than $25.", expected: 25, comparator: "lte", field: "shippingFee" },
      { id: "brand-preference", kind: "attribute", severity: "soft", description: "Prefer Lenovo when other constraints are satisfied.", expected: "Lenovo", comparator: "contains", field: "attributes.brand" },
    ],
  };
}

export function buildProtectedDemoOffer(transactionId: string, now = new Date()): OfferSnapshot {
  return createOffer({
    transactionId,
    now,
    total: 849,
    itemPrice: 829,
    shippingFee: 20,
    ramGb: 16,
    deliveryDate: utcDatePlusDays(now, 4),
    returnWindowDays: 30,
    currency: PROTECTED_DEMO_CURRENCY,
    condition: "refurbished",
    availability: "InStock",
  });
}

export function applyProtectedDemoScenario(
  transactionId: string,
  scenarioId: ProtectedDemoScenarioId,
  now = new Date(),
  approvedBaseline?: OfferSnapshot,
): { offer: OfferSnapshot; securityFinding: string | null } {
  const baselineOffer = approvedBaseline ?? buildProtectedDemoOffer(transactionId, now);
  const baseline: { total: number; itemPrice: number; shippingFee: number; ramGb: number; deliveryDate: string; returnWindowDays: number; currency: string; condition: string; availability: string } = {
    total: Number(baselineOffer.total),
    itemPrice: Number(baselineOffer.attributes.itemPrice),
    shippingFee: Number(baselineOffer.shippingFee),
    ramGb: Number(baselineOffer.attributes.ramGb),
    deliveryDate: String(baselineOffer.deliveryDate),
    returnWindowDays: Number(baselineOffer.returnWindowDays),
    currency: baselineOffer.currency,
    condition: String(baselineOffer.attributes.condition),
    availability: String(baselineOffer.attributes.availability),
  };
  const data = { ...baseline };
  let securityFinding: string | null = null;
  switch (scenarioId) {
    case "BASELINE":
      break;
    case "PRICE_INCREASE":
      data.total = baseline.total + 10;
      data.itemPrice = baseline.itemPrice + 10;
      break;
    case "OUT_OF_STOCK":
      data.availability = "OutOfStock";
      break;
    case "BUDGET_OVERRUN":
      data.total = 949;
      data.itemPrice = 929;
      break;
    case "PRODUCT_DOWNGRADE":
      data.ramGb = 8;
      break;
    case "DELIVERY_SLIP":
      data.deliveryDate = utcDatePlusDays(now, 6);
      break;
    case "RETURNS_DOWNGRADE":
      data.returnWindowDays = 7;
      break;
    case "PROMPT_INJECTION":
      securityFinding = "Untrusted simulated merchant text attempted to override the approved pact and request immediate payment.";
      break;
    case "CURRENCY_MISMATCH":
      data.currency = "CAD";
      break;
  }
  const offer = createOffer({ transactionId, now, ...data });
  return { offer, securityFinding };
}


/**
 * Explicit input facts from an immutable Channel3 snapshot. Any other checkout
 * fields below are labelled test fixtures and must never be described as merchant terms.
 */
export interface Channel3BoundSource {
  snapshotId: string;
  currentObservationSnapshotId?: string;
  productId: string;
  title: string;
  description?: string | null;
  brand?: string | null;
  imageUrl?: string | null;
  domain: string;
  offerUrl: string;
  itemPrice: number;
  currency: string;
  availability?: string | null;
  condition?: string | null;
  ramGb?: number | null;
  structuredAttributes?: Record<string, unknown>;
  fetchedAt: string;
  validUntil: string;
}

export interface Channel3BoundTestOffer extends OfferSnapshot {
  checkoutAdapter: "PACTPAY_CHANNEL3_TEST_CHECKOUT";
  sourceSnapshotId: string;
  currentCatalogSnapshotId: string;
  sourceProductId: string;
  sourceTitle: string;
  sourceDescription: string | null;
  sourceBrand: string | null;
  sourceImageUrl: string | null;
  sourceDomain: string;
  sourceOfferUrl: string;
  sourceFetchedAt: string;
  sourceValidUntil: string;
  sourceItemPrice: number;
  sourceStructuredAttributes: Record<string, unknown>;
  scenarioApplied?: { id: string; note: string; changedAt: string };
  sandboxQuote: {
    itemPrice: number;
    shippingFee: number;
    taxRate: number;
    taxAmount: number;
    total: number;
    currency: string;
    quoteVersion: "pactpay-sandbox-test-quote-v1";
    disclaimer: string;
  };
}


/**
 * Catalog-backed test checkout requires explicit positive availability evidence.
 * Unknown provider states deliberately return false (fail closed).
 */
export function isChannel3OfferPurchasable(availability: unknown): boolean {
  if (typeof availability !== "string" || !availability.trim()) return false;
  const normalized = availability.toLocaleLowerCase("en-US").replace(/[\s_-]+/g, "");
  return ["instock", "available", "limitedavailability", "lowstock"].includes(normalized);
}

export const CHANNEL3_TEST_SHIPPING_USD = 4.99;
export const CHANNEL3_TEST_TAX_RATE = 0.08;

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function quoteForItemPrice(itemPrice: number) {
  const itemCents = roundCents(itemPrice);
  const shippingCents = roundCents(CHANNEL3_TEST_SHIPPING_USD);
  const taxCents = Math.round((itemCents + shippingCents) * CHANNEL3_TEST_TAX_RATE);
  return {
    itemPrice: itemCents / 100,
    shippingFee: shippingCents / 100,
    taxRate: CHANNEL3_TEST_TAX_RATE,
    taxAmount: taxCents / 100,
    total: (itemCents + shippingCents + taxCents) / 100,
    currency: "USD",
    quoteVersion: "pactpay-sandbox-test-quote-v1" as const,
    disclaimer: "PactPay test fixture only: fixed $4.99 shipping and 8% test tax. These are not merchant checkout terms or a retailer order.",
  };
}

function makeEvidence(args: {
  id: string;
  source: string;
  sourceType: Evidence["sourceType"];
  collectedAt: string;
  validUntil: string;
  claim: string;
  value: string | number | boolean;
  field: string;
  subjectRef: string;
  provenanceRef: string;
}): Evidence {
  return { ...args };
}

/**
 * Bind a real Channel3 catalog observation to a Sandbox-only checkout quote.
 * The product facts are sourced from Channel3; only shipping/tax/total quote
 * terms are simulated and conspicuously tagged in metadata and evidence.
 */
export function buildChannel3BoundTestOffer(
  transactionId: string,
  source: Channel3BoundSource,
  now = new Date(),
): Channel3BoundTestOffer {
  if (source.currency.trim().toUpperCase() !== "USD") {
    throw new Error("The protected Sandbox checkout adapter currently supports USD offers only.");
  }
  if (!Number.isFinite(source.itemPrice) || source.itemPrice <= 0 || source.itemPrice > 9_000) {
    throw new Error("The selected catalog item price is outside the supported Sandbox test range.");
  }
  const itemPrice = roundCents(source.itemPrice) / 100;
  const quote = quoteForItemPrice(itemPrice);
  const id = `pactpay-simulated-offer-${transactionId}`;
  const simulatorValidity = new Date(now.getTime() + PROTECTED_DEMO_EVIDENCE_TTL_MS).toISOString();
  const simulatorRef = `simulator://pactpay/channel3-test-checkout/${transactionId}/${source.currentObservationSnapshotId ?? source.snapshotId}`;
  const evidence: Evidence[] = [];
  const addChannel3 = (field: string, value: string | number | null | undefined, label: string) => {
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return;
    evidence.push(makeEvidence({
      id: `channel3-${source.currentObservationSnapshotId ?? source.snapshotId}-${field.replace(/[^a-zA-Z0-9-]/g, "-")}`,
      source: "Channel3 live catalog snapshot",
      sourceType: "channel3",
      collectedAt: source.fetchedAt,
      validUntil: source.validUntil,
      claim: `Channel3 reported ${label}: ${String(value)}. This is a catalog observation, not a checkout promise.`,
      value,
      field,
      subjectRef: id,
      provenanceRef: source.offerUrl,
    }));
  };
  const addSimulator = (field: string, value: number | string, claim: string) => {
    evidence.push(makeEvidence({
      id: `sandbox-${transactionId}-${source.currentObservationSnapshotId ?? source.snapshotId}-${field.replace(/[^a-zA-Z0-9-]/g, "-")}`,
      source: "PactPay Sandbox test-checkout fixture",
      sourceType: "simulator",
      collectedAt: now.toISOString(),
      validUntil: simulatorValidity,
      claim,
      value,
      field,
      subjectRef: id,
      provenanceRef: simulatorRef,
    }));
  };

  addChannel3("currency", source.currency.trim().toUpperCase(), "offer currency");
  addChannel3("attributes.itemPrice", itemPrice, "catalog item price");
  addChannel3("attributes.availability", source.availability, "availability");
  addChannel3("attributes.condition", source.condition, "condition");
  addChannel3("attributes.brand", source.brand, "brand");
  if (source.ramGb !== null && source.ramGb !== undefined && Number.isFinite(source.ramGb)) {
    addChannel3("attributes.ramGb", source.ramGb, "structured RAM attribute in GB");
  }
  addSimulator("shippingFee", quote.shippingFee,
    `PactPay test adapter set simulated shipping to ${quote.currency} ${quote.shippingFee.toFixed(2)}; this is not a merchant shipping quote.`);
  addSimulator("total", quote.total,
    `PactPay Sandbox test quote ${quote.currency} ${quote.total.toFixed(2)} = live Channel3 item price ${quote.itemPrice.toFixed(2)} + simulated shipping ${quote.shippingFee.toFixed(2)} + simulated tax ${quote.taxAmount.toFixed(2)} at ${(quote.taxRate * 100).toFixed(0)}%; not a retailer checkout total.`);

  const attributes: Record<string, string | number | boolean | null | undefined> = {
    itemPrice,
    ...(source.availability ? { availability: source.availability } : {}),
    ...(source.condition ? { condition: source.condition } : {}),
    ...(source.brand ? { brand: source.brand } : {}),
    ...(source.ramGb !== null && source.ramGb !== undefined && Number.isFinite(source.ramGb) ? { ramGb: source.ramGb } : {}),
  };
  return {
    id,
    currency: source.currency.trim().toUpperCase(),
    total: quote.total,
    shippingFee: quote.shippingFee,
    deliveryDate: null,
    returnWindowDays: null,
    attributes,
    evidence,
    checkoutAdapter: "PACTPAY_CHANNEL3_TEST_CHECKOUT",
    sourceSnapshotId: source.snapshotId,
    currentCatalogSnapshotId: source.currentObservationSnapshotId ?? source.snapshotId,
    sourceProductId: source.productId,
    sourceTitle: source.title,
    sourceDescription: source.description ?? null,
    sourceBrand: source.brand ?? null,
    sourceImageUrl: source.imageUrl ?? null,
    sourceDomain: source.domain,
    sourceOfferUrl: source.offerUrl,
    sourceFetchedAt: source.fetchedAt,
    sourceValidUntil: source.validUntil,
    sourceItemPrice: itemPrice,
    sourceStructuredAttributes: source.structuredAttributes ?? {},
    sandboxQuote: quote,
  };
}

function withSimulatorEvidence(offer: Channel3BoundTestOffer, field: string, value: string | number, claim: string, now: Date): Evidence {
  return makeEvidence({
    id: `sandbox-${offer.id}-${offer.currentCatalogSnapshotId}-${field.replace(/[^a-zA-Z0-9-]/g, "-")}-${now.getTime()}`,
    source: "PactPay controlled test fixture",
    sourceType: "simulator",
    collectedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + PROTECTED_DEMO_EVIDENCE_TTL_MS).toISOString(),
    claim,
    value,
    field,
    subjectRef: offer.id,
    provenanceRef: `simulator://pactpay/${offer.id}/${field}/${now.getTime()}`,
  });
}

/** Apply a clearly labelled test mutation to an offer-bound Sandbox quote. */
export function applyChannel3BoundTestScenario(
  scenarioId: string,
  baseline: Channel3BoundTestOffer,
  pact: PurchasePact,
  now = new Date(),
): { offer: Channel3BoundTestOffer; securityFinding: string | null } {
  const offer: Channel3BoundTestOffer = {
    ...baseline,
    attributes: { ...baseline.attributes },
    evidence: [...baseline.evidence],
    sandboxQuote: { ...baseline.sandboxQuote },
  };
  let securityFinding: string | null = null;
  if (scenarioId === "BASELINE") return { offer, securityFinding };
  if (scenarioId === "PROMPT_INJECTION") {
    offer.scenarioApplied = {
      id: scenarioId,
      changedAt: now.toISOString(),
      note: "A controlled untrusted-merchant instruction fixture attempted to override the approved Pact. It has no authority to modify policy or request payment.",
    };
    securityFinding = "Untrusted test-fixture merchant text attempted to override the approved Pact and request immediate payment.";
    return { offer, securityFinding };
  }
  if (scenarioId === "PRICE_INCREASE") {
    const currentItemPrice = Number(offer.attributes.itemPrice);
    if (!Number.isFinite(currentItemPrice)) throw new Error("The selected offer has no catalog item price to mutate.");
    const itemCap = pact.constraints
      .filter((item) => item.severity === "hard" && item.field === "attributes.itemPrice" && item.comparator === "lte" && typeof item.expected === "number")
      .map((item) => item.expected as number)
      .sort((left, right) => left - right)[0];
    let newPrice = Math.round((currentItemPrice + 1) * 100) / 100;
    if (itemCap !== undefined) newPrice = Math.max(newPrice, Math.round((itemCap + 0.01) * 100) / 100);
    const quote = quoteForItemPrice(newPrice);
    offer.attributes.itemPrice = quote.itemPrice;
    offer.total = quote.total;
    offer.shippingFee = quote.shippingFee;
    offer.sandboxQuote = quote;
    offer.evidence = offer.evidence.filter((item) => item.field !== "attributes.itemPrice" && item.field !== "total");
    offer.evidence.push(withSimulatorEvidence(offer, "attributes.itemPrice", quote.itemPrice,
      `Controlled test mutation raised the item price from ${currentItemPrice.toFixed(2)} to ${quote.itemPrice.toFixed(2)} ${offer.currency}. This is not a live merchant price update.`, now));
    offer.evidence.push(withSimulatorEvidence(offer, "total", quote.total,
      `Controlled Sandbox test quote recalculated to ${quote.total.toFixed(2)} after the simulated price increase. This is not a merchant checkout total.`, now));
    offer.scenarioApplied = { id: scenarioId, changedAt: now.toISOString(), note: `Catalog item price test-mutated from ${currentItemPrice.toFixed(2)} to ${quote.itemPrice.toFixed(2)} ${offer.currency}. The live Channel3 snapshot is unchanged.` };
    return { offer, securityFinding };
  }
  if (scenarioId === "OUT_OF_STOCK") {
    offer.attributes.availability = "OutOfStock";
    offer.evidence = offer.evidence.filter((item) => item.field !== "attributes.availability");
    offer.evidence.push(withSimulatorEvidence(offer, "attributes.availability", "OutOfStock",
      "Controlled test mutation marked the selected offer OutOfStock. Channel3's original snapshot is unchanged.", now));
    offer.scenarioApplied = { id: scenarioId, changedAt: now.toISOString(), note: "Availability was changed to OutOfStock in the test fixture only." };
    return { offer, securityFinding };
  }
  if (scenarioId === "CURRENCY_MISMATCH") {
    offer.currency = "CAD";
    offer.sandboxQuote = { ...offer.sandboxQuote, currency: "CAD" };
    offer.evidence = offer.evidence.filter((item) => item.field !== "currency");
    offer.evidence.push(withSimulatorEvidence(offer, "currency", "CAD",
      "Controlled test mutation changed the observed quote currency to CAD to verify fail-closed currency binding. The PayPal authorization remains USD.", now));
    offer.scenarioApplied = { id: scenarioId, changedAt: now.toISOString(), note: "Currency mismatch is a test mutation only." };
    return { offer, securityFinding };
  }
  throw new Error(`Scenario '${scenarioId}' is not supported for a Channel3-bound test checkout.`);
}

export function buildAuthorizedAmountPact(pact: PurchasePact, amount: string, currency: string): PurchasePact {
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) throw new Error("Authorized amount must be a positive finite number.");
  return {
    ...pact,
    constraints: [
      ...pact.constraints,
      {
        id: "system.authorized_amount_match",
        kind: "budget",
        severity: "hard",
        description: "Current simulated purchase total must exactly equal the authorized amount.",
        expected: parsedAmount,
        comparator: "eq",
        field: "total",
      },
      {
        id: "system.authorized_currency_match",
        kind: "attribute",
        severity: "hard",
        description: "The approved pact currency must equal the authorized payment currency.",
        expected: currency,
        comparator: "eq",
        field: "currency",
      },
    ],
  };
}

/** Read-only preview of the test quote the server will compute, so the UI can show the exact breakdown before a hold. */
export const previewChannel3TestQuote = quoteForItemPrice;
