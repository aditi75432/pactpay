import { describe, expect, it } from "vitest";
import { decideSettlement, type Evidence, type PurchasePact } from "../src/index.js";
import { evaluatePact, type OfferSnapshot } from "../src/policy.js";

const NOW = "2026-10-19T10:05:00.000Z";
const COLLECTED = "2026-10-19T10:00:00.000Z";
const VALID_UNTIL = "2026-10-19T10:10:00.000Z";

function makePact(): PurchasePact {
  return {
    id: "pact-demo-001",
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
      { id: "ram", kind: "attribute", severity: "hard", description: "RAM must be at least 16 GB.", expected: 16, comparator: "gte", field: "attributes.ramGb" },
      { id: "delivery", kind: "delivery_deadline", severity: "hard", description: "Delivery must be by October 23.", expected: "2026-10-23", comparator: "lte", field: "deliveryDate" },
      { id: "returns", kind: "return_window", severity: "hard", description: "Return window must be at least 14 days.", expected: 14, comparator: "gte", field: "returnWindowDays" },
      { id: "shipping", kind: "shipping_fee", severity: "hard", description: "Shipping must be at most $25.", expected: 25, comparator: "lte", field: "shippingFee" },
      { id: "brand-preference", kind: "attribute", severity: "soft", description: "Prefer Lenovo if available.", expected: "Lenovo", comparator: "contains", field: "attributes.brand" },
    ],
  };
}

function evidenceFor(offerId: string, field: string, value: string | number | boolean): Evidence {
  return {
    id: `e-${field.replace(/[^a-zA-Z0-9]/g, "-")}`,
    source: "PactPay deterministic simulator",
    sourceType: "simulator",
    collectedAt: COLLECTED,
    validUntil: VALID_UNTIL,
    claim: `${field} is ${String(value)}`,
    value,
    field,
    subjectRef: offerId,
    provenanceRef: `sim://offers/${offerId}/${field}`,
  };
}

function makeOffer(overrides: Partial<OfferSnapshot> = {}): OfferSnapshot {
  const base: OfferSnapshot = {
    id: "offer-demo-001",
    currency: "USD",
    total: 849,
    shippingFee: 10,
    deliveryDate: "2026-10-22",
    returnWindowDays: 30,
    attributes: { ramGb: 16, brand: "Dell" },
    evidence: [],
  };
  const offer = { ...base, ...overrides };
  if (!overrides.evidence) {
    offer.evidence = [
      evidenceFor(offer.id, "currency", offer.currency),
      ...(offer.total === undefined || offer.total === null ? [] : [evidenceFor(offer.id, "total", offer.total)]),
      ...(offer.shippingFee === undefined || offer.shippingFee === null ? [] : [evidenceFor(offer.id, "shippingFee", offer.shippingFee)]),
      ...(offer.deliveryDate === undefined || offer.deliveryDate === null ? [] : [evidenceFor(offer.id, "deliveryDate", offer.deliveryDate)]),
      ...(offer.returnWindowDays === undefined || offer.returnWindowDays === null ? [] : [evidenceFor(offer.id, "returnWindowDays", offer.returnWindowDays)]),
      ...Object.entries(offer.attributes).flatMap(([key, value]) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? [evidenceFor(offer.id, `attributes.${key}`, value)]
          : [],
      ),
    ];
  }
  return offer;
}

function evaluate(pact = makePact(), offer = makeOffer(), securityClear = true) {
  return evaluatePact(pact, offer, { securityClear, now: NOW });
}

