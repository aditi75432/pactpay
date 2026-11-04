import type { Constraint, ConstraintKind, ConstraintSeverity, Currency, PurchasePact } from "@pactpay/pact-core";
import { randomUUID } from "node:crypto";

export const PACT_STORAGE_KEY = "pactpay.activePact.v1";

const FIELD_RULES: Record<string, { kind: ConstraintKind; value: "number" | "date" | "string"; comparators: string[] }> = {
  total: { kind: "budget", value: "number", comparators: ["lte"] },
  "attributes.itemPrice": { kind: "budget", value: "number", comparators: ["lte", "gte", "eq"] },
  shippingFee: { kind: "shipping_fee", value: "number", comparators: ["lte"] },
  deliveryDate: { kind: "delivery_deadline", value: "date", comparators: ["lte"] },
  returnWindowDays: { kind: "return_window", value: "number", comparators: ["gte"] },
  "attributes.ramGb": { kind: "attribute", value: "number", comparators: ["gte", "lte", "eq"] },
  "attributes.condition": { kind: "attribute", value: "string", comparators: ["eq"] },
  "attributes.availability": { kind: "attribute", value: "string", comparators: ["eq"] },
  "attributes.brand": { kind: "attribute", value: "string", comparators: ["eq"] },
  currency: { kind: "attribute", value: "string", comparators: ["eq"] },
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, max = 180): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function normalizeExpected(field: string, value: unknown): string | number | boolean {
  const rules = FIELD_RULES[field];
  if (!rules) throw new Error(`Unsupported constraint field: ${field || "(empty)"}.`);
  if (rules.value === "number") {
    const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[,\s$₹]/g, "")) : NaN;
    if (!Number.isFinite(raw) || raw < 0 || raw > 1_000_000) throw new Error(`Constraint '${field}' requires a valid non-negative number.`);
    if (field === "attributes.ramGb" && (!Number.isInteger(raw) || raw < 1 || raw > 256)) throw new Error("RAM constraints must be whole GB from 1 to 256.");
    if (field === "returnWindowDays" && (!Number.isInteger(raw) || raw > 3650)) throw new Error("Return-window constraints must be whole days up to 3650.");
    return raw;
  }
  if (rules.value === "date") {
    const text = cleanText(value, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
      throw new Error("Delivery deadlines must use YYYY-MM-DD.");
    }
    return text;
  }
  let text = cleanText(value, 100);
  if (!text) throw new Error(`Constraint '${field}' requires a non-empty expected value.`);
  if (field === "attributes.availability") {
    if (/^(?:in[ _-]?stock|available|available now)$/i.test(text)) return "InStock";
    if (/^(?:out[ _-]?of[ _-]?stock|unavailable|sold[ _-]?out)$/i.test(text)) return "OutOfStock";
  }
  if (field === "attributes.condition") text = text.toLowerCase();
  if (field === "currency") {
    const currency = text.toUpperCase();
    if (currency !== "USD" && currency !== "INR") throw new Error("Only USD and INR are supported currencies in this prototype.");
    return currency;
  }
  return text;
}

function normalizeComparatorToken(value: unknown): string {
  const raw = cleanText(value, 80).toLowerCase();
  const token = raw.replace(/[ _-]+/g, " ").replace(/\s+/g, " ").trim();
  const aliases: Record<string, string> = {
    gte: "gte",
    ">=": "gte",
    "greater than or equal": "gte",
    "greater than or equal to": "gte",
    "at least": "gte",
    minimum: "gte",
    "minimum of": "gte",
    min: "gte",
    "no less than": "gte",
    "not less than": "gte",
    lte: "lte",
    "<=": "lte",
    "less than or equal": "lte",
    "less than or equal to": "lte",
    "at most": "lte",
    maximum: "lte",
    "maximum of": "lte",
    max: "lte",
    "no more than": "lte",
    "not more than": "lte",
    eq: "eq",
    equal: "eq",
    equals: "eq",
    exactly: "eq",
    is: "eq",
  };
  return aliases[token] ?? token;
}

/**
 * Return-window constraints supported by PactPay are minimums (gte). If the
 * model contradicts itself and emits lte/eq, only repair it when the ORIGINAL
 * user intent explicitly states a minimum return period and the numeric
 * threshold exactly matches. Never guess or silently invert an ambiguous rule.
 */
