import {
  EMPTY_READING,
  inspectCheckout,
  parseCheckoutReading,
  type CheckoutReading,
  type Inspection,
  type InspectionOutcome,
  type InspectionRule,
} from "./checkout-inspection";
import { normalizeUntrusted, scanUntrustedText, type InjectionFinding } from "./untrusted-text";

/**
 * Page Guard: the engine behind the PactPay Guard browser extension.
 *
 * The extension runs inside the shopper's real browser tab and sends PactPay two kinds of evidence:
 *
 *   1. CODE evidence: what the page's DOM says (itemized charges, the total, and any text that a human can't
 *      see but an AI agent reading the page would). A deterministic reader in the extension produces it.
 *   2. PIXEL evidence (optional): a screenshot of what the shopper actually sees, read by a vision model.
 *
 * Each reader catches what the other can't. Code sees invisible instructions aimed at an agent; pixels see
 * CSS-drawn fees that never appear in the page text. If they disagree about the money, nothing is called safe.
 *
 * Nothing in this file calls a model or the network. It only compares data against the rules the shopper approved.
 * Unknown is never safe.
 */

/** Text that exists in the page but is not visible to a human (white-on-white, 0px, off-screen, aria-hidden, comments...). */
export interface HiddenTextItem {
  text: string;
  /** How it was hidden, e.g. "opacity:0", "off-screen", "font-size:0", "same colour as background", "html-comment". */
  how: string;
}

/** Text drawn by CSS (::before / ::after) that is visible on screen but absent from the page text. */
export interface PseudoTextItem {
  text: string;
  where: string;
}

export interface PageEvidence {
  /** The extension's deterministic reading of the page's order summary. */
  dom: CheckoutReading;
  hidden: HiddenTextItem[];
  pseudo: PseudoTextItem[];
  /** Page URL host, for display. Never used to decide. */
  host: string | null;
}

export type FindingKind = "hidden-instruction" | "hidden-text" | "css-charge" | "invisible-characters";

export interface GuardFinding {
  kind: FindingKind;
  /** Plain-English label for the UI. */
  title: string;
  excerpt: string;
  how: string;
  /** Hidden instructions and CSS-drawn charges block. Odd-but-harmless hidden text is only reported. */
  blocking: boolean;
}

export type GuardConfidence = "basic" | "cross-checked";

export interface CrossCheck {
  performed: boolean;
  /** null when no vision reading was available. */
  agree: boolean | null;
  notes: string[];
}

export interface GuardVerdict {
  outcome: InspectionOutcome;
  headline: string;
  confidence: GuardConfidence;
  inspection: Inspection;
  /** The vision reader's own inspection, when a screenshot was read. */
  visionInspection: Inspection | null;
  findings: GuardFinding[];
  crossCheck: CrossCheck;
  /** Every reason the shopper should see, most serious first. */
  reasons: string[];
  /** The money picture the guard used (the DOM reading, plus any CSS-drawn charges). */
  observed: { total: number | null; itemPrice: number | null; shipping: number | null; tax: number | null; fees: number; currency: string | null };
}

