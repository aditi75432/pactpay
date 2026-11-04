import { scanUntrustedText, type InjectionFinding } from "./untrusted-text";

/**
 * Checkout inspection.
 *
 * A Meta Muse vision model reads a screenshot of a checkout page and reports what it sees. That reading is DATA,
 * not a decision. Fixed code then:
 *   1. compares every number with the rules the shopper approved,
 *   2. checks that the itemized charges actually add up to the total (a hidden fee shows up as a gap),
 *   3. scans the page's own text for instructions aimed at an AI agent,
 *   4. requires two independent readings of the page to agree.
 * Anything that can't be confirmed is "can't verify", never "safe".
 */
export interface CheckoutReading {
  merchant: string | null;
  currency: string | null;
  itemPrice: number | null;
  shipping: number | null;
  tax: number | null;
  /** Other charges the page shows, such as "Service fee". */
  otherFees: Array<{ label: string; amount: number }>;
  total: number | null;
  deliveryDate: string | null;
  returnWindowDays: number | null;
  /** Readable text on the page that is NOT a price, product name or button (notes, footers, banners). */
  pageNotes: string[];
  /** False when the image isn't a checkout page or can't be read. */
  readable: boolean;
  /** The reader's own judgement that some text on the page is addressed to an AI agent or assistant (not to a human shopper). */
  addressedToAI?: boolean;
  /** The text the reader says is addressed to an AI, word for word. */
  aiAddressedText?: string | null;
}

const MONEY_MAX = 1_000_000;

function money(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[^0-9.\-]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= MONEY_MAX ? Math.round(n * 100) / 100 : null;
}

function text(value: unknown, max = 160): string | null {
  // eslint-disable-next-line no-control-regex
  return typeof value === "string" && value.trim() ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : null;
}

export const EMPTY_READING: CheckoutReading = {
  merchant: null, currency: null, itemPrice: null, shipping: null, tax: null, otherFees: [], total: null,
  deliveryDate: null, returnWindowDays: null, pageNotes: [], readable: false, addressedToAI: false, aiAddressedText: null,
};

/** Turns untrusted model output into a clean reading. Anything malformed becomes null rather than a guess. */
export function parseCheckoutReading(raw: unknown): { reading: CheckoutReading; problems: string[] } {
  const problems: string[] = [];
  const record = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!record) {
    problems.push("The model did not return a reading.");
    return { reading: { ...EMPTY_READING }, problems };
  }
  const currencyRaw = text(record.currency, 8)?.toUpperCase() ?? null;
  const fees = (Array.isArray(record.otherFees) ? record.otherFees : []).slice(0, 8).flatMap((item) => {
    const r = typeof item === "object" && item !== null ? item as Record<string, unknown> : null;
    const amount = r ? money(r.amount) : null;
    const label = r ? text(r.label, 60) : null;
    return label && amount !== null ? [{ label, amount }] : [];
  });
  const days = typeof record.returnWindowDays === "number" && Number.isFinite(record.returnWindowDays) && record.returnWindowDays >= 0 && record.returnWindowDays <= 3650
    ? Math.round(record.returnWindowDays) : null;
  const date = text(record.deliveryDate, 10);
  const notes = (Array.isArray(record.pageNotes) ? record.pageNotes : []).slice(0, 12).map((item) => text(item, 400)).filter((item): item is string => item !== null);
  const reading: CheckoutReading = {
    merchant: text(record.merchant, 80),
    currency: currencyRaw && /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : null,
    itemPrice: money(record.itemPrice), shipping: money(record.shipping), tax: money(record.tax), otherFees: fees, total: money(record.total),
    deliveryDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, returnWindowDays: days, pageNotes: notes,
    // Fail closed: a reading is only usable when the model explicitly says the page was readable.
    readable: record.readable === true,
    addressedToAI: record.addressedToAI === true,
    aiAddressedText: text(record.aiAddressedText, 300),
  };
  if (reading.total === null) problems.push("No order total was read.");
  return { reading, problems };
}

