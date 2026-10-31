import { NextResponse } from "next/server";
import { enforceRateLimit } from "../../../lib/request-guard";
import { requireLogin } from "../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional AI rewrite of a settlement explanation that PactPay already produced deterministically.
 *
 * The model receives only the finished explanation text. It cannot see or change the decision, has no
 * tools, and its output is discarded unless it introduces no number that is not already in the input.
 * When no key is configured, or anything looks off, the caller simply keeps the deterministic text.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((value) => value.replace(/,/g, "")));
}

export async function POST(request: Request) {
  const loginDenied = await requireLogin();
  if (loginDenied) return loginDenied;
  const limited = enforceRateLimit(request, "explain-ai", 30, 10 * 60_000);
  if (limited) return limited;
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ aiSummary: null, reason: "AI summary is not configured." });

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.headline !== "string" || typeof body.summary !== "string") {
    return NextResponse.json({ error: "headline and summary are required." }, { status: 400 });
  }
  const reasons = Array.isArray(body.reasons) ? body.reasons.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
  const source = [body.headline, body.summary, ...reasons].join("\n").slice(0, 2000);

  const timeoutMs = Math.min(Math.max(Number(process.env.GROQ_TIMEOUT_MS ?? 8_000) || 8_000, 2_000), 15_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content: "You rewrite a payment-safety notice for a shopper in two or three short, friendly sentences. Use only the facts and numbers in the notice. Do not add advice, new numbers, new reasons or promises. Do not mention AI. Never suggest the decision could be different.",
          },
          { role: "user", content: source },
        ],
      }),
    });
    if (!response.ok) return NextResponse.json({ aiSummary: null, reason: "AI summary unavailable." });
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text || text.length > 600) return NextResponse.json({ aiSummary: null, reason: "AI summary rejected." });
    const allowed = numbersIn(source);
    for (const value of numbersIn(text)) {
      if (!allowed.has(value)) return NextResponse.json({ aiSummary: null, reason: "AI summary rejected: it introduced a figure that was not in the notice." });
    }
    return NextResponse.json({ aiSummary: text, model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b" });
  } catch {
    return NextResponse.json({ aiSummary: null, reason: "AI summary unavailable." });
  } finally {
    clearTimeout(timer);
  }
}
