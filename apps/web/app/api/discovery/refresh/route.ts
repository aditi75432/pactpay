import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  compareChannel3OfferRefresh,
  matchRefreshedChannel3Offer,
  normalizeChannel3SearchResponse,
} from "@pactpay/pact-core/channel3";
import {
  getChannel3OfferSnapshot,
  isUuid,
  storeChannel3RefreshCheck,
  type Channel3OfferSnapshotInput,
} from "../../../../../../lib/db";
import { enforceRateLimit } from "../../../../lib/request-guard";
import { requireLogin } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL3_PRODUCT_DETAIL_BASE = "https://api.trychannel3.com/v1/products/";
const EVIDENCE_TTL_MS = 10 * 60_000;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const loginDenied = await requireLogin();
  if (loginDenied) return loginDenied;
  const rateLimited = enforceRateLimit(request, "discovery-refresh", 60, 10 * 60_000);
  if (rateLimited) return rateLimited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const snapshotId = isRecord(body) && typeof body.snapshotId === "string" ? body.snapshotId : "";
  if (!isUuid(snapshotId)) {
    return NextResponse.json({ error: "snapshotId must identify a server-stored Channel3 offer snapshot." }, { status: 400 });
  }

  const apiKey = process.env.CHANNEL3_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Channel3 is not configured. Add CHANNEL3_API_KEY to apps/web/.env.local and restart the server." }, { status: 503 });
  }

  try {
    const previous = await getChannel3OfferSnapshot(snapshotId);
    if (!previous) {
      return NextResponse.json({ error: "Offer snapshot not found. Run a fresh Channel3 search." }, { status: 404 });
    }
    if (!PRODUCT_ID_PATTERN.test(previous.product_id)) {
      console.error("Stored Channel3 product ID failed validation.");
      return NextResponse.json({ error: "Stored product identifier is invalid; run a fresh search." }, { status: 409 });
    }

    let response: Response;
    try {
      response = await fetch(`${CHANNEL3_PRODUCT_DETAIL_BASE}${encodeURIComponent(previous.product_id)}`, {
        method: "GET",
        headers: { "x-api-key": apiKey, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return NextResponse.json({ error: timeout ? "Channel3 product refresh timed out. Please retry." : "Channel3 could not be reached for a product refresh." }, { status: timeout ? 504 : 502 });
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return NextResponse.json({ error: "Channel3 rejected the API key. Check CHANNEL3_API_KEY." }, { status: 502 });
      }
      if (response.status === 404) {
        return NextResponse.json({ error: "Channel3 no longer has this product ID. Run a fresh product search." }, { status: 409 });
      }
      if (response.status === 429) {
        return NextResponse.json({ error: "Channel3 rate limit or search quota reached. Wait or check your Channel3 usage." }, { status: 429 });
      }
      console.error("Channel3 product detail returned HTTP status", response.status);
      return NextResponse.json({ error: `Channel3 product refresh failed with HTTP ${response.status}.` }, { status: 502 });
    }

    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      return NextResponse.json({ error: "Channel3 product detail returned invalid JSON." }, { status: 502 });
    }
    if (!isRecord(detail) || detail.id !== previous.product_id) {
      return NextResponse.json({ error: "Channel3 product detail did not match the stored product ID. No refreshed evidence was saved." }, { status: 502 });
    }

    let candidates: ReturnType<typeof normalizeChannel3SearchResponse>;
    try {
      candidates = normalizeChannel3SearchResponse({ products: [detail] });
    } catch (error) {
      console.error("Channel3 product detail schema was not recognized", error instanceof Error ? error.message : "unknown error");
      return NextResponse.json({ error: "Channel3 product detail had an unexpected format. No refreshed evidence was saved." }, { status: 502 });
    }

    const priorIdentity = {
      productId: previous.product_id,
      offerDomain: previous.offer_domain,
      offerUrl: previous.offer_url,
    };
    const matched = matchRefreshedChannel3Offer(priorIdentity, candidates);
    const oldNormalized = {
      productId: previous.product_id,
      productTitle: previous.product_title,
      offerDomain: previous.offer_domain,
      offerUrl: previous.offer_url,
      price: Number(previous.price),
      currency: previous.currency.trim(),
      availability: previous.availability,
      condition: previous.condition,
      ramGb: previous.ram_gb === null ? null : Number(previous.ram_gb),
    };
    const comparison = compareChannel3OfferRefresh(oldNormalized, matched);
    const observedAt = new Date();
    const observedAtIso = observedAt.toISOString();
    const checkId = randomUUID();
    const refreshedSnapshotId = matched ? randomUUID() : null;
    const validUntil = new Date(observedAt.getTime() + EVIDENCE_TTL_MS).toISOString();

    const refreshedSnapshot: Channel3OfferSnapshotInput | null = matched && refreshedSnapshotId ? {
      id: refreshedSnapshotId,
      searchQuery: previous.search_query,
      productId: matched.productId,
      productTitle: matched.productTitle,
      description: matched.description,
      brand: matched.brand,
      imageUrl: matched.imageUrl,
      offerDomain: matched.offerDomain,
      offerUrl: matched.offerUrl,
      price: matched.price,
      currency: matched.currency,
      availability: matched.availability,
      condition: matched.condition,
      ramGb: matched.ramGb,
      structuredAttributes: matched.structuredAttributes,
      rawProduct: matched.rawProduct,
      rawOffer: matched.rawOffer,
      fetchedAt: observedAtIso,
      validUntil,
    } : null;

    await storeChannel3RefreshCheck({
      id: checkId,
      previousSnapshotId: previous.id,
      refreshedSnapshot,
      productId: previous.product_id,
      offerDomain: previous.offer_domain,
      status: matched ? "MATCHED" : "OFFER_NOT_FOUND",
      previousPrice: Number(previous.price),
      previousCurrency: previous.currency.trim(),
      currentPrice: matched?.price ?? null,
      currentCurrency: matched?.currency ?? null,
      changedFields: comparison.changedFields,
      comparison: comparison as unknown as Record<string, unknown>,
      fetchedAt: observedAtIso,
    });

    if (!matched || !refreshedSnapshot) {
      return NextResponse.json({
        checkId,
        status: "OFFER_NOT_FOUND",
        previousSnapshotId: previous.id,
        changedFields: comparison.changedFields,
        productId: previous.product_id,
        offerDomain: previous.offer_domain,
        observedAt: observedAtIso,
        comparison,
        refreshedOffer: null,
        note: "Channel3 returned product details, but PactPay could not uniquely match the same merchant offer. The original immutable snapshot was not changed. Run a fresh search rather than substituting a different offer.",
        fulfillmentTermsVerified: false,
        paymentAction: "NONE",
        capturePerformedByPactPay: false,
      });
    }

    return NextResponse.json({
      checkId,
      status: comparison.changedFields.length > 0 ? "MATCHED_WITH_CHANGES" : "MATCHED_UNCHANGED",
      previousSnapshotId: previous.id,
      observedAt: observedAtIso,
      comparison,
      refreshedOffer: {
        snapshotId: refreshedSnapshot.id,
        productId: matched.productId,
        productTitle: matched.productTitle,
        description: matched.description,
        brand: matched.brand,
        imageUrl: matched.imageUrl,
        offerDomain: matched.offerDomain,
        offerUrl: matched.offerUrl,
        price: matched.price,
        currency: matched.currency,
        availability: matched.availability,
        condition: matched.condition,
        ramGb: matched.ramGb,
        structuredAttributes: matched.structuredAttributes,
        fetchedAt: observedAtIso,
        validUntil,
      },
      changedFields: comparison.changedFields,
      fulfillmentTermsVerified: false,
      paymentAction: "NONE",
      capturePerformedByPactPay: false,
      note: "This is a fresh Channel3 product-detail observation for the matched product and merchant. It refreshes catalog facts only. It does not verify landed checkout total, shipping, delivery date, return policy, or merchant fulfillment claims.",
    });
  } catch (error) {
    console.error("Channel3 offer refresh failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Offer refresh could not be saved. No refreshed snapshot was returned." }, { status: 500 });
  }
}