export type InspectionField = "total" | "itemPrice" | "shipping" | "currency" | "deliveryDate" | "returnWindowDays";
export interface InspectionRule {
  id: string;
  label: string;
  hard: boolean;
  field: InspectionField;
  comparator: "lte" | "gte" | "eq";
  expected: number | string;
}

const FIELD_MAP: Record<string, InspectionField> = {
  total: "total", "attributes.itemPrice": "itemPrice", shippingFee: "shipping", currency: "currency", deliveryDate: "deliveryDate", returnWindowDays: "returnWindowDays",
};

/** The approved rules that a checkout page can actually prove. The rest (brand, stock, specs) aren't visible at checkout. */
export function inspectionRulesFor(pact: {
  constraints: ReadonlyArray<{ id: string; description?: string; severity: string; field: string; comparator: string; expected: unknown }>;
  maxTotalAmount?: number | undefined;
}): InspectionRule[] {
  const rules: InspectionRule[] = [];
  for (const rule of pact.constraints) {
    const field = FIELD_MAP[rule.field];
    if (!field || (rule.comparator !== "lte" && rule.comparator !== "gte" && rule.comparator !== "eq")) continue;
    const expected = typeof rule.expected === "number" || typeof rule.expected === "string" ? rule.expected : null;
    if (expected === null) continue;
    rules.push({ id: rule.id, label: rule.description ?? rule.id, hard: rule.severity === "hard", field, comparator: rule.comparator, expected });
  }
  if (typeof pact.maxTotalAmount === "number" && Number.isFinite(pact.maxTotalAmount) && pact.maxTotalAmount >= 0) {
    // A softer or looser user-authored rule must never suppress the immutable system budget cap.
    const alreadyStricter = rules.some((rule) =>
      rule.field === "total" && rule.comparator === "lte" && rule.hard &&
      typeof rule.expected === "number" && rule.expected <= pact.maxTotalAmount!,
    );
    if (!alreadyStricter) {
      rules.push({ id: "system.budget_cap", label: "Total must stay within your maximum budget", hard: true, field: "total", comparator: "lte", expected: pact.maxTotalAmount });
    }
  }
  return rules;
}

export type RuleStatus = "pass" | "fail" | "unknown";
export interface InspectionRow { ruleId: string; label: string; expected: string; observed: string; status: RuleStatus; hard: boolean }
export type InspectionOutcome = "SAFE_TO_PAY" | "DO_NOT_PAY" | "CANNOT_VERIFY";

export interface Inspection {
  outcome: InspectionOutcome;
  headline: string;
  rows: InspectionRow[];
  arithmetic: { checked: boolean; ok: boolean; /** A charge line (shipping or tax) wasn't shown, so a gap can't be told apart from a hidden fee. */ incomplete: boolean; statedTotal: number | null; itemsSum: number | null; gap: number | null; note: string };
  injection: InjectionFinding[];
  /** Which readers (1 or 2) saw text aimed at an AI. */
  injectionReaders: number[];
  readingsAgree: boolean | null;
  reasons: string[];
}

function observedOf(reading: CheckoutReading, field: InspectionField): number | string | null {
  const value = reading[field];
  return value === undefined ? null : value;
}

function compare(observed: number | string | null, rule: InspectionRule): RuleStatus {
  if (observed === null) return "unknown";
  if (rule.comparator === "eq") return String(observed).toUpperCase() === String(rule.expected).toUpperCase() ? "pass" : "fail";
  if (rule.field === "deliveryDate") {
    const a = Date.parse(String(observed)), b = Date.parse(String(rule.expected));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return "unknown";
    return rule.comparator === "lte" ? (a <= b ? "pass" : "fail") : a >= b ? "pass" : "fail";
  }
  const a = Number(observed), b = Number(rule.expected);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "unknown";
  return rule.comparator === "lte" ? (a <= b + 1e-9 ? "pass" : "fail") : a + 1e-9 >= b ? "pass" : "fail";
}

const sameMoney = (x: number | null, y: number | null): boolean => (x === null && y === null) || (x !== null && y !== null && Math.abs(x - y) <= 0.005);
const feesTotal = (reading: CheckoutReading): number => reading.otherFees.reduce((sum, fee) => sum + fee.amount, 0);

