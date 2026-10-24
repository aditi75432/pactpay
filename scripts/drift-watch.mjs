#!/usr/bin/env node
/**
 * Offer drift collector. Repeatedly searches the live catalog through PactPay's own search route (which calls
 * Channel3) and appends one line per offer to a JSONL file. Run it for days, then run drift-report.mjs.
 *
 *   node scripts/drift-watch.mjs --url http://localhost:3000 --every 30 --queries "wireless mouse,usb c charger"
 *
 * Options: --url, --every <minutes, default 30>, --queries "a,b,c", --out <file>, --once
 * This measures CATALOG drift (what the live product catalog reports). It is not checkout drift.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function arg(name, fallback) { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : fallback; }
const BASE = String(arg("url", "http://localhost:3000")).replace(/\/$/, "");
const EVERY_MINUTES = Math.max(5, Number(arg("every", "30")) || 30);
const OUT = String(arg("out", "data/drift-observations.jsonl"));
const QUERIES = String(arg("queries", "wireless mouse,usb c charger,wireless headphones,laptop stand,mechanical keyboard,webcam")).split(",").map((item) => item.trim()).filter(Boolean);
const ONCE = process.argv.includes("--once");
mkdirSync(dirname(OUT), { recursive: true });

const keyOf = (productId, domain) => `${String(productId).trim()}|${String(domain).trim().toLowerCase().replace(/^www\./, "")}`.toLowerCase();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function once() {
  let written = 0;
  for (const query of QUERIES) {
    try {
      const response = await fetch(`${BASE}/api/discovery/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
      if (response.status === 429) { console.log(`  rate limited on "${query}", waiting 60s`); await sleep(60_000); continue; }
      const payload = await response.json();
      if (!response.ok) { console.log(`  "${query}": ${payload.error ?? response.status}`); continue; }
      const at = typeof payload.fetchedAt === "string" ? payload.fetchedAt : new Date().toISOString();
      for (const offer of Array.isArray(payload.offers) ? payload.offers : []) {
        if (typeof offer.price !== "number") continue;
        appendFileSync(OUT, `${JSON.stringify({ at, query, key: keyOf(offer.productId, offer.offerDomain), price: offer.price, currency: offer.currency, availability: offer.availability ?? null })}\n`);
        written += 1;
      }
    } catch (error) { console.log(`  "${query}": ${error instanceof Error ? error.message : "failed"}`); }
    await sleep(2_000);
  }
  console.log(`${new Date().toISOString()}  wrote ${written} observations to ${OUT}`);
}

console.log(`Watching ${QUERIES.length} queries every ${EVERY_MINUTES} min via ${BASE}. Ctrl+C to stop.`);
do { await once(); if (ONCE) break; await sleep(EVERY_MINUTES * 60_000); } while (true);
