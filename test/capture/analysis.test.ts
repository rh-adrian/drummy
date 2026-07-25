import { describe, it, expect } from "vitest";
import {
  detectOnsets,
  rmsAround,
  matchOnsetsToGrid,
  medianInterval,
  encodeWavPcm16,
} from "../../src/capture/analysis.js";

const SR = 44100;

/** Synthesize decaying 1 kHz bursts (sharp attack) at the given times. */
function synth(hits: Array<{ t: number; amp: number }>, durationSec: number): Float32Array {
  const out = new Float32Array(Math.ceil(durationSec * SR));
  for (const { t, amp } of hits) {
    const start = Math.round(t * SR);
    const len = Math.round(0.03 * SR);
    for (let i = 0; i < len && start + i < out.length; i++) {
      out[start + i] += amp * Math.exp(-i / (0.005 * SR)) * Math.sin((2 * Math.PI * 1000 * i) / SR);
    }
  }
  return out;
}

describe("detectOnsets", () => {
  it("finds clicks at their times and nothing else", () => {
    const times = [0.1, 0.6, 1.1, 1.6];
    const pcm = synth(times.map((t) => ({ t, amp: 0.8 })), 2);
    const onsets = detectOnsets(pcm, SR);
    expect(onsets).toHaveLength(4);
    onsets.forEach((o, i) => expect(Math.abs(o - times[i])).toBeLessThan(0.01));
  });

  it("still finds quiet (ghost-level) hits", () => {
    const pcm = synth([{ t: 0.2, amp: 0.9 }, { t: 0.7, amp: 0.15 }], 1);
    const onsets = detectOnsets(pcm, SR);
    expect(onsets).toHaveLength(2);
  });

  it("returns nothing for silence", () => {
    expect(detectOnsets(new Float32Array(SR), SR)).toHaveLength(0);
  });
});

describe("rmsAround", () => {
  it("ranks accented hits above ghosts", () => {
    const pcm = synth([{ t: 0.2, amp: 0.9 }, { t: 0.7, amp: 0.2 }], 1);
    const accent = rmsAround(pcm, SR, 0.2);
    const ghost = rmsAround(pcm, SR, 0.7);
    expect(accent).toBeGreaterThan(ghost * 2);
  });
});

describe("matchOnsetsToGrid", () => {
  it("pairs onsets to grid times within tolerance and reports strays", () => {
    const grid = [0, 0.5, 1.0, 1.5];
    const onsets = [0.002, 0.503, 1.004, 1.9]; // last one is a stray, 1.5 missed
    const r = matchOnsetsToGrid(onsets, grid, 0.03);
    expect(r.matched).toHaveLength(3);
    expect(r.missed).toEqual([1.5]);
    expect(r.extra).toEqual([1.9]);
    expect(r.meanAbsErrMs).toBeLessThan(5);
  });
});

describe("medianInterval", () => {
  it("returns the median inter-onset interval", () => {
    expect(medianInterval([0, 0.5, 1.0, 1.52, 2.0])).toBeCloseTo(0.5, 1);
    expect(medianInterval([0])).toBe(0);
  });
});

describe("encodeWavPcm16", () => {
  it("writes a valid 16-bit mono WAV header", () => {
    const pcm = new Float32Array(1000).fill(0.5);
    const wav = encodeWavPcm16(pcm, SR);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(SR); // sample rate
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt16LE(34)).toBe(16); // bit depth
    expect(wav.length).toBe(44 + 1000 * 2);
  });

  it("clips out-of-range samples instead of wrapping", () => {
    const wav = encodeWavPcm16(new Float32Array([2, -2]), SR);
    expect(wav.readInt16LE(44)).toBe(32767);
    expect(wav.readInt16LE(46)).toBe(-32768);
  });
});
