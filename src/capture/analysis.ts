// DSP helpers for the D-13 audio-verification harness: assert that captured
// audio actually contains the groove we pushed (onsets on the grid, ghosts
// quieter than accents, swing where expected). Kept dependency-free — these
// same primitives are a head start for the mouthed-bassline idea in IDEAS.md.

const HOP_SEC = 0.005; // envelope hop ≈ 5 ms → onset timing resolution
const REFRACTORY_SEC = 0.05; // ignore re-triggers within 50 ms of an onset

/** Short-window RMS envelope, one value per hop. */
function envelope(samples: Float32Array, sampleRate: number): Float64Array {
  const hop = Math.max(1, Math.round(HOP_SEC * sampleRate));
  const n = Math.floor(samples.length / hop);
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const start = i * hop;
    for (let j = start; j < start + hop; j++) sum += samples[j] * samples[j];
    env[i] = Math.sqrt(sum / hop);
  }
  return env;
}

/**
 * Energy-rise onset detection. Returns onset times in seconds.
 * An onset is a hop where the envelope jumps well above both the recent
 * local level and the global noise floor.
 */
export function detectOnsets(samples: Float32Array, sampleRate: number): number[] {
  const env = envelope(samples, sampleRate);
  if (env.length === 0) return [];
  const sorted = [...env].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.5)]; // median = noise floor
  const peak = sorted[sorted.length - 1];
  if (peak < 1e-4) return []; // effectively silence
  // 4% of peak: real drum-sample decay tails sit ~2% of the hit's transient and
  // must not re-trigger, while ghost notes (vel 0.2+) land well above this.
  const threshold = Math.max(floor * 3, peak * 0.04);

  const onsets: number[] = [];
  const refractoryHops = Math.round(REFRACTORY_SEC / HOP_SEC);
  let lastOnsetHop = -Infinity;
  for (let i = 1; i < env.length; i++) {
    const rise = env[i] > env[i - 1] * 2;
    if (env[i] > threshold && rise && i - lastOnsetHop > refractoryHops) {
      onsets.push(i * HOP_SEC);
      lastOnsetHop = i;
    }
  }
  return onsets;
}

/** RMS of a window centred on timeSec — compares hit loudness (ghost vs accent). */
export function rmsAround(
  samples: Float32Array,
  sampleRate: number,
  timeSec: number,
  windowSec = 0.05,
): number {
  const start = Math.max(0, Math.round((timeSec - 0.005) * sampleRate));
  const end = Math.min(samples.length, start + Math.round(windowSec * sampleRate));
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (end - start));
}

export interface GridMatch {
  matched: Array<{ grid: number; onset: number; err: number }>;
  missed: number[];
  extra: number[];
  meanAbsErr: number;
}

/**
 * Greedily pair detected onsets with expected grid times within tol.
 * Unit-agnostic: onsets, grid, tol, and the returned errors share whatever
 * unit the caller uses (seconds or ms), as long as it's consistent.
 */
export function matchOnsetsToGrid(onsets: number[], grid: number[], tol: number): GridMatch {
  const remaining = [...onsets];
  const matched: GridMatch["matched"] = [];
  const missed: number[] = [];
  for (const g of grid) {
    let bestIdx = -1;
    let bestErr = Infinity;
    remaining.forEach((o, i) => {
      const err = Math.abs(o - g);
      if (err < bestErr) {
        bestErr = err;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0 && bestErr <= tol) {
      matched.push({ grid: g, onset: remaining[bestIdx], err: bestErr });
      remaining.splice(bestIdx, 1);
    } else {
      missed.push(g);
    }
  }
  const meanAbsErr = matched.length
    ? matched.reduce((s, m) => s + m.err, 0) / matched.length
    : 0;
  return { matched, missed, extra: remaining, meanAbsErr };
}

/** Median inter-onset interval in seconds (0 if fewer than 2 onsets). */
export function medianInterval(onsets: number[]): number {
  if (onsets.length < 2) return 0;
  const intervals = onsets.slice(1).map((t, i) => t - onsets[i]).sort((a, b) => a - b);
  return intervals[Math.floor(intervals.length / 2)];
}

/** Encode Float32 mono PCM as a 16-bit WAV file. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * (clamped < 0 ? 32768 : 32767)), 44 + i * 2);
  }
  return buf;
}