function explicitMinimumReturnDays(intent: string): number | undefined {
  if (!intent) return undefined;
  const text = intent.toLowerCase();
  const minimumPatterns = [
    /(?:at least|a minimum of|minimum(?: of)?|no less than|not less than|>=)\s*(\d{1,4})\s*(?:calendar\s+)?days?\b/ig,
    /\b(?:return window|return period|returns?)\b[^.;!?]{0,70}?(?:at least|a minimum of|minimum(?: of)?|no less than|not less than|>=)\s*(\d{1,4})\s*(?:calendar\s+)?days?\b/ig,
  ];
  for (const pattern of minimumPatterns) {
    for (const match of text.matchAll(pattern)) {
      const valueText = match[1];
      if (!valueText) continue;
      const index = match.index ?? 0;
      const nearby = text.slice(Math.max(0, index - 55), Math.min(text.length, index + match[0].length + 55));
      if (/\b(?:return|returns|return window|return period)\b/i.test(nearby)) {
        const value = Number(valueText);
        if (Number.isInteger(value) && value >= 0 && value <= 3650) return value;
      }
    }
  }
  return undefined;
}

function normalizeConstraint(value: unknown, index: number, userIntent = ""): Constraint {
  const row = record(value);
  if (!row) throw new Error(`Constraint ${index + 1} must be an object.`);
  const field = cleanText(row.field, 80);
  const rules = FIELD_RULES[field];
  if (!rules) throw new Error(`Constraint ${index + 1} uses an unsupported field: ${field || "(empty)"}.`);
  let comparator = normalizeComparatorToken(row.comparator);
  if (!rules.comparators.includes(comparator)) {
    const explicitReturnMinimum = field === "returnWindowDays" ? explicitMinimumReturnDays(userIntent) : undefined;
    const expectedNumber = typeof row.expected === "number"
      ? row.expected
      : typeof row.expected === "string"
        ? Number(row.expected.replace(/[ ,$₹]/g, ""))
        : NaN;
    // This correction is permitted only for a known contradictory comparator
    // and an exact match with a minimum explicitly stated by the user.
    if (
      field === "returnWindowDays" &&
      (comparator === "lte" || comparator === "eq") &&
      explicitReturnMinimum !== undefined &&
      expectedNumber === explicitReturnMinimum &&
      rules.comparators.includes("gte")
    ) {
      comparator = "gte";
    }
  }
  if (!rules.comparators.includes(comparator)) {
    throw new Error(`Constraint '${field}' uses unsupported comparator '${cleanText(row.comparator, 40) || "(empty)"}'.`);
  }
  const severityValue = cleanText(row.severity, 10).toLowerCase();
  const severity: ConstraintSeverity = severityValue === "soft" ? "soft" : severityValue === "hard" ? "hard" : (() => { throw new Error(`Constraint '${field}' needs hard or soft severity.`); })();
  const idCandidate = cleanText(row.id, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const id = idCandidate || `rule-${index + 1}`;
  const description = cleanText(row.description, 180) || `${field} ${comparator} ${String(row.expected)}`;
  const expected = normalizeExpected(field, row.expected);
  return { id, kind: rules.kind, severity, description, expected, comparator: comparator as Constraint["comparator"], field };
}

/**
 * Re-validates the pact at the API trust boundary. Authority is always minted by PactPay,
 * never accepted from a browser or an LLM. This pact can search/compare but cannot settle.
 */
export function sanitizePurchasePact(value: unknown): PurchasePact {
  const raw = record(value);
  if (!raw) throw new Error("A structured Purchase Pact is required.");
  const currency = cleanText(raw.currency, 4).toUpperCase();
  if (currency !== "USD" && currency !== "INR") throw new Error("Only USD and INR are supported currencies in this prototype.");
  const constraintsValue = raw.constraints;
  if (!Array.isArray(constraintsValue) || constraintsValue.length < 1 || constraintsValue.length > 12) {
    throw new Error("A Purchase Pact must contain between 1 and 12 constraints.");
  }
  const constraints = constraintsValue.map((constraint, index) => normalizeConstraint(constraint, index));
  const ids = new Set<string>();
  for (const constraint of constraints) {
    if (ids.has(constraint.id)) throw new Error(`Duplicate constraint ID '${constraint.id}'.`);
    ids.add(constraint.id);
  }
  const amountValue = raw.maxTotalAmount;
  const maxTotalAmount = amountValue === undefined || amountValue === null || amountValue === ""
    ? undefined
    : typeof amountValue === "number" ? amountValue : typeof amountValue === "string" ? Number(amountValue.replace(/[,\s$₹]/g, "")) : NaN;
  if (maxTotalAmount !== undefined && (!Number.isFinite(maxTotalAmount) || maxTotalAmount <= 0 || maxTotalAmount > 1_000_000)) {
    throw new Error("Maximum budget must be greater than zero and at most 1,000,000.");
  }
  const hasTotalLimit = constraints.some((constraint) => constraint.field === "total" && constraint.comparator === "lte");
  if (maxTotalAmount !== undefined && !hasTotalLimit) {
    constraints.unshift({
      id: "max-landed-total",
      kind: "budget",
      severity: "hard",
      description: `Final landed total must be at most ${maxTotalAmount.toFixed(2)} ${currency}.`,
      expected: maxTotalAmount,
      comparator: "lte",
      field: "total",
    });
  }
  if (!constraints.some((constraint) => constraint.field === "currency")) {
    constraints.push({
      id: "currency-match",
      kind: "attribute",
      severity: "hard",
      description: `Offer currency must be ${currency}.`,
      expected: currency,
      comparator: "eq",
      field: "currency",
    });
  }
  if (constraints.length > 12) throw new Error("This pact exceeds the 12-constraint safety limit.");
  const idValue = cleanText(raw.id, 100).replace(/[^a-zA-Z0-9:_-]/g, "");
  return {
    id: idValue || `purchase-pact-${randomUUID()}`,
    version: 1,
    currency: currency as Currency,
    ...(maxTotalAmount !== undefined ? { maxTotalAmount } : {}),
    constraints,
    authority: {
      canSearch: true,
      canCompare: true,
      canCreateOrder: false,
      canAuthorize: false,
      canCapture: false,
      canSubstitute: false,
      canChangeHardConstraints: false,
    },
  };
}

export interface IntentCompilation {
  title: string;
  searchQuery: string;
  assumptions: string[];
  unverifiedRequirements: string[];
  compiler: "MODEL" | "RULE_BASED_FALLBACK";
  model: string;
  pact: PurchasePact;
}

export function normalizeIntentCompilation(value: unknown, compiler: IntentCompilation["compiler"], model: string, userIntent = ""): IntentCompilation {
  const raw = record(value);
  if (!raw) throw new Error("Intent compiler returned an invalid object.");
  const title = cleanText(raw.title, 100) || "Your purchase pact";
  const searchQuery = cleanText(raw.searchQuery, 180);
  if (!searchQuery) throw new Error("Intent compiler did not return a usable product search query.");
  const currencyValue = cleanText(raw.currency, 4).toUpperCase() || "USD";
  const modelBudgetText = cleanText(raw.maxTotalAmount, 40);
  const modelBudget = modelBudgetText ? Number(modelBudgetText.replace(/[ ,\s$₹]/g, "")) : undefined;
  if (modelBudget !== undefined && (!Number.isFinite(modelBudget) || modelBudget <= 0 || modelBudget > 1_000_000)) {
    throw new Error("Intent compiler returned an invalid budget; please restate the amount clearly.");
  }
  // Budgets are only accepted when grounded in the original user prompt.
  // A catalog-item-price cap is not the same as an all-in landed-total cap.
  const explicitLandedBudget = userIntent ? extractBudget(userIntent) : undefined;
  const explicitItemPriceCap = userIntent ? extractCatalogItemPriceLimit(userIntent) : undefined;
  const max = userIntent ? explicitLandedBudget : modelBudget;
  const constraintRows = Array.isArray(raw.constraints) ? raw.constraints : [];
  if (constraintRows.length > 12) throw new Error("Intent compiler returned too many constraints.");
  let constraints = constraintRows.map((constraint, index) => normalizeConstraint(constraint, index, userIntent));
  if (userIntent) {
    // Replace model-supplied price caps with exact amounts parsed from user text.
    // This rejects invented total limits and keeps listing price separate from
    // unknown shipping/tax. Explicitly requested landed totals remain hard rules.
    constraints = constraints.filter((constraint) =>
      constraint.field !== "total" &&
      !(constraint.field === "attributes.itemPrice" && constraint.comparator === "lte")
    );
    if (max !== undefined) {
      constraints.unshift({
        id: "max-landed-total",
        kind: "budget",
        severity: "hard",
        description: `Final landed total must be at most ${max.toFixed(2)} ${currencyValue}.`,
        expected: max,
        comparator: "lte",
        field: "total",
      });
    }
    if (explicitItemPriceCap !== undefined) {
      constraints.unshift({
        id: "max-catalog-item-price",
        kind: "budget",
        severity: "hard",
        description: `Catalog item price must be at most ${explicitItemPriceCap.toFixed(2)} ${currencyValue}; shipping and tax are not included.`,
        expected: explicitItemPriceCap,
        comparator: "lte",
        field: "attributes.itemPrice",
      });
    }
  } else if (max !== undefined && !constraints.some((constraint) => constraint.field === "total" && constraint.comparator === "lte")) {
    constraints.unshift({
      id: "max-landed-total",
      kind: "budget",
      severity: "hard",
      description: `Final landed total must be at most ${max.toFixed(2)} ${currencyValue}.`,
      expected: max,
      comparator: "lte",
      field: "total",
    });
  }
  if (!constraints.some((constraint) => constraint.field === "currency")) {
    constraints.push({
      id: "currency-match",
      kind: "attribute",
      severity: "hard",
      description: `Offer currency must be ${currencyValue}.`,
      expected: currencyValue,
      comparator: "eq",
      field: "currency",
    });
  }
  if (constraints.length < 1) throw new Error("I couldn't extract an enforceable requirement. Add a budget, a must-have feature, a delivery condition, or a return/shipping rule.");
  if (constraints.length > 12) throw new Error("This pact exceeds the 12-constraint safety limit.");
  const assumptions = Array.isArray(raw.assumptions) ? raw.assumptions.map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 6) : [];
  const unverifiedRequirements = Array.isArray(raw.unverifiedRequirements) ? raw.unverifiedRequirements.map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 8) : [];
  const pact = sanitizePurchasePact({
    id: `purchase-pact-${randomUUID()}`,
    version: 1,
    currency: currencyValue,
    maxTotalAmount: max,
    constraints,
  });
  return { title, searchQuery, assumptions, unverifiedRequirements, compiler, model, pact };
}