const MONEY_IN_TEXT = /(?:[$€£₹]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:usd|eur|gbp|inr)\b)/i;
const ZERO_WIDTH = /[\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;
const MAX_HIDDEN_ITEMS = 40;
const MAX_ITEM_CHARS = 400;

function clean(value: unknown, max = MAX_ITEM_CHARS): string {
  // eslint-disable-next-line no-control-regex
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Turns untrusted extension output into bounded, typed evidence. Anything malformed is dropped, never guessed. */
export function parsePageEvidence(raw: unknown): PageEvidence {
  const record = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const domRecord = typeof record.dom === "object" && record.dom !== null && !Array.isArray(record.dom) ? record.dom as Record<string, unknown> : null;
  // The extension only reports a page it recognised as a checkout; fail closed if it didn't say so.
  const dom = domRecord ? parseCheckoutReading({ ...domRecord, readable: domRecord.readable === true }).reading : { ...EMPTY_READING };
  const hidden = (Array.isArray(record.hidden) ? record.hidden : []).slice(0, MAX_HIDDEN_ITEMS).flatMap((item): HiddenTextItem[] => {
    const r = typeof item === "object" && item !== null ? item as Record<string, unknown> : null;
    const text = r ? clean(r.text) : "";
    return text ? [{ text, how: clean(r?.how, 60) || "hidden" }] : [];
  });
  const pseudo = (Array.isArray(record.pseudo) ? record.pseudo : []).slice(0, MAX_HIDDEN_ITEMS).flatMap((item): PseudoTextItem[] => {
    const r = typeof item === "object" && item !== null ? item as Record<string, unknown> : null;
    const text = r ? clean(r.text, 160) : "";
    return text ? [{ text, where: clean(r?.where, 60) || "css" }] : [];
  });
  return { dom, hidden, pseudo, host: clean(record.host, 120) || null };
}

/** Findings from text a human can't see. Honest pages almost never hide text, so any instruction-shaped match blocks. */
export function hiddenTextFindings(hidden: readonly HiddenTextItem[]): GuardFinding[] {
  const findings: GuardFinding[] = [];
  const seen = new Set<string>();
  for (const item of hidden) {
    const normalized = normalizeUntrusted(item.text);
    if (!normalized) continue;
    const scans: InjectionFinding[] = scanUntrustedText(item.text);
    if (scans.length > 0) {
      const excerpt = normalized.length > 200 ? `${normalized.slice(0, 197)}...` : normalized;
      const key = `i|${excerpt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        kind: "hidden-instruction", title: "Invisible text is giving instructions to an AI agent",
        excerpt, how: item.how, blocking: true,
      });
      continue;
    }
    const zeroWidthCount = (item.text.match(ZERO_WIDTH) ?? []).length;
    if (zeroWidthCount >= 6) {
      findings.push({ kind: "invisible-characters", title: "Text contains invisible characters", excerpt: normalized.slice(0, 120), how: item.how, blocking: true });
      continue;
    }
    // Hidden, but not instruction-shaped (a skip link, a screen-reader label). Reported, not blocked.
    if (normalized.length >= 25 && !seen.has(`h|${normalized}`)) {
      seen.add(`h|${normalized}`);
      findings.push({ kind: "hidden-text", title: "Text on the page is hidden from view", excerpt: normalized.slice(0, 120), how: item.how, blocking: false });
    }
  }
  return findings;
}

/** CSS-drawn charges: money that appears on screen but is not in the page's text. A DOM-only reader can't see it. */
export function cssChargeFindings(pseudo: readonly PseudoTextItem[]): GuardFinding[] {
  return pseudo.filter((item) => MONEY_IN_TEXT.test(item.text)).map((item) => ({
    kind: "css-charge" as const,
    title: "A charge is drawn by CSS and is not in the page's text",
    excerpt: item.text.slice(0, 120), how: item.where, blocking: true,
  }));
}

const RANK: Record<InspectionOutcome, number> = { SAFE_TO_PAY: 0, CANNOT_VERIFY: 1, DO_NOT_PAY: 2 };
const worst = (...outcomes: InspectionOutcome[]): InspectionOutcome => outcomes.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "SAFE_TO_PAY" as InspectionOutcome);
const near = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) <= 0.02;
const fees = (reading: CheckoutReading) => reading.otherFees.reduce((sum, fee) => sum + fee.amount, 0);

/** Do the code reading and the pixel reading describe the same money? Labels are ignored: one reader may say "Handling", the other "Service fee". */
export function crossCheckReadings(dom: CheckoutReading, vision: CheckoutReading | null): CrossCheck {
  if (!vision) return { performed: false, agree: null, notes: [] };
  const notes: string[] = [];
  if (!vision.readable) return { performed: true, agree: false, notes: ["The screenshot didn't look like a readable checkout page."] };
  if (!near(dom.total, vision.total)) notes.push(`The page's code says the total is ${dom.total === null ? "unknown" : dom.total.toFixed(2)}, but the screen shows ${vision.total === null ? "unknown" : vision.total.toFixed(2)}.`);
  if (dom.itemPrice !== null && vision.itemPrice !== null && !near(dom.itemPrice, vision.itemPrice)) notes.push(`The item price differs between the page's code (${dom.itemPrice.toFixed(2)}) and the screen (${vision.itemPrice.toFixed(2)}).`);
  if (dom.shipping !== null && vision.shipping !== null && !near(dom.shipping, vision.shipping)) notes.push("Shipping differs between the page's code and the screen.");
  if (dom.tax !== null && vision.tax !== null && !near(dom.tax, vision.tax)) notes.push("Tax differs between the page's code and the screen.");
  if (!near(fees(dom), fees(vision))) notes.push(`Extra fees differ: the code lists ${fees(dom).toFixed(2)}, the screen shows ${fees(vision).toFixed(2)}.`);
  if (dom.currency && vision.currency && dom.currency !== vision.currency) notes.push("The currency differs between the page's code and the screen.");
  return { performed: true, agree: notes.length === 0, notes };
}

export interface GuardInput {
  evidence: PageEvidence;
  /** The screenshot reading, already parsed and bounded. Null when no screenshot was read. */
  vision: CheckoutReading | null;
  rules: readonly InspectionRule[];
}

/**
 * The verdict. Worst-of: hidden instructions and CSS-drawn charges block; the code reading and the screenshot
 * reading are each inspected against the shopper's rules; and if both exist they must describe the same money.
 */
export function guardPage(input: GuardInput): GuardVerdict {
  const { evidence, vision, rules } = input;
  const findings = [...hiddenTextFindings(evidence.hidden), ...cssChargeFindings(evidence.pseudo)];
  const blocking = findings.filter((finding) => finding.blocking);

  // CSS-drawn money is real money on screen. Fold it into the code reading so the arithmetic sees it.
  const cssFee = evidence.pseudo.filter((item) => MONEY_IN_TEXT.test(item.text)).flatMap((item) => {
    const match = /(\d[\d,]*(?:\.\d{1,2})?)/.exec(item.text);
    const amount = match ? Number(match[1]!.replace(/,/g, "")) : NaN;
    return Number.isFinite(amount) ? [{ label: item.text.slice(0, 40), amount }] : [];
  });
  // Money drawn by CSS is charged "at payment", so it counts toward what the shopper will really pay. Without this the
  // arithmetic would say the total is *lower* than its lines, which is the wrong way round.
  const cssTotal = Math.round(cssFee.reduce((sum, fee) => sum + fee.amount, 0) * 100) / 100;
  const dom: CheckoutReading = {
    ...evidence.dom,
    otherFees: [...evidence.dom.otherFees, ...cssFee].slice(0, 8),
    total: evidence.dom.total === null ? null : Math.round((evidence.dom.total + cssTotal) * 100) / 100,
  };

  const codeInspection = inspectCheckout(dom, rules);
  const visionInspection = vision ? inspectCheckout(vision, rules) : null;
  const crossCheck = crossCheckReadings(dom, vision);

  const outcomes: InspectionOutcome[] = [codeInspection.outcome];
  if (visionInspection) outcomes.push(visionInspection.outcome);
  if (blocking.length > 0) outcomes.push("DO_NOT_PAY");
  if (crossCheck.performed && crossCheck.agree === false) outcomes.push("CANNOT_VERIFY");
  const outcome = worst(...outcomes);

  const reasons: string[] = [];
  for (const finding of blocking) reasons.push(`${finding.title}: "${finding.excerpt}" (${finding.how}). It was treated as hostile and ignored.`);
  for (const reason of codeInspection.reasons) reasons.push(reason);
  if (visionInspection) for (const reason of visionInspection.reasons) if (!reasons.includes(reason)) reasons.push(reason);
  for (const note of crossCheck.notes) reasons.push(`The page's code and the screenshot disagree. ${note}`);

  const headline = outcome === "SAFE_TO_PAY"
    ? "Safe to pay. This checkout matches what you approved."
    : outcome === "DO_NOT_PAY"
      ? "Do not pay. This checkout doesn't match what you approved."
      : "Can't verify. Don't pay until it's confirmed.";

  return {
    outcome, headline,
    confidence: vision ? "cross-checked" : "basic",
    inspection: codeInspection, visionInspection, findings, crossCheck, reasons,
    observed: { total: dom.total, itemPrice: dom.itemPrice, shipping: dom.shipping, tax: dom.tax, fees: Math.round(fees(dom) * 100) / 100, currency: dom.currency },
  };
}

/** Builds the rules for a shopper who only set a budget (Quick Guard, no approved Purchase Pact). */
export function budgetRules(maxTotal: number, currency = "USD"): InspectionRule[] {
  const cap = Number.isFinite(maxTotal) && maxTotal > 0 ? Math.min(maxTotal, 1_000_000) : 0;
  return [
    { id: "system.budget_cap", label: `Total must stay within your $${cap.toFixed(2)} budget`, hard: true, field: "total", comparator: "lte", expected: cap },
    { id: "currency", label: `Priced in ${currency}`, hard: true, field: "currency", comparator: "eq", expected: currency },
  ];
}
