import { describe, expect, it } from "vitest";
import { encodeWav, isAcceptedWav, resample } from "../src/wav";

describe("wav encoding for Muse Voice Transcribe", () => {
  it("writes a mono 16-bit PCM RIFF/WAVE the API accepts", () => {
    const bytes = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1, 2]), 24_000);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WAVE");
    expect(bytes.length).toBe(44 + 6 * 2);
    expect(isAcceptedWav(bytes)).toBe(true);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getInt16(44 + 3 * 2, true)).toBe(32767);
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-32768);
    expect(view.getInt16(44 + 5 * 2, true)).toBe(32767); // clipped, not wrapped
  });
  it("rejects other containers and unsupported sample rates", () => {
    expect(isAcceptedWav(new Uint8Array(10))).toBe(false);
    expect(isAcceptedWav(encodeWav(new Float32Array(4), 44_100))).toBe(false);
    expect(isAcceptedWav(encodeWav(new Float32Array(4), 16_000))).toBe(true);
  });
  it("resamples to the target length", () => {
    const input = new Float32Array(480).map((_, i) => Math.sin(i / 10));
    expect(resample(input, 48_000, 24_000)).toHaveLength(240);
    expect(resample(input, 24_000, 24_000)).toBe(input);
    expect(resample(new Float32Array(0), 48_000, 24_000)).toHaveLength(0);
  });
});
