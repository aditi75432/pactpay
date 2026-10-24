import { describe, expect, it } from "vitest";
// The analysis lives in scripts/ as plain ESM so the collector tooling needs no build step.
// @ts-ignore: untyped JavaScript module
import { analyzeDrift } from "../../../scripts/lib/drift-analysis.mjs";

const t = (hours: number) => new Date(Date.UTC(2026, 9, 22, 0, 0, 0) + hours * 3_600_000).toISOString();

describe("analyzeDrift", () => {
  const observations = [
    { key: "a|x.com", at: t(0), price: 10, availability: "InStock" }, { key: "a|x.com", at: t(2), price: 10, availability: "InStock" }, { key: "a|x.com", at: t(30), price: 12, availability: "InStock" },
    { key: "b|y.com", at: t(0), price: 20, availability: "InStock" }, { key: "b|y.com", at: t(5), price: 20, availability: "OutOfStock" }, { key: "b|y.com", at: t(10), price: 20, availability: "OutOfStock" },
    { key: "c|z.com", at: t(0), price: 5, availability: "InStock" }, { key: "c|z.com", at: t(40), price: 5, availability: "InStock" },
    { key: "d|w.com", at: t(0), price: 9, availability: "InStock" },
  ];
  it("counts offers, repeats and changes", () => {
    const report = analyzeDrift(observations);
    expect(report.offersTracked).toBe(4);
    expect(report.offersObservedRepeatedly).toBe(3);
    expect(report.offersWithPriceChange).toBe(1);
    expect(report.offersWithAvailabilityChange).toBe(1);
    expect(report.offersWithAnyChange).toBe(2);
    expect(report.shareWithAnyChange).toBeCloseTo(2 / 3);
    expect(report.medianPriceMove).toBeCloseTo(0.2);
    expect(report.windowHours).toBe(40);
  });
  it("measures how soon offers change, only among offers watched that long", () => {
    const byHorizon = analyzeDrift(observations).byHorizon;
    const sixHours = byHorizon.find((row: { hours: number }) => row.hours === 6);
    expect(sixHours).toMatchObject({ eligible: 3, changed: 1 });
    // An offer watched for only 5 hours is excluded from the 6-hour row, so short watches never inflate the result.
    const fiveHourOnly = analyzeDrift([{ key: "q", at: t(0), price: 1, availability: "InStock" }, { key: "q", at: t(5), price: 1, availability: "OutOfStock" }]).byHorizon.find((row: { hours: number }) => row.hours === 6);
    expect(fiveHourOnly).toMatchObject({ eligible: 0, changed: 0, share: null });
    const seventyTwo = byHorizon.find((row: { hours: number }) => row.hours === 72);
    expect(seventyTwo).toMatchObject({ eligible: 0, changed: 0, share: null });
  });
  it("ignores malformed rows and handles empty input", () => {
    const report = analyzeDrift([{ key: "a", at: "not a date", price: 1 }, { key: "a", at: t(0), price: Number.NaN }, null as never]);
    expect(report.offersTracked).toBe(0);
    expect(analyzeDrift([]).shareWithAnyChange).toBe(0);
  });
  it("lists the biggest price moves", () => {
    expect(analyzeDrift(observations).biggestMoves[0]).toMatchObject({ key: "a|x.com", from: 10, to: 12 });
  });
});