type PriceMention = { index: number; end: number; amount: number; capPhrase: boolean };

function extractPriceMentions(text: string): PriceMention[] {
  const patterns = [
    /\b(?:under|below|less than|at most|up to|not more than|no more than)\s*(?:\$|₹|USD\s*|INR\s*)?([\d,]+(?:\.\d{1,2})?)(?:\s*(?:USD|INR))?/ig,
    /(?:\$|₹)\s*([\d,]+(?:\.\d{1,2})?)/g,
    /\b([\d,]+(?:\.\d{1,2})?)\s*(?:USD|INR|rupees?)\b/ig,
  ];
  const mentions: PriceMention[] = [];
  for (const [patternIndex, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      const captured = match[1];
      if (captured === undefined || captured.length === 0 || match.index === undefined) continue;
      // Do not create a second, context-free $25 candidate for the same
      // "shipping at most $25" phrase after the full cap candidate was found.
      if (patternIndex > 0) {
        const beforeCurrency = text.slice(Math.max(0, match.index - 36), match.index);
        if (/\b(?:under|below|less than|at most|up to|not more than|no more than)\s*$/i.test(beforeCurrency)) continue;
      }
      const amount = Number(captured.replace(/,/g, ""));
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) continue;
      const candidate = { index: match.index, end: match.index + match[0].length, amount, capPhrase: patternIndex === 0 };
      if (!mentions.some((item) => item.index === candidate.index && item.end === candidate.end && item.amount === candidate.amount)) {
        mentions.push(candidate);
      }
    }
  }
  return mentions.sort((a, b) => a.index - b.index || a.end - b.end);
}