describe("deterministic pact evaluator", () => {
  it("permits a policy decision when all hard constraints and evidence checks pass", () => {
    const verification = evaluate();
    expect(verification.evidenceFresh).toBe(true);
    expect(verification.evidenceAttributable).toBe(true);
    expect(verification.results.find((result) => result.constraintId === "brand-preference")?.status).toBe("fail");
    expect(decideSettlement(verification)).toEqual({ decision: "capture", reason: "all_preconditions_satisfied" });
  });

  it("blocks an attribute downgrade even when the price remains within budget", () => {
    const offer = makeOffer({ attributes: { ramGb: 8, brand: "Dell" } });
    const verification = evaluate(makePact(), offer);
    expect(verification.results.find((result) => result.constraintId === "ram")?.status).toBe("fail");
    expect(decideSettlement(verification).decision).toBe("block");
  });

  it("blocks a budget overrun", () => {
    const verification = evaluate(makePact(), makeOffer({ total: 901 }));
    expect(verification.results.find((result) => result.constraintId === "budget")?.status).toBe("fail");
    expect(decideSettlement(verification).decision).toBe("block");
  });

  it("enforces maxTotalAmount even when an explicit budget constraint is looser", () => {
    const pact = makePact();
    pact.maxTotalAmount = 800;
    const verification = evaluate(pact, makeOffer({ total: 849 }));
    expect(verification.results.find((result) => result.constraintId === "system.budget_cap")?.status).toBe("fail");
    expect(decideSettlement(verification).decision).toBe("block");
  });

  it("blocks when required hard-constraint evidence has expired", () => {
    const offer = makeOffer();
    offer.evidence = offer.evidence.map((item) => item.field === "attributes.ramGb"
      ? { ...item, validUntil: "2026-10-19T10:04:59.000Z" }
      : item);
    const verification = evaluate(makePact(), offer);
    expect(verification.evidenceFresh).toBe(false);
    expect(decideSettlement(verification)).toEqual({ decision: "block", reason: "evidence_not_fresh" });
  });

  it("blocks if evidence is not bound to the exact offer snapshot", () => {
    const offer = makeOffer();
    offer.evidence = offer.evidence.map((item) => item.field === "attributes.ramGb"
      ? { ...item, subjectRef: "another-offer" }
      : item);
    const verification = evaluate(makePact(), offer);
    expect(verification.evidenceAttributable).toBe(false);
    expect(decideSettlement(verification).decision).toBe("block");
  });

  it("blocks when fresh evidence conflicts with the current snapshot", () => {
    const offer = makeOffer();
    offer.evidence = [...offer.evidence, evidenceFor(offer.id, "attributes.ramGb", 8)];
    const verification = evaluate(makePact(), offer);
    expect(verification.results.find((result) => result.constraintId === "ram")?.status).toBe("unknown");
    expect(decideSettlement(verification).decision).toBe("block");
  });

  it("matches equivalent in-stock spellings without relaxing the availability rule", () => {
    const pact = makePact();
    pact.constraints.push({
      id: "availability",
      kind: "attribute",
      severity: "hard",
      description: "Offer must be in stock.",
      expected: "in_stock",
      comparator: "eq",
      field: "attributes.availability",
    });
    const offer = makeOffer({ attributes: { ramGb: 16, brand: "Dell", availability: "InStock" } });
    const availabilityEvidence = offer.evidence.find((item) => item.field === "attributes.availability");
    if (availabilityEvidence) availabilityEvidence.value = "in stock";
    else offer.evidence.push(evidenceFor(offer.id, "attributes.availability", "in stock"));

    const verification = evaluate(pact, offer);
    expect(verification.results.find((result) => result.constraintId === "availability")?.status).toBe("pass");
    expect(decideSettlement(verification).decision).toBe("capture");
  });

  it("blocks currency mismatch", () => {
    const verification = evaluate(makePact(), makeOffer({ currency: "INR" }));
    expect(verification.results.find((result) => result.constraintId === "system.currency_match")?.status).toBe("fail");
    expect(decideSettlement(verification).decision).toBe("block");
  });

  it("blocks when the caller reports a security failure", () => {
    const verification = evaluate(makePact(), makeOffer(), false);
    expect(decideSettlement(verification)).toEqual({ decision: "block", reason: "security_policy_block" });
  });

  it("blocks when hard constraints are absent, even if a soft preference exists", () => {
    const pact = makePact();
    delete pact.maxTotalAmount;
    pact.constraints = pact.constraints.filter((constraint) => constraint.severity === "soft");
    const verification = evaluate(pact, makeOffer());
    expect(verification.results.find((result) => result.constraintId === "system.no_hard_constraints")?.status).toBe("unknown");
    expect(decideSettlement(verification).decision).toBe("block");
  });

  it("blocks if no constraints were evaluated", () => {
    expect(decideSettlement({
      pactId: "empty",
      verifiedAt: NOW,
      evidenceFresh: true,
      evidenceAttributable: true,
      results: [],
      securityClear: true,
    })).toEqual({ decision: "block", reason: "no_constraints_evaluated" });
  });
});