/**
 * Do two independent readings agree on the whole money picture? Missing data is NOT agreement: if one reader saw a
 * line the other didn't, or the currencies differ (including one being unreadable), they disagree.
 */
export function readingsAgree(a: CheckoutReading, b: CheckoutReading): boolean {
  if (!a.readable || !b.readable || a.total === null || b.total === null) return false;
  if (!sameMoney(a.total, b.total) || !sameMoney(a.itemPrice, b.itemPrice) || !sameMoney(a.shipping, b.shipping) || !sameMoney(a.tax, b.tax)) return false;
  if (!a.currency || !b.currency || a.currency !== b.currency) return false;
  const normalizeText = (value: string | null) => (value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const merchantIdentity = (value: string | null) => {
    if (!value) return "";
    let normalized = normalizeText(value).replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/, 1)[0] ?? "";
    normalized = normalized.replace(/\.(?:com|org|net|co|io|store|shop|us|uk|ca|in|de|fr|au)(?:\.[a-z]{2})?$/i, "");
    normalized = normalized.replace(/\b(incorporated|inc|limited|ltd|llc|corp|corporation)\b/g, "");
    return normalized.replace(/[^a-z0-9]/g, "");
  };
  const merchantA = merchantIdentity(a.merchant);
  const merchantB = merchantIdentity(b.merchant);
  if (!merchantA || !merchantB || merchantA !== merchantB) return false;
  // Delivery and return terms are checked against the approved Pact row-by-row below. A reader missing an
  // unrelated optional field must not invalidate an otherwise identical financial reading.
  const feeKey = (fee: { label: string; amount: number }) => `${normalizeText(fee.label)}|${fee.amount.toFixed(2)}`;
  const feesA = a.otherFees.map(feeKey).sort();
  const feesB = b.otherFees.map(feeKey).sort();
  if (feesA.length !== feesB.length || feesA.some((value, index) => value !== feesB[index])) return false;
  return true;
}

function describeObserved(value: number | string | null, field: InspectionField): string {
  if (value === null) return "not shown";
  if (field === "returnWindowDays") return `${value} days`;
  return typeof value === "number" ? value.toFixed(2) : String(value);
}

function describeExpected(rule: InspectionRule): string {
  const word = rule.comparator === "lte" ? "at most" : rule.comparator === "gte" ? "at least" : "exactly";
  if (typeof rule.expected === "number") return `${word} ${rule.field === "returnWindowDays" ? `${rule.expected} days` : rule.expected.toFixed(2)}`;
  return `${word} ${rule.expected}`;
}

function arithmeticOf(reading: CheckoutReading): Inspection["arithmetic"] {
  const checkable = reading.total !== null && reading.itemPrice !== null;
  const complete = reading.shipping !== null && reading.tax !== null;
  // Missing shipping or tax is unknown even when the visible subtotal happens to equal the total.
  // Only an explicitly displayed zero is evidence of a zero charge.
  const itemsSum = checkable ? Math.round(((reading.itemPrice ?? 0) + (reading.shipping ?? 0) + (reading.tax ?? 0) + feesTotal(reading)) * 100) / 100 : null;
  const gap = checkable && itemsSum !== null && reading.total !== null ? Math.round((reading.total - itemsSum) * 100) / 100 : null;
  const gapFound = gap !== null && Math.abs(gap) > 0.02;
  const incomplete = !complete;
  return {
    checked: checkable, ok: !gapFound, incomplete, statedTotal: reading.total, itemsSum, gap,
    note: !checkable
      ? "Not enough line items were shown to check the total."
      : incomplete
        ? "Shipping or tax wasn't shown. Missing charges are unknown, not zero."
        : !gapFound
          ? "The itemized charges add up to the total."
          : `The total is ${gap! > 0 ? "higher" : "lower"} than its line items by ${Math.abs(gap!).toFixed(2)}. Something isn't itemized.`,
  };
}