function isNonPriceConstraintContext(prefix: string): boolean {
  // Only exclude a number when the cap phrase is attached directly to another
  // field ("shipping under $10", "RAM no more than 16 GB"). Do not exclude a
  // price just because another constraint appears earlier in the sentence.
  return /\b(?:shipping(?:\s+fee)?|delivery\s+fee|return(?:\s+window|\s+period)?|returns?|ram|memory|storage|weight|dimensions?)\s*(?:(?:is|must\s+be|of)\s*)?$/i.test(prefix);
}

function isExplicitItemPriceContext(prefix: string): boolean {
  return /\b(?:(?:catalog\s+)?item|listing|listed)\s+price\b[^.;]{0,35}$/i.test(prefix);
}

function isLandedTotalContext(prefix: string, suffix: string): boolean {
  const before = /\b(?:(?:final|landed|checkout|overall|all[- ]in|grand)\s+)?total\b[^.;]{0,45}$/i.test(prefix);
  const budget = /\b(?:budget|maximum\s+budget|max\s+budget|spending\s+limit|spend\s+limit)\b[^.;]{0,45}$/i.test(prefix);
  const after = /^\s*(?:(?:USD|INR)\s*)?(?:(?:in\s+)?(?:the\s+)?total|all[- ]in|budget|including\s+(?:shipping|tax|delivery)|with\s+(?:shipping|tax|delivery))\b/i.test(suffix);
  return before || budget || after;
}

