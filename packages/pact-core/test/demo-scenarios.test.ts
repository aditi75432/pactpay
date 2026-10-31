import { describe, expect, it } from "vitest";
import { evaluatePact, summarizeVerification } from "../src/policy.js";
import { createDemoScenario, DEMO_SCENARIO_IDS } from "../src/demo-scenarios.js";

const NOW = new Date("2026-10-19T10:05:00.000Z");

function run(id: (typeof DEMO_SCENARIO_IDS)[number]) {
  const scenario = createDemoScenario(id, NOW);
  const verification = evaluatePact(scenario.pact, scenario.offer, { securityClear: scenario.securityClear, now: NOW });
  return { scenario, verification, summary: summarizeVerification(verification) };
}

describe("Policy Lab scenario fixtures", () => {
  it("allows the compliant fixture at the policy level without executing payment", () => {
    const { summary, verification } = run("compliant");
    expect(summary.decision).toBe("capture");
    expect(verification.evidenceFresh).toBe(true);
    expect(verification.evidenceAttributable).toBe(true);
    expect(summary.softFailures).toBe(1); // brand preference is soft, not a blocker
  });

  it.each([
    "budget_overrun",
    "ram_downgrade",
    "delivery_slip",
    "return_policy_downgrade",
    "stale_evidence",
    "conflicting_evidence",
    "currency_mismatch",
    "merchant_instruction",
  ] as const)("blocks %s", (id) => {
    expect(run(id).summary.decision).toBe("block");
  });

  it("marks a failed security fixture as a security-policy block", () => {
    expect(run("merchant_instruction").summary.reason).toBe("security_policy_block");
  });

  it("binds every simulated evidence record to the exact offer snapshot", () => {
    const { scenario } = run("compliant");
    expect(scenario.offer.evidence.every((item) => item.subjectRef === scenario.offer.id)).toBe(true);
  });
});
