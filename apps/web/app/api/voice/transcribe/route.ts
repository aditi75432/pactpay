import { NextResponse } from "next/server";
import { isAcceptedWav } from "@pactpay/pact-core/wav";
import { aiTimeoutMs, metaApiProvider } from "../../../../../../lib/llm-provider";
import { enforceRateLimit } from "../../../../lib/request-guard";
import { requireLogin } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 3 * 1024 * 1024;
const MODEL = "muse-voice-transcribe-1.0";

/**
 * Speak your purchase. The browser records the microphone and sends a mono 16-bit WAV; Meta's Muse Voice Transcribe
 * turns it into text. The transcript only fills the "what do you want to buy" box: the shopper still reviews and
 * approves the rules it becomes, and the transcript carries no authority over any payment.
 */
export async function POST(request: Request) {
  const loginDenied = await requireLogin();
  if (loginDenied) return loginDenied;
  const limited = enforceRateLimit(request, "voice-transcribe", 20, 10 * 60_000);
  if (limited) return limited;

  const provider = metaApiProvider();
  if (!provider) return NextResponse.json({ error: "Voice input needs the Meta Model API (set MODEL_API_KEY)." }, { status: 503 });

  const audio = new Uint8Array(await request.arrayBuffer());
  if (audio.length === 0 || audio.length > MAX_BYTES) return NextResponse.json({ error: "Record between 1 and about 60 seconds of audio." }, { status: 413 });
  if (!isAcceptedWav(audio)) return NextResponse.json({ error: "Send a mono 16-bit WAV at 16 or 24 kHz." }, { status: 415 });

  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ model: MODEL, audioEncoding: "WAV", mode: "PUSH_TO_TALK" })], { type: "application/json" }), "request.json");
  form.append("audio", new Blob([audio], { type: "audio/wav" }), "speech.wav");
  try {
    const response = await fetch(`${provider.baseUrl}/asr/transcribe`, {
      method: "POST", headers: { Authorization: `Bearer ${provider.apiKey}`, Accept: "application/json" },
      body: form, cache: "no-store", signal: AbortSignal.timeout(aiTimeoutMs(30_000, 5_000, 45_000)),
    });
    if (!response.ok) {
      console.error("Voice transcription failed", response.status);
      return NextResponse.json({ error: response.status === 401 || response.status === 403 ? "Meta rejected the API key for voice transcription." : "Couldn't transcribe that. Try again." }, { status: 502 });
    }
    const payload = await response.json() as { transcript?: unknown; audioDurationMs?: unknown };
    const transcript = typeof payload.transcript === "string" ? payload.transcript.trim().slice(0, 1200) : "";
    if (!transcript) return NextResponse.json({ error: "I didn't catch anything. Try speaking a little closer to the microphone." }, { status: 422 });
    return NextResponse.json({ transcript, audioDurationMs: typeof payload.audioDurationMs === "number" ? payload.audioDurationMs : null, model: MODEL }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't reach Meta's transcription service. Try again." }, { status: 502 });
  }
}
