import type { Evidence, PurchasePact } from "./index";
import type { OfferSnapshot } from "./policy";

export const DEMO_SCENARIO_IDS = [
  "compliant",
  "budget_overrun",
  "ram_downgrade",
  "delivery_slip",
  "return_policy_downgrade",
  "stale_evidence",
  "conflicting_evidence",
  "currency_mismatch",
  "merchant_instruction",
] as const;

export type DemoScenarioId = (typeof DEMO_SCENARIO_IDS)[number];

export interface DemoScenario {
  id: DemoScenarioId;
  title: string;
  description: string;
  securityClear: boolean;
  securityNote?: string;
  pact: PurchasePact;
  offer: OfferSnapshot;
}

function addDays(now: Date, days: number): string {
  const result = new Date(now.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function makeEvidence(args: {
  scenarioId: DemoScenarioId;
  offerId: string;
  field: string;
  value: string | number | boolean;
  now: Date;
  stale: boolean;
  suffix?: string;
}): Evidence {
  const { scenarioId, offerId, field, value, now, stale, suffix = "" } = args;
  const collectedAt = new Date(now.getTime() - 1_000).toISOString();
  const validUntil = new Date(now.getTime() + (stale ? -1_000 : 5 * 60_000)).toISOString();
  return {
    id: `${scenarioId}-${field.replace(/[^a-zA-Z0-9]/g, "-")}${suffix}`,
    source: "PactPay deterministic scenario simulator",
    sourceType: "simulator",
    collectedAt,
    validUntil,
    claim: `${field} = ${String(value)}`,
    value,
    field,
    subjectRef: offerId,
    provenanceRef: `sim://pactpay/${scenarioId}/${offerId}/${field}${suffix}`,
  };
}

/**
 * Build deterministic, explicitly simulated scenarios for the Policy Lab.
 * No third-party product feed or live merchant evidence is represented here.
 */
export function createDemoScenario(id: DemoScenarioId, now = new Date()): DemoScenario {
  const deadline = addDays(now, 4);
  const baselineDelivery = addDays(now, 2);
  const offerId = `sim-offer-${id}-v1`;

  const pact: PurchasePact = {
    id: `sim-pact-${id}-v1`,
    version: 1,
    currency: "USD",
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
      { id: "budget", kind: "budget", severity: "hard", description: "Total must be at most $900.", expected: 900, comparator: "lte", field: "total" },
      { id: "ram", kind: "attribute", severity: "hard", description: "Memory must be at least 16 GB.", expected: 16, comparator: "gte", field: "attributes.ramGb" },
      { id: "delivery", kind: "delivery_deadline", severity: "hard", description: `Delivery must be by ${deadline}.`, expected: deadline, comparator: "lte", field: "deliveryDate" },
      { id: "returns", kind: "return_window", severity: "hard", description: "Return window must be at least 14 days.", expected: 14, comparator: "gte", field: "returnWindowDays" },
      { id: "shipping", kind: "shipping_fee", severity: "hard", description: "Shipping must be at most $25.", expected: 25, comparator: "lte", field: "shippingFee" },
      { id: "brand-preference", kind: "attribute", severity: "soft", description: "Prefer Lenovo if available.", expected: "Lenovo", comparator: "contains", field: "attributes.brand" },
    ],
  };

  let currency: "USD" | "INR" = "USD";
  let total = 849;
  let shippingFee = 10;
  let deliveryDate = baselineDelivery;
  let returnWindowDays = 30;
  let ramGb = 16;
  let securityClear = true;
  let securityNote: string | undefined;

  switch (id) {
    case "compliant":
      break;
    case "budget_overrun":
      total = 949;
      break;
    case "ram_downgrade":
      ramGb = 8;
      break;
    case "delivery_slip":
      deliveryDate = addDays(now, 7);
      break;
    case "return_policy_downgrade":
      returnWindowDays = 7;
      break;
    case "stale_evidence":
      // Values are unchanged; only the evidence has expired.
      break;
    case "conflicting_evidence":
      // Contradictory fresh evidence is appended after the baseline evidence.
      break;
    case "currency_mismatch":
      currency = "INR";
      break;
    case "merchant_instruction":
      securityClear = false;
      securityNote = "Simulated red-team finding: merchant text attempts to override the user's budget and request immediate payment. This fixture supplies a failed security check to test fail-closed behavior; it is not an autonomous prompt-injection detector.";
      break;
  }

  const offer: OfferSnapshot = {
    id: offerId,
    currency,
    total,
    shippingFee,
    deliveryDate,
    returnWindowDays,
    attributes: { ramGb, brand: "Dell", condition: "refurbished" },
    evidence: [],
  };
  const stale = id === "stale_evidence";
  const fields: Array<{ field: string; value: string | number | boolean }> = [
    { field: "currency", value: offer.currency },
    // Do not create synthetic evidence for optional fields whose value is unknown.
    ...(offer.total === undefined || offer.total === null
      ? []
      : [{ field: "total", value: offer.total }]),
    ...(offer.shippingFee === undefined || offer.shippingFee === null
      ? []
      : [{ field: "shippingFee", value: offer.shippingFee }]),
    ...(offer.deliveryDate === undefined || offer.deliveryDate === null
      ? []
      : [{ field: "deliveryDate", value: offer.deliveryDate }]),
    ...(offer.returnWindowDays === undefined || offer.returnWindowDays === null
      ? []
      : [{ field: "returnWindowDays", value: offer.returnWindowDays }]),
    { field: "attributes.ramGb", value: ramGb },
    { field: "attributes.brand", value: "Dell" },
    { field: "attributes.condition", value: "refurbished" },
  ];
  offer.evidence = fields.map(({ field, value }) => makeEvidence({
    scenarioId: id, offerId, field, value, now, stale,
  }));

  if (id === "conflicting_evidence") {
    offer.evidence.push(makeEvidence({
      scenarioId: id,
      offerId,
      field: "attributes.ramGb",
      value: 8,
      now,
      stale: false,
      suffix: "-conflict",
    }));
  }

  const scenarioTitles: Record<DemoScenarioId, { title: string; description: string }> = {
    compliant: { title: "Compliant offer", description: "Every hard constraint has matching, fresh, attributable evidence." },
    budget_overrun: { title: "Budget overrun", description: "The merchant's total rises above the user's $900 cap." },
    ram_downgrade: { title: "Product downgrade", description: "The offer changes from 16 GB RAM to 8 GB RAM." },
    delivery_slip: { title: "Delivery deadline slip", description: "The estimated delivery moves beyond the pact deadline." },
    return_policy_downgrade: { title: "Return policy downgrade", description: "The return window shrinks below the required 14 days." },
    stale_evidence: { title: "Expired evidence", description: "The offer values appear compliant, but evidence has expired." },
    conflicting_evidence: { title: "Conflicting evidence", description: "Two fresh evidence records disagree about RAM." },
    currency_mismatch: { title: "Currency mismatch", description: "The offer currency differs from the pact's authorized currency." },
    merchant_instruction: { title: "Untrusted merchant instruction", description: "A simulated security finding must block execution even when commerce constraints pass." },
  };

  return { id, ...scenarioTitles[id], securityClear, ...(securityNote ? { securityNote } : {}), pact, offer };
}

export function isDemoScenarioId(value: unknown): value is DemoScenarioId {
  return typeof value === "string" && (DEMO_SCENARIO_IDS as readonly string[]).includes(value);
}
