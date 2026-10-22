import { describe, expect, it } from "vitest";
import { DEFAULT_AUTONOMY, decideSettlement, describeAutonomy, parseAutonomy, shouldAutoHold } from "../src/autonomy";

describe("parseAutonomy", () => {
  it("falls back to the safest mode for anything malformed", () => {
    for (const bad of [null, undefined, 5, "WITHIN_RULES", {}, { mode: "YOLO" }, { mode: "ASK_ABOVE" }, { mode: "ASK_ABOVE", limitUsd: -4 }, { mode: "ASK_ABOVE", limitUsd: "abc" }, { mode: "ASK_ABOVE", limitUsd: 1e9 }]) {
      expect(parseAutonomy(bad)).toEqual(DEFAULT_AUTONOMY);
    }
  });
  it("accepts valid modes and rounds the limit to cents", () => {
    expect(parseAutonomy({ mode: "WITHIN_RULES", limitUsd: 5 })).toEqual({ mode: "WITHIN_RULES", limitUsd: null });
    expect(parseAutonomy({ mode: "ASK_ABOVE", limitUsd: "25.456" })).toEqual({ mode: "ASK_ABOVE", limitUsd: 25.46 });
  });
});

describe("decideSettlement", () => {
  it("always allows a human release", () => {
    expect(decideSettlement(DEFAULT_AUTONOMY, 500, "user").allowed).toBe(true);
  });
  it("never lets the agent settle under Ask every time", () => {
    const decision = decideSettlement(DEFAULT_AUTONOMY, 1, "agent");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/only you/);
  });
  it("lets the agent settle up to the limit and no further under Ask above", () => {
    const autonomy = { mode: "ASK_ABOVE" as const, limitUsd: 25 };
    expect(decideSettlement(autonomy, 21.58, "agent").allowed).toBe(true);
    expect(decideSettlement(autonomy, 25, "agent").allowed).toBe(true);
    expect(decideSettlement(autonomy, 25.01, "agent")).toMatchObject({ allowed: false });
  });
  it("lets the agent act within rules, but never on an invalid amount", () => {
    const autonomy = { mode: "WITHIN_RULES" as const, limitUsd: null };
    expect(decideSettlement(autonomy, 80, "agent").allowed).toBe(true);
    expect(decideSettlement(autonomy, Number.NaN, "agent").allowed).toBe(false);
    expect(decideSettlement(autonomy, 0, "agent").allowed).toBe(false);
  });
});

describe("shouldAutoHold and describeAutonomy", () => {
  it("auto-holds only when the agent would also be allowed to settle", () => {
    expect(shouldAutoHold(DEFAULT_AUTONOMY, 10)).toBe(false);
    expect(shouldAutoHold({ mode: "ASK_ABOVE", limitUsd: 30 }, 21.58)).toBe(true);
    expect(shouldAutoHold({ mode: "ASK_ABOVE", limitUsd: 20 }, 21.58)).toBe(false);
    expect(shouldAutoHold({ mode: "WITHIN_RULES", limitUsd: null }, 999)).toBe(true);
  });
  it("describes each mode in plain English", () => {
    expect(describeAutonomy({ mode: "ASK_ABOVE", limitUsd: 30 }).title).toBe("Ask me above $30.00");
    expect(describeAutonomy({ mode: "WITHIN_RULES", limitUsd: null }).detail).toMatch(/same gate/);
  });
});
