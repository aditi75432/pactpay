import { modelDisplayName } from "@pactpay/pact-core/ai-labels";
import { inspectionRulesFor, type CheckoutReading, type InspectionRule } from "@pactpay/pact-core/checkout-inspection";
import { budgetRules, guardPage, parsePageEvidence } from "@pactpay/pact-core/page-guard";
import { parseBearerKey } from "@pactpay/pact-core/agent-key";
import { aiTimeoutMs, resolveVisionProvider } from "../../../../../../lib/llm-provider";
import { resolveAgentKey } from "../../../../../../lib/agent-keys";
import { getPactApproval } from "../../../../../../lib/pact-approvals";
import { safePageLocation, saveGuardCheck } from "../../../../../../lib/guard-checks";
import { readPage } from "../../../../lib/checkout-reader";
import { corsJson, corsPreflight } from "../../../../lib/cors";
import { enforceRateLimit } from "../../../../lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PactPay Guard: the endpoint behind the browser extension.
 *
 * The extension reads the shopper's REAL checkout tab and sends evidence here:
 *   - code evidence: the page's itemized charges, plus text a human can't see (hidden) and money drawn by CSS (pseudo)
 *   - pixel evidence (optional): a screenshot of the tab, read by a vision model
 * Fixed code (`guardPage`) compares that evidence with the shopper's rules and returns SAFE_TO_PAY, DO_NOT_PAY or CANNOT_VERIFY.
 * No model decides. A model only ever reads pixels, and its reading is data that must agree with the page's code.
 *
 * Two modes:
 *   pact  Authorization: Bearer ppk_...  The rules come from the shopper's approved Purchase Pact. Vision is allowed. Checks are stored.
 *   quick { budget }                     No account. Code reader only (no model call, no cost), nothing stored.
 */
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_BODY_CHARS = 6_500_000;

export function OPTIONS() {
  return corsPreflight();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "guard-check", 60, 10 * 60_000);
  if (limited) { limited.headers.set("Access-Control-Allow-Origin", "*"); return limited; }

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return corsJson({ error: "That request is too large. Screenshots must be under 4 MB." }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { body = null; }
  if (!isRecord(body)) return corsJson({ error: "Send {evidence, screenshot?, budget?}." }, 400);

  // Who is asking, and which rules apply?
  let rules: InspectionRule[];
  let mode: "pact" | "quick";
  let sessionId: string | null = null;
  let approvalId: string | null = null;
  let rulesTitle: string;
  const key = parseBearerKey(request.headers.get("authorization"));
  if (key) {
    const resolved = await resolveAgentKey(key);
    if (!resolved) return corsJson({ error: "This agent key is invalid, expired or revoked. Create a new one in PactPay and reconnect the extension." }, 401);
    const approval = await getPactApproval(resolved.sessionId, resolved.approvalId);
    if (!approval) return corsJson({ error: "The rules this key was issued for are no longer valid." }, 401);
    rules = inspectionRulesFor(approval.pact_json);
    mode = "pact"; sessionId = resolved.sessionId; approvalId = resolved.approvalId;
    rulesTitle = approval.original_intent?.slice(0, 120) || "Your approved Purchase Pact";
  } else {
    const budget = typeof body.budget === "number" ? body.budget : Number.NaN;
    if (!Number.isFinite(budget) || budget <= 0 || budget > 1_000_000) {
      return corsJson({ error: "Connect your PactPay agent key, or send a budget between 0.01 and 1,000,000 for Quick Guard." }, 401);
    }
    rules = budgetRules(Math.round(budget * 100) / 100);
    mode = "quick";
    rulesTitle = `Quick Guard: budget $${budget.toFixed(2)}`;
  }

  const evidence = parsePageEvidence(body.evidence);

  // Optional pixel reader (pact mode only, unless the operator opts quick mode in). One vision model reads the screenshot.
  let vision: CheckoutReading | null = null;
  let visionNote: string | null = null;
  let visionModel: string | null = null;
  const wantsVision = typeof body.screenshot === "string" && body.screenshot.length > 0;
  const visionAllowed = mode === "pact" || process.env.PACTPAY_GUARD_QUICK_VISION === "1";
  if (wantsVision && !visionAllowed) {
    visionNote = "Quick Guard runs the code reader only. Connect your PactPay key to add the AI screenshot cross-check.";
  } else if (wantsVision) {
    const image = DATA_URL.exec(body.screenshot as string);
    if (!image) visionNote = "The screenshot wasn't a PNG, JPEG or WebP data URL, so only the code reader ran.";
    else if (Math.floor((image[2]!.length * 3) / 4) > MAX_IMAGE_BYTES) visionNote = "The screenshot was over 4 MB, so only the code reader ran.";
    else {
      const provider = resolveVisionProvider();
      if (!provider) visionNote = "No vision-capable AI model is configured, so only the code reader ran.";
      else {
        try {
          const result = await readPage(provider, body.screenshot as string, "Reader: transcribe this checkout independently. Read the merchant, currency, item price, shipping, tax and total from the same order summary. Include every fee, and copy all fine print exactly.", aiTimeoutMs(40_000, 8_000, 60_000));
          vision = result.reading;
          visionModel = modelDisplayName(provider.model);
        } catch (error) {
          console.error("Guard vision read failed", error instanceof Error ? error.message : "unknown error");
          visionNote = "The AI screenshot reader couldn't read the page right now, so only the code reader ran.";
        }
      }
    }
  }

  const verdict = guardPage({ evidence, vision, rules });

  const location = safePageLocation(body.url);
  let checkId: string | null = null;
  if (mode === "pact" && sessionId && location) {
    try {
      checkId = await saveGuardCheck({
        sessionId, approvalId, host: location.host, path: location.path, outcome: verdict.outcome, confidence: verdict.confidence,
        total: verdict.observed.total, currency: verdict.observed.currency, fees: verdict.observed.fees,
        findings: verdict.findings.map((item) => ({ kind: item.kind, title: item.title, excerpt: item.excerpt.slice(0, 160), how: item.how, blocking: item.blocking })),
        reasons: verdict.reasons, readers: vision ? "code+vision" : "code",
      });
    } catch (error) {
      console.error("Guard check not stored", error instanceof Error ? error.message : "unknown error");
    }
  }

  return corsJson({
    id: checkId, mode, rulesTitle,
    rules: rules.map((rule) => ({ id: rule.id, label: rule.label, hard: rule.hard })),
    verdict, visionNote,
    readers: [{ kind: "code", label: "Code reader (page DOM, hidden text, CSS)" }, ...(vision ? [{ kind: "vision", label: `Screenshot reader (${visionModel ?? "vision model"})` }] : [])],
    stored: checkId !== null,
    checkedAt: new Date().toISOString(),
  });
}
