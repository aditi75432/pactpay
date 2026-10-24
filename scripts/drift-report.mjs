#!/usr/bin/env node
/** Turns drift-watch observations into a short, honest report. Usage: node scripts/drift-report.mjs [file] */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { analyzeDrift } from "./lib/drift-analysis.mjs";

const file = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "data/drift-observations.jsonl";
if (!existsSync(file)) { console.error(`No observations at ${file}. Run: node scripts/drift-watch.mjs`); process.exit(2); }
const observations = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
const report = analyzeDrift(observations);
const pct = (value) => (value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`);

const lines = [
  "# Offer drift measured from the live catalog",
  "",
  `Collected by PactPay's drift watcher: ${report.observations} observations of ${report.offersTracked} offers over ${report.windowHours.toFixed(1)} hours.`,
  "An offer is one product at one merchant. Drift is a change in item price or availability as reported by the live catalog (Channel3).",
  "",
  "| Measure | Result |", "|---|---|",
  `| Offers observed more than once | ${report.offersObservedRepeatedly} |`,
  `| ...with any price or availability change | ${report.offersWithAnyChange} (${pct(report.shareWithAnyChange)}) |`,
  `| ...with a price change | ${report.offersWithPriceChange} |`,
  `| ...with an availability change | ${report.offersWithAvailabilityChange} |`,
  `| Median size of a price move | ${pct(report.medianPriceMove)} |`,
  "",
  "## How soon offers change",
  "",
  "| Watched at least | Offers | Changed within that time | Share |", "|---|---|---|---|",
  ...report.byHorizon.map((row) => `| ${row.hours} h | ${row.eligible} | ${row.changed} | ${pct(row.share)} |`),
  "",
  ...(report.biggestMoves.length ? ["## Largest price moves", "", ...report.biggestMoves.map((move) => `- ${move.key}: $${move.from.toFixed(2)} to $${move.to.toFixed(2)} (${pct(move.relativeMove)})`), ""] : []),
  "## Limits of this measurement",
  "",
  "- It measures what the catalog reports, not what a retailer's checkout charges.",
  "- A short collection window and a small query set mean the percentages are indicative, not general.",
  "- Catalog refresh timing is up to the catalog provider; some changes may be late or missed.",
  "",
];
mkdirSync("docs", { recursive: true });
writeFileSync("docs/DRIFT-REPORT.md", lines.join("\n"));
console.log(lines.join("\n"));
console.log("\nWrote docs/DRIFT-REPORT.md");
