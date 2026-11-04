/** Typed, defensive normalization for the Channel3 Search API response. */
export interface Channel3NormalizedOffer {
  productId: string;
  productTitle: string;
  description: string | null;
  brand: string | null;
  imageUrl: string | null;
  offerDomain: string;
  offerUrl: string;
  price: number;
  currency: string;
  availability: string | null;
  condition: string | null;
  ramGb: number | null;
  structuredAttributes: Record<string, unknown>;
  rawProduct: Record<string, unknown>;
  rawOffer: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const QUERY_FILLER = new Set([
  "find", "show", "search", "looking", "look", "for", "me", "my", "i", "want", "need", "buy", "get", "please", "can", "you", "could", "would", "like", "to",
  "a", "an", "the", "best", "option", "options", "product", "products", "item", "items", "with", "and", "or", "that", "has", "have",
  "under", "below", "less", "than", "at", "most", "up", "to", "budget", "maximum", "max", "price", "priced",
  "cost", "costs", "dollar", "dollars", "rupee", "rupees", "usd", "inr", "eur", "gbp", "only", "within",
]);

/**
 * Build product-focused Channel3 query variants. These affect retrieval only; the approved Purchase Pact is never
 * changed. The third, broader variant drops standalone capacity/dimension descriptors but preserves model numbers
 * such as WH-1000XM5, S24, M3 and product-generation names.
 */
export function buildChannel3SearchQueries(input: string): string[] {
  const original = input.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!original) return [];
  let productQuery = original
    .replace(/\b(?:under|below|less than|at most|no more than|up to|within|budget(?: of)?|maximum(?: budget)?|price limit(?: of)?)\s*[$€£₹]?\s*\d[\d,]*(?:\.\d+)?\s*(?:usd|eur|gbp|inr|rupees?|dollars?)?\b/gi, " ")
    .replace(/[$€£₹]\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:usd|eur|gbp|inr))?/gi, " ")
    .replace(/\b\d[\d,]*(?:\.\d+)?\s*(?:usd|eur|gbp|inr|rupees?|dollars?)\b/gi, " ")
    .replace(/^\s*(?:please\s+)?(?:can you\s+)?(?:find|search for|look for|show me|buy|get)\s+/i, "")
    .replace(/^\s*(?:i want|i need|i am looking for|i'm looking for|i would like)\s+(?:to buy\s+)?/i, "")
    .replace(/^\s*(?:a|an|the)\s+/i, "")
    .replace(/\b(?:prefer|preferred brand)\s+/gi, " ")
    .replace(/[,:;]+/g, " ").replace(/\s+/g, " ").trim();
  if (!productQuery) productQuery = original;

  const variants = [productQuery];
  const tokens = productQuery.match(/[a-z0-9]+(?:[.-][a-z0-9]+)*/gi) ?? [];
  const compact = tokens.filter((token) => !QUERY_FILLER.has(token.toLowerCase())).join(" ").trim();
  if (compact && compact.toLowerCase() !== productQuery.toLowerCase() && compact.length >= 2) variants.push(compact);

  // Broader retrieval is allowed; policy evaluation still uses every original hard rule.
  // Keep model identifiers while omitting separate capacity/dimension values that often over-constrain catalog search.
  const broad = compact
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:gb|gib|tb|tib|inch(?:es)?|inches|cm|mm|watts?|w|mah|hz|mp)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  if (broad.length >= 3 && broad.toLowerCase() !== compact.toLowerCase()) variants.push(broad);

  return [...new Map(variants.filter((value) => value.length >= 2 && value.length <= 180).map((value) => [value.toLowerCase(), value])).values()].slice(0, 3);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function safeHttpsUrl(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeAvailability(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/[\s_-]+/g, "");
  if (["instock", "available", "limitedavailability", "lowstock", "limitedstock", "fewleft"].includes(normalized)) return "InStock";
  if (["outofstock", "unavailable", "soldout", "discontinued"].includes(normalized)) return "OutOfStock";
  return text;
}

function normalizeCondition(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/[\s_-]+/g, "");
  if (["new", "brandnew"].includes(normalized)) return "new";
  if (["used", "preowned", "preownedused"].includes(normalized)) return "used";
  if (["refurbished", "manufacturerrefurbished", "sellerrefurbished"].includes(normalized)) return "refurbished";
  return text;
}

function attributeValue(attributes: Record<string, unknown>, patterns: RegExp[]): unknown {
  for (const [key, value] of Object.entries(attributes)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (patterns.some((pattern) => pattern.test(normalized))) return value;
  }
  return null;
}

