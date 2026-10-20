export const MERCHANT_EVIDENCE_FIELDS = [
  "total",
  "shippingFee",
  "deliveryDate",
  "returnWindowDays",
  "attributes.itemPrice",
  "attributes.ramGb",
  "attributes.condition",
  "attributes.availability",
] as const;

export type MerchantEvidenceField = (typeof MERCHANT_EVIDENCE_FIELDS)[number];
export type MerchantEvidenceValue = string | number;

export interface ValidatedMerchantEvidenceClaim {
  field: MerchantEvidenceField;
  value: MerchantEvidenceValue;
  sourceUrl: string;
  sourceDomain: string;
  note: string | null;
  /** PactPay's local freshness policy; this is not the merchant's own update timestamp. */
  ttlMs: number;
}

export type MerchantEvidenceValidation =
  | { ok: true; claim: ValidatedMerchantEvidenceClaim }
  | { ok: false; error: string };

const FIELD_SET = new Set<string>(MERCHANT_EVIDENCE_FIELDS);
const VOLATILE_TTL_MS = 5 * 60 * 1000;
const RELATIVELY_STATIC_TTL_MS = 30 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function validateSourceUrl(raw: unknown, offerDomain: string): { url: string; domain: string } | string {
  if (typeof raw !== "string" || raw.trim().length === 0 || raw.length > 2048) {
    return "A merchant source URL is required (maximum 2,048 characters).";
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return "Source URL must be a valid absolute HTTPS URL.";
  }

  if (parsed.protocol !== "https:") return "Source URL must use HTTPS.";
  if (parsed.username || parsed.password) return "Source URL must not contain embedded credentials.";
  if (parsed.port) return "Source URL must use the standard HTTPS port.";
  if (parsed.hostname.length === 0 || parsed.hostname === "localhost" || parsed.hostname.endsWith(".local")) {
    return "Source URL must point to a public merchant website.";
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname) || parsed.hostname.includes(":")) {
    return "IP-address source URLs are not accepted; use the merchant's HTTPS domain.";
  }

  const allowedDomain = normalizeDomain(offerDomain);
  const sourceDomain = normalizeDomain(parsed.hostname);
  if (!allowedDomain || (sourceDomain !== allowedDomain && !sourceDomain.endsWith(`.${allowedDomain}`))) {
    return `Source URL must be on the selected merchant domain (${allowedDomain}).`;
  }

  // Avoid persisting query-string tokens, checkout-session identifiers, or tracking values.
  // The merchant page path is retained; the submitted claim is still human-attested, not fetched by PactPay.
  parsed.search = "";
  parsed.hash = "";
  return { url: parsed.toString(), domain: sourceDomain };
}

function parseFiniteNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  // Deliberately reject currency symbols and locale separators; UI/API use a normalized numeric value.
  if (!/^-?(?:\d+|\d+\.\d{1,4})$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : null;
}

function parseIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
  const value = raw.trim();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function normalizeFieldValue(field: MerchantEvidenceField, raw: unknown): MerchantEvidenceValue | null {
  if (field === "deliveryDate") return parseIsoDate(raw);

  if (field === "attributes.condition") {
    if (typeof raw !== "string") return null;
    const normalized = raw.trim().toLowerCase();
    return ["new", "refurbished", "used", "open-box", "unknown"].includes(normalized) ? normalized : null;
  }

  if (field === "attributes.availability") {
    if (typeof raw !== "string") return null;
    const normalized = raw.trim().toLowerCase();
    const allowed: Record<string, string> = {
      instock: "InStock",
      outofstock: "OutOfStock",
      preorder: "PreOrder",
      limitedavailability: "LimitedAvailability",
      backorder: "BackOrder",
      unknown: "Unknown",
    };
    return allowed[normalized.replace(/[\s_-]/g, "")] ?? null;
  }

  const parsed = parseFiniteNumber(raw);
  if (parsed === null) return null;

  if (field === "total" || field === "attributes.itemPrice") {
    return parsed > 0 && parsed <= 1_000_000_000 ? parsed : null;
  }
  if (field === "shippingFee") {
    return parsed >= 0 && parsed <= 1_000_000 ? parsed : null;
  }
  if (field === "returnWindowDays") {
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 3650 ? parsed : null;
  }
  if (field === "attributes.ramGb") {
    return parsed > 0 && parsed <= 4096 ? parsed : null;
  }
  return null;
}

/**
 * Validate user-entered evidence before storage. It validates shape and source-domain binding only;
 * it does not fetch the page, authenticate the merchant, or prove that the claim is true.
 */
export function validateMerchantEvidenceClaim(input: unknown, offerDomain: string): MerchantEvidenceValidation {
  if (!isRecord(input)) return { ok: false, error: "Request must be a JSON object." };

  const fieldValue = input.field;
  if (typeof fieldValue !== "string" || !FIELD_SET.has(fieldValue)) {
    return { ok: false, error: "Choose a supported evidence field." };
  }
  const field = fieldValue as MerchantEvidenceField;
  const value = normalizeFieldValue(field, input.value);
  if (value === null) {
    return { ok: false, error: `Value is invalid for '${field}'. Use a normalized number, YYYY-MM-DD date, or supported status.` };
  }

  const source = validateSourceUrl(input.sourceUrl, offerDomain);
  if (typeof source === "string") return { ok: false, error: source };

  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 500) return { ok: false, error: "Evidence note must be 500 characters or fewer." };

  const ttlMs = ["total", "shippingFee", "deliveryDate", "attributes.itemPrice", "attributes.availability"].includes(field)
    ? VOLATILE_TTL_MS
    : RELATIVELY_STATIC_TTL_MS;

  return {
    ok: true,
    claim: {
      field,
      value,
      sourceUrl: source.url,
      sourceDomain: source.domain,
      note: note || null,
      ttlMs,
    },
  };
}
