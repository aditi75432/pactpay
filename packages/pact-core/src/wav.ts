/**
 * Browser microphone audio to the WAV format Meta's Muse Voice Transcribe accepts:
 * a RIFF/WAVE container, mono, 16-bit integer PCM, at 16 kHz or 24 kHz.
 */
export const VOICE_SAMPLE_RATE = 24_000;

/** Linear-interpolation resampler, good enough for speech. */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const length = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(length);
  const ratio = (input.length - 1) / Math.max(1, length - 1);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    out[i] = input[left]! * (1 - fraction) + input[right]! * fraction;
  }
  return out;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff), true);
  }
  return bytes;
}

/** True when the bytes look like a WAV file Muse Voice Transcribe will accept (mono, 16-bit PCM, 16 or 24 kHz). */
export function isAcceptedWav(bytes: Uint8Array): boolean {
  if (bytes.length < 44) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return false;
  return view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1 && view.getUint16(34, true) === 16 && [16_000, 24_000].includes(view.getUint32(24, true));
}