/**
 * An unqualified product price cap (for example, "AirPods under $100") limits
 * the catalog item price. Only explicit total/budget language limits the
 * final landed amount. Shipping and tax are never inferred from item price.
 */
function extractCatalogItemPriceLimit(text: string): number | undefined {
  const explicitPatterns = [
    /\b(?:catalog\s+)?item\s+price\s+(?:is\s+)?(?:under|below|less than|at most|up to|not more than|no more than)\s*(?:\$|₹|USD\s*|INR\s*)?([\d,]+(?:\.\d{1,2})?)/i,
    /\b(?:listing|listed)\s+price\s+(?:is\s+)?(?:under|below|less than|at most|up to|not more than|no more than)\s*(?:\$|₹|USD\s*|INR\s*)?([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const pattern of explicitPatterns) {
    const captured = pattern.exec(text)?.[1];
    if (!captured) continue;
    const amount = Number(captured.replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0 && amount <= 1_000_000) return amount;
  }

  for (const mention of extractPriceMentions(text)) {
    const prefix = text.slice(Math.max(0, mention.index - 80), mention.index);
    const suffix = text.slice(mention.end, Math.min(text.length, mention.end + 45));
    if (isNonPriceConstraintContext(prefix) || isExplicitItemPriceContext(prefix)) continue;
    if (isLandedTotalContext(prefix, suffix)) continue;
    // A plain "under/below/less than $X" beside a product is a listing-price
    // cap unless the prompt explicitly labels it as a total or budget.
    if (mention.capPhrase) return mention.amount;
  }
  return undefined;
}

/** Parse only a stated landed-total or overall-budget cap. */
function extractBudget(text: string): number | undefined {
  for (const mention of extractPriceMentions(text)) {
    const prefix = text.slice(Math.max(0, mention.index - 80), mention.index);
    const suffix = text.slice(mention.end, Math.min(text.length, mention.end + 45));
    if (isNonPriceConstraintContext(prefix) || isExplicitItemPriceContext(prefix)) continue;
    if (isLandedTotalContext(prefix, suffix)) return mention.amount;
  }
  return undefined;
}

function fieldConstraint(field: string, id: string, description: string, expected: string | number, comparator: string, severity: ConstraintSeverity = "hard"): Constraint {
  return normalizeConstraint({ field, id, description, expected: String(expected), comparator, severity }, 0);
}

/** Transparent no-key fallback: useful during setup, never labelled as AI. */
export function ruleBasedIntentCompilation(intent: string): IntentCompilation {
  const text = intent.trim();
  const lower = text.toLowerCase();
  const currency: Currency = /(?:\binr\b|\brupees?\b|₹)/i.test(text) ? "INR" : "USD";
  const max = extractBudget(text);
  const itemPriceCap = extractCatalogItemPriceLimit(text);
  const constraints: Constraint[] = [];
  if (max !== undefined) constraints.push(fieldConstraint("total", "max-landed-total", `Final landed total must be at most ${max.toFixed(2)} ${currency}.`, max, "lte"));
  if (itemPriceCap !== undefined) constraints.push(fieldConstraint("attributes.itemPrice", "max-catalog-item-price", `Catalog item price must be at most ${itemPriceCap.toFixed(2)} ${currency}; shipping and tax are not included.`, itemPriceCap, "lte"));
  const ram = text.match(/(?:at least|minimum|min\.?|with)\s*(\d{1,3})\s*(?:gb\s*)?(?:ram|memory)\b/i) ?? text.match(/\b(\d{1,3})\s*gb\s*ram\b/i);
  const ramValue = ram?.[1];
  if (ramValue !== undefined && ramValue.length > 0) {
    constraints.push(fieldConstraint("attributes.ramGb", "minimum-ram", `At least ${ramValue} GB RAM is required.`, Number(ramValue), "gte"));
  }
  if (/\brefurbished\b/i.test(text)) constraints.push(fieldConstraint("attributes.condition", "condition-refurbished", "Item must be refurbished.", "refurbished", "eq"));
  else if (/\bnew\b/i.test(text)) constraints.push(fieldConstraint("attributes.condition", "condition-new", "Item must be new.", "new", "eq"));
  if (/\bin stock\b|\bavailable now\b/i.test(text)) constraints.push(fieldConstraint("attributes.availability", "in-stock", "Offer must be in stock.", "InStock", "eq"));
  const delivery = text.match(/(?:deliver(?:ed|y)?|arrive|arrival)\s+(?:by|before|on or before)\s+(20\d{2}-\d{2}-\d{2})/i) ?? text.match(/\bby\s+(20\d{2}-\d{2}-\d{2})/i);
  const deliveryDate = delivery?.[1];
  if (deliveryDate !== undefined && deliveryDate.length > 0) {
    constraints.push(fieldConstraint("deliveryDate", "delivery-deadline", `Delivery must be on or before ${deliveryDate}.`, deliveryDate, "lte"));
  }
  const returnDays = text.match(/(?:at least|minimum|min\.?|over)\s*(\d{1,4})\s*(?:day|days)\s*(?:return|returns|return window)/i) ?? text.match(/\b(\d{1,4})[- ]day\s+(?:return|returns|return window)\b/i) ?? text.match(/(?:return|returns|return window)[^.;]{0,30}?(\d{1,4})\s*days/i);
  const returnDaysValue = returnDays?.[1];
  if (returnDaysValue !== undefined && returnDaysValue.length > 0) {
    constraints.push(fieldConstraint("returnWindowDays", "minimum-returns", `Return window must be at least ${returnDaysValue} days.`, Number(returnDaysValue), "gte"));
  }
  const shipping = text.match(/(?:shipping|delivery fee|shipping fee)[^.;]{0,32}?(?:at most|under|below|no more than|less than|<=?)\s*(?:\$|₹)?\s*(\d+(?:\.\d{1,2})?)/i);
  const shippingAmount = shipping?.[1];
  if (shippingAmount !== undefined && shippingAmount.length > 0) {
    constraints.push(fieldConstraint("shippingFee", "maximum-shipping", `Shipping must be no more than ${shippingAmount} ${currency}.`, Number(shippingAmount), "lte"));
  }
  const brand = text.match(/\bprefer(?:ably)?\s+(?:a\s+)?([A-Z][A-Za-z0-9-]{1,24})\b/i);
  const preferredBrand = brand?.[1];
  if (preferredBrand !== undefined && preferredBrand.length > 0) {
    constraints.push(fieldConstraint("attributes.brand", "preferred-brand", `Prefer ${preferredBrand} when other requirements are satisfied.`, preferredBrand, "eq", "soft"));
  }
  if (constraints.length === 0) throw new Error("I could not extract an enforceable purchase rule. Add a maximum budget, a must-have feature, a delivery deadline, or a shipping/returns requirement.");
  if (!constraints.some((constraint) => constraint.field === "currency")) constraints.push(fieldConstraint("currency", "currency-match", `Offer currency must be ${currency}.`, currency, "eq"));

  let searchQuery = text
    .replace(/\bwith\s+(?:a\s+)?(?:final|landed|checkout|overall|all[- ]in|grand)?\s*total\s*(?:must be|is|of)?\s*(?:under|below|less than|at most|up to|no more than|<=?)\s*(?:\$|₹)?\s*[\d,]+(?:\.\d{1,2})?\s*(?:USD|INR)?/ig, " ")
    .replace(/\b(?:including|includes?|plus)\s+(?:(?:shipping|delivery|tax|fees?)(?:\s*(?:and|,)\s*)?)+/ig, " ")
    .replace(/\b(?:with\s+)?(?:at least|minimum|min\.?)\s*\d{1,3}\s*(?:gb\s*)?(?:ram|memory)\b/ig, " ")
    .replace(/\b(?:in stock|available now)\b/ig, " ")
    .replace(/\b(?:delivered|delivery|arrive|arrival)\s+(?:by|before|on or before)\s+20\d{2}-\d{2}-\d{2}\b/ig, " ")
    .replace(/\b\d{1,4}[- ]day\s+(?:return window|returns?)\b/ig, " ")
    .replace(/\b(?:shipping|shipping fee|delivery fee)\s+(?:under|below|at most|no more than|less than|<=?)\s*(?:\$|₹)?\s*\d+(?:\.\d{1,2})?/ig, " ")
    .replace(/\b(?:and\s+)?(?:a\s+)?(?:final|landed)?\s*total\s+(?:under|below|less than|at most|up to|no more than|<=?)\s*(?:\$|₹)?\s*[\d,]+(?:\.\d{1,2})?\s*(?:USD|INR)?/ig, " ")
    .replace(/\b(?:prefer|preferably)\s+(?:a\s+)?[A-Z][A-Za-z0-9-]{1,24}\b/ig, " ")
    .replace(/(?:under|below|less than|at most|up to|max(?:imum)?(?: budget)?|budget(?: of| is| around)?|not more than)\s*(?:\$|₹|USD\s*|INR\s*)?[\d,]+(?:\.\d{1,2})?\s*(?:USD|INR)?/ig, " ")
    .replace(/\b(?:catalog\s+item|listing|listed|item)\s+price\b/ig, " ")
    .replace(/\b(?:find|search for|look for|please find|i want|i need|buy me|the|a|an|and|or|final|landed|total|return window|returns?|shipping fee|shipping|delivery fee|catalog|item|price|listing|listed)\b/ig, " ")
    .replace(/[.,;:]+/g, " ")
    .replace(/\s+/g, " ").trim();
  if (!searchQuery) searchQuery = text;
  const productMatch = searchQuery.match(/\b(laptops?|notebooks?|headphones?|phones?|smartphones?|monitors?|tablets?|cameras?|chairs?|backpacks?|keyboards?|mice|mouse|chargers?|printers?|projectors?|suitcases?|watches|desk lamps?|standing desks?|routers?|speakers?)\b/i);
  const productTerm = productMatch?.[0];
  if (productMatch && productMatch.index !== undefined && productTerm) {
    const ignored = new Set(["find", "search", "for", "look", "please", "buy", "me", "a", "an", "the", "with", "at", "least", "and", "or", "require", "required", "in", "stock", "available", "availability", "return", "returns", "window", "shipping", "fee", "delivery", "delivered", "by", "before", "under", "below", "total", "final", "landed", "budget", "prefer", "preferably", "usd", "inr"]);
    const leadingTokens = searchQuery.slice(0, productMatch.index).split(/\s+/).filter((token) => token && !ignored.has(token.toLowerCase()) && !/^\d/.test(token)).slice(-3);
    searchQuery = [...leadingTokens, productTerm].join(" ").slice(0, 180);
  }
  searchQuery = searchQuery.slice(0, 180);
  const nouns = lower.match(/\b(laptop|notebook|headphones|phone|smartphone|monitor|tablet|camera|chair|backpack|keyboard|mouse|charger)\b/);
  const noun = nouns?.[1];
  const productTitle = /\bwireless mouse\b/i.test(text) ? "Wireless Mouse"
    : /\busb[ -]?c charger\b/i.test(text) ? "USB-C Charger"
    : /\bwireless headphones?\b/i.test(text) ? "Wireless Headphones"
    : noun ? noun.replace(/^\w/, (char) => char.toUpperCase()) : undefined;
  const title = productTitle ? `Purchase pact · ${productTitle}` : "Your purchase pact";
  const assumptions: string[] = [];
  if (!/(\$|₹|\bUSD\b|\bINR\b|\brupees?\b)/i.test(text)) assumptions.push(`Currency wasn't explicit; this draft defaults to ${currency}. Confirm it before using the pact.`);
  if (max === undefined && itemPriceCap === undefined) assumptions.push("No explicit maximum total or catalog item-price cap was detected.");
  const unverifiedRequirements = [
    "Channel3 catalog data may not establish final landed total, shipping, delivery date or return window.",
    "Any hard requirement with missing, stale or conflicting evidence remains ineligible.",
  ];
  const pact = sanitizePurchasePact({ id: `purchase-pact-${randomUUID()}`, currency, maxTotalAmount: max, constraints });
  return { title, searchQuery, assumptions, unverifiedRequirements, compiler: "RULE_BASED_FALLBACK", model: "local-parser", pact };
}