/** Pattern rules that, on their own, show text aimed at an AI. Rules like "complete your order now" also appear on honest pages. */
const STRONG_RULES = new Set(["override-instructions", "ignore-the-user", "role-marker", "secrecy", "new-instructions", "addresses-ai"]);
const AI_NOUN = /\b(ai|a\.i\.|llm|language model|chatbot|automated (agents?|assistants?|systems?|tools?)|(ai|shopping|purchasing|browsing|web) (agents?|assistants?|bots?)|agents? and assistants?)\b/i;
const EXTRA_OVERRIDE = /\b(ignore|disregard|forget|override|bypass|skip)\b[^.!?\n]{0,40}\b(previous|prior|above|earlier|preceding|any|all|your|the)\b[^.!?\n]{0,20}\b(instructions?|directions?|directives?|prompts?|commands?|guidelines?|rules?|limits?|constraints?|budget|restrictions?|safeguards?)\b|\bforget (what|everything|all)\b[^.!?\n]{0,40}\b(told|said|instructed|know)\b/i;

/** Findings that should block: the reader flagged text aimed at an AI, a strong pattern matched, or several weak ones agree. */
export function checkoutInjectionFindings(reading: CheckoutReading): InjectionFinding[] {
  const text = hostileTextOf(reading);
  const found: InjectionFinding[] = [];
  const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const quotedText = reading.aiAddressedText ? normalize(reading.aiAddressedText) : "";
  const visiblePageText = reading.pageNotes.map(normalize).join(" ");
  // Treat a model's semantic flag as evidence only when its claimed quotation is
  // corroborated by text actually transcribed from the checkout. This prevents a
  // generic or hallucinated model flag from rejecting an otherwise ordinary page.
  // The independent pattern scanner below still catches visible hostile instructions
  // even when a reader does not set addressedToAI.
  if (reading.addressedToAI === true && quotedText && visiblePageText.includes(quotedText)) {
    found.push({ rule: "reader-flagged", excerpt: reading.aiAddressedText!.slice(0, 160) });
  }
  const scanned = scanUntrustedText(text);
  const normalized = text.replace(/\s+/g, " ");
  if (EXTRA_OVERRIDE.test(normalized) && !scanned.some((item) => item.rule === "override-instructions")) {
    const match = EXTRA_OVERRIDE.exec(normalized)!;
    found.push({ rule: "override-instructions", excerpt: normalized.slice(Math.max(0, match.index - 20), match.index + match[0].length + 40).trim().slice(0, 160) });
  }
  for (const item of scanned) {
    if (item.rule === "addresses-agent") {
      // "Our support assistant should answer within 2 hours" is not aimed at an AI shopper. Only count it when an AI noun is explicit.
      if (AI_NOUN.test(item.excerpt)) found.push({ ...item, rule: "addresses-ai" });
      continue;
    }
    if (STRONG_RULES.has(item.rule)) found.push(item);
  }
  const weak = scanned.filter((item) => !STRONG_RULES.has(item.rule) && item.rule !== "addresses-agent");
  if (weak.length >= 2) found.push(...weak);
  return found;
}

function hostileTextOf(reading: CheckoutReading): string {
  return [...reading.pageNotes, reading.merchant ?? "", ...reading.otherFees.map((fee) => fee.label)].join(" \n ");
}