function attributeText(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return cleanString(String(value));
  if (!isRecord(value)) return null;
  for (const key of ["value", "name", "label", "text", "display_value"]) {
    const text = cleanString(value[key]);
    if (text) return text;
  }
  return null;
}

/** Read RAM only from structured catalog attributes; deliberately never infer it from title/description. */
export function extractRamGb(attributes: Record<string, unknown>): number | null {
  const entries = Object.entries(attributes);
  for (const [key, rawValue] of entries) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!/(^ram|ramgb|memory|systemmemory)/.test(normalizedKey)) continue;
    if (/(storage|ssd|disk|flash|vram|graphics)/.test(normalizedKey)) continue;
    if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0 && rawValue <= 512) {
      return rawValue;
    }
    if (typeof rawValue !== "string") continue;
    const text = rawValue.trim();
    const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*(GB|GIB|MB|MIB)?$/i);
    if (!match) continue;
    const amount = Number(match[1]);
    const unit = (match[2] ?? "GB").toUpperCase();
    const gb = unit === "MB" || unit === "MIB" ? amount / 1024 : amount;
    if (Number.isFinite(gb) && gb > 0 && gb <= 512) return gb;
  }
  return null;
}

function readImageUrl(product: Record<string, unknown>, attributes: Record<string, unknown>): string | null {
  const images = Array.isArray(product.images) ? product.images : [];
  const imageObjects = images.filter(isRecord);
  const main = imageObjects.find((image) => image.is_main_image === true) ?? imageObjects[0];
  const candidates: unknown[] = [
    main?.cleaned_url, main?.url,
    product.image_url, product.primary_image_url, product.thumbnail_url,
    isRecord(product.primary_image) ? product.primary_image.cleaned_url ?? product.primary_image.url : product.primary_image,
    attributeValue(attributes, [/^image$/, /^imageurl$/, /^productimage$/, /^thumbnailurl$/]),
    ...images.filter((image) => typeof image === "string"),
  ];
  for (const candidate of candidates) {
    const direct = safeHttpsUrl(candidate);
    if (direct) return direct;
    const nested = attributeText(candidate);
    const nestedUrl = safeHttpsUrl(nested);
    if (nestedUrl) return nestedUrl;
  }
  return null;
}

function readBrand(product: Record<string, unknown>, attributes: Record<string, unknown>): string | null {
  const brands = Array.isArray(product.brands) ? product.brands : [];
  for (const value of brands) {
    if (isRecord(value)) {
      const name = cleanString(value.name);
      if (name) return name;
    } else {
      const name = cleanString(value);
      if (name) return name;
    }
  }
  return cleanString(product.brand) ?? attributeText(attributeValue(attributes, [/^brand$/, /^manufacturer$/, /^brandname$/]));
}

/**
 * Channel3 documents `products[]`, with `offers[]` per canonical product;
 * price is an object containing amount and ISO currency. Invalid or unsafe
 * buy URLs are dropped rather than rendered as links.
 */
export function normalizeChannel3SearchResponse(payload: unknown): Channel3NormalizedOffer[] {
  if (!isRecord(payload)) throw new Error("Channel3 response must be a JSON object.");
  const productsValue = payload.products;
  if (!Array.isArray(productsValue)) throw new Error("Channel3 response did not contain a products array.");

  const normalized: Channel3NormalizedOffer[] = [];
  for (const candidate of productsValue) {
    if (!isRecord(candidate)) continue;
    const productId = cleanString(candidate.id);
    const productTitle = cleanString(candidate.title);
    if (!productId || !productTitle) continue;
    const rawProduct = candidate;
    const attributes = isRecord(candidate.structured_attributes) ? candidate.structured_attributes : {};
    const offers = Array.isArray(candidate.offers) ? candidate.offers : [];

    for (const offerCandidate of offers) {
      if (!isRecord(offerCandidate)) continue;
      const rawOffer = offerCandidate;
      const offerUrl = safeHttpsUrl(offerCandidate.url);
      const givenDomain = cleanString(offerCandidate.domain);
      const price = isRecord(offerCandidate.price) ? offerCandidate.price : {};
      const amount = finiteNumber(price.amount) ?? finiteNumber(price.price);
      const currencyRaw = cleanString(price.currency)?.toUpperCase() ?? "";
      if (!offerUrl || amount === null || amount < 0 || !/^[A-Z]{3}$/.test(currencyRaw)) continue;

      let offerDomain = givenDomain;
      if (!offerDomain) {
        try { offerDomain = new URL(offerUrl).hostname; } catch { offerDomain = null; }
      }
      if (!offerDomain) continue;

      normalized.push({
        productId,
        productTitle,
        description: cleanString(candidate.description),
        brand: readBrand(candidate, attributes),
        imageUrl: readImageUrl(candidate, attributes),
        offerDomain,
        offerUrl,
        price: amount,
        currency: currencyRaw,
        availability: normalizeAvailability(offerCandidate.availability ?? attributeText(attributeValue(attributes, [/^availability$/, /^stockstatus$/, /^inventorystatus$/, /^instock$/]))),
        condition: normalizeCondition(offerCandidate.condition ?? attributeText(attributeValue(attributes, [/^condition$/, /^itemcondition$/, /^productcondition$/]))),
        ramGb: extractRamGb(attributes),
        structuredAttributes: attributes,
        rawProduct,
        rawOffer,
      });
    }
  }
  return normalized.slice(0, 60);
}


