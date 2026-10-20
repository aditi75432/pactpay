import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeChannel3SearchResponse } from "@pactpay/pact-core/channel3";
import { storeChannel3OfferSnapshots } from "../../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL3_SEARCH_URL = "https://api.trychannel3.com/v1/search";
const MAX_QUERY_LENGTH = 180;
const MAX_RESULTS = 12;
const EVIDENCE_TTL_MS = 10 * 60_000;

export async function POST(request: Request) {
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

  let channel3Payload: unknown;
  try {
    const response = await fetch(CHANNEL3_SEARCH_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, limit: MAX_RESULTS }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return NextResponse.json({ error: "Channel3 rejected the API key. Check the server-side CHANNEL3_API_KEY setting." }, { status: 502 });
      }
      if (response.status === 429) {
        return NextResponse.json({ error: "Channel3 rate limit or search quota reached. Wait or check your Channel3 usage." }, { status: 429 });
      }
      console.error("Channel3 search returned HTTP status", response.status);
      return NextResponse.json({ error: `Channel3 search failed with HTTP ${response.status}.` }, { status: 502 });
    }
    channel3Payload = await response.json();
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error("Channel3 search request failed", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: isTimeout ? "Channel3 search timed out. Please retry." : "Channel3 could not be reached. Please retry." }, { status: isTimeout ? 504 : 502 });
  }

  let offers;
  try {
    offers = normalizeChannel3SearchResponse(channel3Payload);
  } catch (error) {
    console.error("Channel3 response schema was not recognized", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Channel3 returned an unexpected response format. No results were evaluated." }, { status: 502 });
  }

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
    source: "CHANNEL3_LIVE_SEARCH",
    fetchedAt: fetchedAt.toISOString(),
    freshnessWindowSeconds: EVIDENCE_TTL_MS / 1000,
    offers: snapshots.map(({ rawProduct: _rawProduct, rawOffer: _rawOffer, structuredAttributes, ...offer }) => ({
      ...offer,
      structuredAttributes,
    })),
    note: "These are live catalog offer observations. The 60-second TTL is PactPay's local freshness policy, not a claim about the merchant's own update timestamp. Item price is not the landed total.",
  });
}
