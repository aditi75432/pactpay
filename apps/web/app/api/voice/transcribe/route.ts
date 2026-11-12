import { NextResponse } from "next/server";
import { isAcceptedWav } from "@pactpay/pact-core/wav";
import { aiTimeoutMs, groqSpeechConfig, metaApiProvider } from "../../../../../../lib/llm-provider";
import { enforceRateLimit } from "../../../../lib/request-guard";
import { requireLogin } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 3 * 1024 * 1024;
const META_MODEL = "muse-voice-transcribe-1.0";

export async function POST(request: Request) {
  const loginDenied = await requireLogin();
  if (loginDenied) return loginDenied;
  const limited = enforceRateLimit(request, "voice-transcribe", 20, 10 * 60_000);
  if (limited) return limited;

  const audio = new Uint8Array(await request.arrayBuffer());
  if (audio.length === 0 || audio.length > MAX_BYTES) return NextResponse.json({ error: "Record between 1 and about 60 seconds of audio." }, { status: 413 });
  if (!isAcceptedWav(audio)) return NextResponse.json({ error: "Send a mono 16-bit WAV at 16 or 24 kHz." }, { status: 415 });

  const groq = groqSpeechConfig();
  if (process.env.AI_PROVIDER?.trim().toLowerCase() === "groq" && groq) {
    const form = new FormData();
    form.append("file", new Blob([audio], { type: "audio/wav" }), "speech.wav");
    form.append("model", groq.model);
    form.append("response_format", "json");
    try {
      const response = await fetch(`${groq.baseUrl}/audio/transcriptions`, {
        method: "POST", headers: { Authorization: `Bearer ${groq.apiKey}` },
        body: form, cache: "no-store", signal: AbortSignal.timeout(aiTimeoutMs(20_000, 5_000, 45_000)),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error("Groq voice transcription failed", response.status, detail.slice(0, 500));
        return NextResponse.json({ error: response.status === 401 || response.status === 403 ? "The speech service rejected the configured API key." : "Couldn't transcribe that. Try again." }, { status: 502 });
      }
      const payload = await response.json() as { text?: unknown };
      const transcript = typeof payload.text === "string" ? payload.text.trim().slice(0, 1200) : "";
      if (!transcript) return NextResponse.json({ error: "I didn't catch anything. Try speaking a little closer to the microphone." }, { status: 422 });
      return NextResponse.json({ transcript, audioDurationMs: null, model: groq.model }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("Groq voice transcription request failed", error instanceof Error ? error.message : "unknown error");
      return NextResponse.json({ error: "Couldn't reach the speech transcription service. Try again." }, { status: 502 });
    }
  }

  const provider = metaApiProvider();
  if (!provider) return NextResponse.json({ error: "Voice input needs a configured speech transcription provider." }, { status: 503 });
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ model: META_MODEL, audioEncoding: "WAV", mode: "PUSH_TO_TALK" })], { type: "application/json" }), "request.json");
  form.append("audio", new Blob([audio], { type: "audio/wav" }), "speech.wav");
  try {
    const response = await fetch(`${provider.baseUrl}/asr/transcribe`, {
      method: "POST", headers: { Authorization: `Bearer ${provider.apiKey}`, Accept: "application/json" },
      body: form, cache: "no-store", signal: AbortSignal.timeout(aiTimeoutMs(30_000, 5_000, 45_000)),
    });
    if (!response.ok) {
      console.error("Meta voice transcription failed", response.status);
      return NextResponse.json({ error: response.status === 401 || response.status === 403 ? "The speech service rejected the configured API key." : "Couldn't transcribe that. Try again." }, { status: 502 });
    }
    const payload = await response.json() as { transcript?: unknown; audioDurationMs?: unknown };
    const transcript = typeof payload.transcript === "string" ? payload.transcript.trim().slice(0, 1200) : "";
    if (!transcript) return NextResponse.json({ error: "I didn't catch anything. Try speaking a little closer to the microphone." }, { status: 422 });
    return NextResponse.json({ transcript, audioDurationMs: typeof payload.audioDurationMs === "number" ? payload.audioDurationMs : null, model: META_MODEL }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the speech transcription service. Try again." }, { status: 502 });
  }
}