export interface Channel3OfferIdentity {
  productId: string;
  offerDomain: string;
  offerUrl: string;
}

export interface Channel3OfferRefreshComparison {
  sameProduct: boolean;
  sameMerchant: boolean;
  matchedOffer: boolean;
  changedFields: string[];
  previous: {
    title: string;
    price: number;
    currency: string;
    availability: string | null;
    condition: string | null;
    ramGb: number | null;
  };
  current: {
    title: string;
    price: number;
    currency: string;
    availability: string | null;
    condition: string | null;
    ramGb: number | null;
  } | null;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

/**
 * A Channel3 buy URL may carry regenerated tracking query parameters. For
 * identity checks compare its origin and pathname, never query parameters.
 */
function canonicalOfferPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.hostname.toLowerCase()}${pathname}`;
  } catch {
    return null;
  }
}

/**
 * Match only a product+merchant offer. Prefer a stable canonical URL path. If
 * the URL changed, a same-domain fallback is allowed only when there is one
 * and only one offer from that merchant in the refreshed product response.
 * Ambiguous matches fail closed rather than silently switching merchants.
 */
export function matchRefreshedChannel3Offer(
  previous: Channel3OfferIdentity,
  candidates: Channel3NormalizedOffer[],
): Channel3NormalizedOffer | null {
  const sameProductAndMerchant = candidates.filter((candidate) =>
    candidate.productId === previous.productId &&
    normalizeDomain(candidate.offerDomain) === normalizeDomain(previous.offerDomain),
  );

  if (sameProductAndMerchant.length === 0) return null;

  const priorPath = canonicalOfferPath(previous.offerUrl);
  if (priorPath) {
    const exactPaths = sameProductAndMerchant.filter((candidate) => canonicalOfferPath(candidate.offerUrl) === priorPath);
    if (exactPaths.length === 1) return exactPaths[0] ?? null;
    if (exactPaths.length > 1) return null;
  }

  return sameProductAndMerchant.length === 1 ? (sameProductAndMerchant[0] ?? null) : null;
}

/** Compare catalog-backed fields only. Fulfillment terms are deliberately excluded. */
export function compareChannel3OfferRefresh(
  previous: Pick<Channel3NormalizedOffer, "productId" | "productTitle" | "offerDomain" | "offerUrl" | "price" | "currency" | "availability" | "condition" | "ramGb">,
  current: Channel3NormalizedOffer | null,
): Channel3OfferRefreshComparison {
  const sameProduct = current !== null && current.productId === previous.productId;
  const sameMerchant = current !== null && normalizeDomain(current.offerDomain) === normalizeDomain(previous.offerDomain);
  const matchedOffer = current !== null && sameProduct && sameMerchant;
  const oldValues = {
    title: previous.productTitle,
    price: Number(previous.price),
    currency: previous.currency.trim().toUpperCase(),
    availability: previous.availability,
    condition: previous.condition,
    ramGb: previous.ramGb,
  };
  const currentValues = current ? {
    title: current.productTitle,
    price: Number(current.price),
    currency: current.currency.trim().toUpperCase(),
    availability: current.availability,
    condition: current.condition,
    ramGb: current.ramGb,
  } : null;
  const changedFields: string[] = [];
  if (currentValues) {
    if (oldValues.title !== currentValues.title) changedFields.push("title");
    if (Number(oldValues.price).toFixed(2) !== Number(currentValues.price).toFixed(2)) changedFields.push("itemPrice");
    if (oldValues.currency !== currentValues.currency) changedFields.push("currency");
    if (oldValues.availability !== currentValues.availability) changedFields.push("availability");
    if (oldValues.condition !== currentValues.condition) changedFields.push("condition");
    if (oldValues.ramGb !== currentValues.ramGb) changedFields.push("structuredRam");
  }
  return {
    sameProduct,
    sameMerchant,
    matchedOffer,
    changedFields,
    previous: oldValues,
    current: currentValues,
  };
}
