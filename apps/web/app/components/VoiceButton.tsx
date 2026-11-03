"use client";

import { useEffect, useRef, useState } from "react";
import { VOICE_SAMPLE_RATE, encodeWav, resample } from "@pactpay/pact-core/wav";

/**
 * "Say it." Records the microphone, converts it to the 24 kHz mono WAV that Meta's Muse Voice Transcribe accepts,
 * and hands the transcript to the page. Hidden when the deployment has no Meta Model API key.
 */
const MAX_SECONDS = 25;
type State = "idle" | "listening" | "transcribing";

export default function VoiceButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const session = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ai/status", { cache: "no-store" }).then((r) => r.json() as Promise<{ voice?: boolean }>).then((s) => { if (!cancelled) setAvailable(s.voice === true); }).catch(() => undefined);
    return () => { cancelled = true; session.current?.stop(); };
  }, []);

  if (!available || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;

  async function start() {
    setMessage(null);
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch { setMessage("Microphone access was blocked. Allow it in your browser and try again."); return; }

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => { chunks.push(new Float32Array(event.inputBuffer.getChannelData(0))); };
    source.connect(processor);
    processor.connect(context.destination);
    setState("listening"); setSeconds(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) void finish();
    }, 250);
    let finished = false;
    async function finish() {
      if (finished) return;
      finished = true;
      window.clearInterval(timer);
      processor.disconnect(); source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      const rate = context.sampleRate;
      void context.close();
      session.current = null;
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (total < rate * 0.4) { setState("idle"); setMessage("That was too short. Hold on a little longer and speak."); return; }
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
      setState("transcribing");
      try {
        const wav = encodeWav(resample(merged, rate, VOICE_SAMPLE_RATE), VOICE_SAMPLE_RATE);
        const response = await fetch("/api/voice/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Blob([wav as BlobPart], { type: "audio/wav" }) });
        const payload = await response.json() as { transcript?: string; error?: string };
        if (!response.ok || !payload.transcript) throw new Error(payload.error ?? "Couldn't transcribe that.");
        onTranscript(payload.transcript);
        setMessage("Heard by Muse Voice Transcribe. Check the words, then turn them into rules.");
      } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Couldn't transcribe that."); }
      finally { setState("idle"); }
    }
    session.current = { stop: () => void finish() };
  }

  return (
    <div className="pp-voice">
      {state === "listening" ? (
        <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm pp-voice-live" onClick={() => session.current?.stop()}>
          <span className="pp-voice-dot" aria-hidden="true" /> Listening… {seconds}s · tap to finish
        </button>
      ) : (
        <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" onClick={() => void start()} disabled={state === "transcribing"}>
          {state === "transcribing" ? <><span className="pp-spinner pp-spinner-dark" aria-hidden="true" /> Muse is listening back…</> : <>🎙 Say it instead</>}
        </button>
      )}
      <span className="pp-tiny pp-muted" aria-live="polite">{message ?? "Powered by Meta Muse Voice Transcribe"}</span>
    </div>
  );
}
