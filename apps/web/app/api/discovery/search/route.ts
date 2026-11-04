import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { buildChannel3SearchQueries, normalizeChannel3SearchResponse } from "@pactpay/pact-core/channel3";
import { storeChannel3OfferSnapshots } from "../../../../../../lib/db";
import { enforceRateLimit } from "../../../../lib/request-guard";
import { requireLogin } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL3_SEARCH_URL = "https://api.trychannel3.com/v1/search";
const MAX_QUERY_LENGTH = 180;
const MAX_RESULTS = 30;
const EVIDENCE_TTL_MS = 10 * 60_000;

export async function POST(request: Request) {
  const loginDenied = await requireLogin();
  if (loginDenied) return loginDenied;
  const rateLimited = enforceRateLimit(request, "discovery-search", 40, 10 * 60_000);
  if (rateLimited) return rateLimited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const queryValue = (body as { query?: unknown } | null)?.query;
  const query = typeof queryValue === "string" ? queryValue.trim() : "";
  if (!query || query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: `query is required and must be ${MAX_QUERY_LENGTH} characters or fewer.` }, { status: 400 });
  }

  const apiKey = process.env.CHANNEL3_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Channel3 is not configured. Add CHANNEL3_API_KEY to apps/web/.env.local and restart the server." }, { status: 503 });
  }

  // Preserve the complete buyer brief for Channel3's agentic planner, then run
  // product-focused lexical/semantic variants for recall. These are retrieval
  // strategies only; all results still face the unchanged approved Purchase Pact.
  const productQueries = buildChannel3SearchQueries(query);
  const searchPlans = [
    { query, mode: "agentic" as const },
    ...productQueries.map((value) => ({ query: value, mode: "default" as const })),
  ].filter((item, index, all) => all.findIndex((other) => other.query.toLowerCase() === item.query.toLowerCase()) === index).slice(0, 4);
  if (searchPlans.length === 0) return NextResponse.json({ error: "Enter a product name or useful search phrase." }, { status: 400 });

  const apiResults = await Promise.all(searchPlans.map(async (plan) => {
    const searchQuery = plan.query;
    try {
      const response = await fetch(CHANNEL3_SEARCH_URL, {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, limit: MAX_RESULTS, ...(plan.mode === "agentic" ? { config: { mode: "agentic" } } : {}) }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return { query: searchQuery, status: response.status, payload: null as unknown };
      return { query: searchQuery, status: response.status, payload: await response.json() as unknown };
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return { query: searchQuery, status: timeout ? 504 : 502, payload: null as unknown };
    }
  }));

  const successful = apiResults.filter((result) => result.status >= 200 && result.status < 300 && result.payload !== null);
  if (successful.length === 0) {
    const failedStatus = apiResults.find((result) => result.status === 401 || result.status === 403)?.status
      ?? apiResults.find((result) => result.status === 429)?.status
      ?? apiResults.find((result) => result.status === 504)?.status
      ?? 502;
    const message = failedStatus === 401 || failedStatus === 403
      ? "Channel3 rejected the API key. Check the server-side CHANNEL3_API_KEY setting."
      : failedStatus === 429
        ? "Channel3 rate limit or search quota reached. Wait or check your Channel3 usage."
        : failedStatus === 504
          ? "Channel3 search timed out. Please retry."
          : "Channel3 could not be reached or returned no usable response. Please retry.";
    console.error("All Channel3 search variants failed", apiResults.map((result) => result.status));
    return NextResponse.json({ error: message }, { status: failedStatus });
  }

  const uniqueOffers = new Map<string, ReturnType<typeof normalizeChannel3SearchResponse>[number]>();
  const validQueries: string[] = [];
  for (const result of successful) {
    try {
      const normalized = normalizeChannel3SearchResponse(result.payload);
      validQueries.push(result.query);
      for (const offer of normalized) {
        let path = offer.offerUrl;
        try { const url = new URL(offer.offerUrl); path = `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`; } catch { /* normalized URLs are already HTTPS */ }
        const key = `${offer.productId}|${offer.offerDomain.toLowerCase()}|${path}`;
        if (!uniqueOffers.has(key)) uniqueOffers.set(key, offer);
      }
    } catch (error) {
      console.error("Channel3 search variant had an unrecognized response", result.query, error instanceof Error ? error.message : "unknown error");
    }
  }
  if (validQueries.length === 0) {
    return NextResponse.json({ error: "Channel3 returned an unexpected response format. No results were evaluated." }, { status: 502 });
  }
  // Keep a broad candidate set for deterministic filtering. The shortlist stage,
  // not the retrieval query, decides which products satisfy the user's rules.
  const offers = [...uniqueOffers.values()].slice(0, MAX_RESULTS * validQueries.length);

  const fetchedAt = new Date();
  const validUntil = new Date(fetchedAt.getTime() + EVIDENCE_TTL_MS);
  const snapshots = offers.map((offer) => ({
    ...offer,
    snapshotId: randomUUID(),
    searchQuery: query,
    fetchedAt: fetchedAt.toISOString(),
    validUntil: validUntil.toISOString(),
  }));

  try {
    await storeChannel3OfferSnapshots(snapshots.map((row) => ({
      id: row.snapshotId,
      searchQuery: row.searchQuery,
      productId: row.productId,
      productTitle: row.productTitle,
      description: row.description,
      brand: row.brand,
      imageUrl: row.imageUrl,
      offerDomain: row.offerDomain,
      offerUrl: row.offerUrl,
      price: row.price,
      currency: row.currency,
      availability: row.availability,
      condition: row.condition,
      ramGb: row.ramGb,
      structuredAttributes: row.structuredAttributes,
      rawProduct: row.rawProduct,
      rawOffer: row.rawOffer,
      fetchedAt: row.fetchedAt,
      validUntil: row.validUntil,
    })));
  } catch (error) {
    console.error("Failed to persist Channel3 offer snapshots", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Offers were retrieved but could not be saved as verifiable snapshots. Please retry." }, { status: 500 });
  }

  return NextResponse.json({
    query,
    searchQueries: validQueries,
    source: "CHANNEL3_LIVE_SEARCH",
    searchModes: searchPlans.map((plan) => ({ query: plan.query, mode: plan.mode })),
    fetchedAt: fetchedAt.toISOString(),
    freshnessWindowSeconds: EVIDENCE_TTL_MS / 1000,
    offers: snapshots.map(({ rawProduct: _rawProduct, rawOffer: _rawOffer, structuredAttributes, ...offer }) => ({
      ...offer,
      structuredAttributes,
    })),
    note: "These are live catalog offer observations. The 10-minute TTL is PactPay's local freshness policy, not a claim about the merchant's own update timestamp. Item price is not the landed total. Search variants only improve product discovery; every offer is evaluated against the unchanged approved Purchase Pact.",
  });
}
