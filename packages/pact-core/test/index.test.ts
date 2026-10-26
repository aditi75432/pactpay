import { describe, expect, it } from "vitest";
import { decideSettlement, type VerificationResult } from "../src/index.js";

const base = (): VerificationResult => ({
  pactId: "pact_demo",
  verifiedAt: new Date().toISOString(),
  evidenceFresh: true,
  evidenceAttributable: true,
  securityClear: true,
  results: [
    { constraintId: "budget", status: "pass", actual: 849, evidenceIds: ["e1"], reason: "Within limit" },
    { constraintId: "ram", status: "pass", actual: 16, evidenceIds: ["e2"], reason: "Minimum met" },
    { constraintId: "delivery", status: "pass", actual: "2026-10-08", evidenceIds: ["e3"], reason: "Deadline met" },
  ],
});

describe("settlement gate", () => {
  it("permits capture when all preconditions pass", () => {
    expect(decideSettlement(base())).toEqual({ decision: "capture", reason: "all_preconditions_satisfied" });
  });

  it("blocks stale evidence", () => {
    expect(decideSettlement({ ...base(), evidenceFresh: false })).toEqual({
      decision: "block",
      reason: "evidence_not_fresh",
    });
  });

  it("blocks failed hard constraints", () => {
    const result = decideSettlement({
      ...base(),
      results: base().results.map((r) => r.constraintId === "ram" ? { ...r, status: "fail" } : r),
    });
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("ram");
  });

  it("blocks security failures before constraint evaluation", () => {
    expect(decideSettlement({ ...base(), securityClear: false })).toEqual({
      decision: "block",
      reason: "security_policy_block",
    });
  });
});