export function inspectCheckout(reading: CheckoutReading, rules: readonly InspectionRule[], options: { second?: CheckoutReading | null } = {}): Inspection {
  const second = options.second ?? null;
  // A rule only passes when BOTH readings pass it. If they disagree about a rule, it is unknown, never a pass.
  const rows: InspectionRow[] = rules.map((rule) => {
    const observed = observedOf(reading, rule.field);
    const statusA = compare(observed, rule);
    const observedB = second ? observedOf(second, rule.field) : null;
    const statusB = second ? compare(observedB, rule) : statusA;
    const status: RuleStatus = statusA === statusB ? statusA : "unknown";
    const shown = second && statusA !== statusB ? `${describeObserved(observed, rule.field)} / ${describeObserved(observedB, rule.field)}` : describeObserved(observed, rule.field);
    return { ruleId: rule.id, label: rule.label, hard: rule.hard, expected: describeExpected(rule), observed: shown, status };
  });

  // The itemized lines must add up to the total. Two-reader disagreement is unverified, not safe.
  const arithmeticA = arithmeticOf(reading);
  const arithmeticB = second ? arithmeticOf(second) : null;
  const arithmetic = arithmeticB && (!arithmeticB.ok && arithmeticA.ok) ? arithmeticB : arithmeticA;
  const gapA = arithmeticA.checked && !arithmeticA.ok && !arithmeticA.incomplete;
  const gapB = arithmeticB ? arithmeticB.checked && !arithmeticB.ok && !arithmeticB.incomplete : false;
  // One reader's arithmetic gap may be an OCR error. It blocks capture as CANNOT_VERIFY until both
  // independent readings confirm it, avoiding contradictory reject/approve decisions on repeated reads.
  const hiddenFee = arithmeticB ? gapA && gapB : gapA;
  const arithmeticDisagrees = arithmeticB !== null && (
    gapA !== gapB || arithmeticA.checked !== arithmeticB.checked || arithmeticA.incomplete !== arithmeticB.incomplete
  );
  const incomplete = [arithmeticA, arithmeticB].some((item) => item !== null && (!item.checked || item.incomplete)) || arithmeticDisagrees;
  const arithmeticOk = !hiddenFee && !incomplete && arithmeticA.ok && (arithmeticB?.ok ?? true);

  // Text aimed at an AI is checked in BOTH readings, so a reader that skipped it can't hide it.
  // Two tripwires: the reader's own semantic judgement, and a pattern scan that ignores ordinary shop banners.
  const findingsA = checkoutInjectionFindings(reading);
  const findingsB = second ? checkoutInjectionFindings(second) : [];
  const seen = new Set<string>();
  const injection = [...findingsA, ...findingsB].filter((finding) => { const key = `${finding.rule}|${finding.excerpt}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const injectionReaders = [findingsA.length > 0 ? 1 : 0, findingsB.length > 0 ? 2 : 0].filter((n) => n > 0);
  const agree = second === null ? null : readingsAgree(reading, second);

  const reasons: string[] = [];
  const hardFail = rows.filter((row) => row.hard && row.status === "fail");
  const hardUnknown = rows.filter((row) => row.hard && row.status === "unknown");
  for (const row of hardFail) reasons.push(`${row.label}: the page shows ${row.observed}, but you approved ${row.expected}.`);
  if (hiddenFee) reasons.push((arithmeticA.ok ? arithmeticB! : arithmeticA).note);
  else if (arithmeticDisagrees) reasons.push("The two readers disagreed about the itemized charges. The checkout cannot be verified yet.");
  else if (incomplete) reasons.push((!arithmeticA.checked || arithmeticA.incomplete) ? arithmeticA.note : arithmeticB!.note);
  if (injection.length > 0) reasons.push(`The page contains text aimed at an AI agent${injectionReaders.length === 1 ? ` (seen by reader ${injectionReaders[0]})` : ""}. It was treated as hostile and ignored.`);
  for (const row of hardUnknown) reasons.push(`${row.label}: the page doesn't show this clearly, or the two readings disagree, so it can't be confirmed.`);
  if (!reading.readable || (second && !second.readable)) reasons.push("The image doesn't look like a readable checkout page.");
  if (agree === false) reasons.push("Two independent readings of the page disagreed, so neither is trusted.");

  let outcome: InspectionOutcome;
  if (hardFail.length > 0 || hiddenFee || injection.length > 0) outcome = "DO_NOT_PAY";
  else if (!reading.readable || (second && !second.readable) || reading.total === null || hardUnknown.length > 0 || incomplete || agree === false) outcome = "CANNOT_VERIFY";
  else outcome = "SAFE_TO_PAY";
  const headline = outcome === "SAFE_TO_PAY"
    ? "Safe to pay. This checkout matches what you approved."
    : outcome === "DO_NOT_PAY"
      ? "Do not pay. This checkout doesn't match what you approved."
      : "Can't verify. Don't pay until it's confirmed.";
  return { outcome, headline, rows, arithmetic: { ...arithmetic, ok: arithmeticOk && arithmetic.ok, incomplete }, injection, injectionReaders, readingsAgree: agree, reasons };
}
