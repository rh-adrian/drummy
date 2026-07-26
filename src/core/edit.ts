import { parseGroove, type Groove } from "./groove.js";

// Pure merges for page editing (v1.2 clicks → v1.5 cycle/faders → v1.6
// mute/clear). The server owns the session groove; every page control is a
// request that lands here. Like the compiler: no I/O, input never mutated.
// (v1.2's toggleStep and its fixed 0.8 click velocity, D-19, were overturned
// by D-36 and deleted in v1.6 — v1.5 M-final review MINOR-1.)

export type ToggleResult = { ok: true; groove: Groove } | { ok: false; reason: string };

// Click-cycle tiers (v1.5 FR-4, D-36 — overturns D-19's fixed click velocity):
// off → x(0.7) → X(1.0) → g(0.25) → off. LLM-written in-between velocities snap
// to the nearest tier first, then advance.
const CYCLE_TIERS = [0.25, 0.7, 1] as const;

function nearestTier(vel: number): number {
  let best: number = CYCLE_TIERS[0];
  for (const tier of CYCLE_TIERS) {
    if (Math.abs(vel - tier) < Math.abs(vel - best)) best = tier;
  }
  return best;
}

/** The velocity after one click on a cell currently at `vel` (null = empty). */
function nextTier(vel: number | null): number | null {
  if (vel === null) return 0.7;
  switch (nearestTier(vel)) {
    case 0.7:
      return 1;
    case 1:
      return 0.25;
    default:
      return null; // ghost cycles off
  }
}

/**
 * Advance the cell at (drum, step) one click through the velocity cycle.
 * Guards: known voice, in-range integer step, groove re-validated. A voice
 * losing its last hit KEEPS its row (v1.6 D-40 — cleared/emptied channels are
 * legal state).
 */
export function cycleStep(groove: Groove, drum: string, step: number): ToggleResult {
  const steps = groove.bars * groove.resolution;
  if (!Number.isInteger(step) || step < 0 || step >= steps) {
    return { ok: false, reason: `step ${step} out of range 0..${steps - 1}` };
  }
  const voice = groove.voices.find((v) => v.drum === drum);
  if (!voice) {
    return { ok: false, reason: `no ${drum} voice in the groove` };
  }
  const current = voice.hits.find((h) => h.step === step);
  const next = nextTier(current ? current.vel : null);
  const voices = groove.voices.map((v) => {
    if (v.drum !== drum) return v;
    const others = v.hits.filter((h) => h.step !== step);
    const hits =
      next === null
        ? others
        : [...others, { step, vel: next, micro: current?.micro ?? 0 }].sort((a, b) => a.step - b.step);
    return { ...v, hits };
  });
  const parsed = parseGroove({ ...groove, voices });
  return parsed.ok ? { ok: true, groove: parsed.groove } : { ok: false, reason: parsed.error };
}

/**
 * Empty a channel's hits (v1.6 FR-3). The row, fader, and mute state stay —
 * the page's undo covers recovery of the pattern.
 */
export function clearTrack(groove: Groove, drum: string): ToggleResult {
  if (!groove.voices.some((v) => v.drum === drum)) {
    return { ok: false, reason: `no ${drum} voice in the groove` };
  }
  const voices = groove.voices.map((v) => (v.drum === drum ? { ...v, hits: [] } : v));
  const parsed = parseGroove({ ...groove, voices });
  return parsed.ok ? { ok: true, groove: parsed.groove } : { ok: false, reason: parsed.error };
}

/**
 * Enable/disable the groove's fills (v1.7 FR-4, D-49) — the page's transport
 * toggle. Refuses when there's nothing to toggle.
 */
export function setFillsEnabled(groove: Groove, enabled: boolean): ToggleResult {
  if (!groove.fills || groove.fills.length === 0) {
    return { ok: false, reason: "the groove has no fills to toggle" };
  }
  const parsed = parseGroove({ ...groove, fillsEnabled: enabled });
  return parsed.ok ? { ok: true, groove: parsed.groove } : { ok: false, reason: parsed.error };
}

/**
 * Toggle a channel's mute (v1.6 FR-2). Hits and trackGain are untouched so
 * unmuting restores the exact sound.
 */
export function muteTrack(groove: Groove, drum: string): ToggleResult {
  const voice = groove.voices.find((v) => v.drum === drum);
  if (!voice) {
    return { ok: false, reason: `no ${drum} voice in the groove` };
  }
  const voices = groove.voices.map((v) => (v.drum === drum ? { ...v, muted: !v.muted } : v));
  const parsed = parseGroove({ ...groove, voices });
  return parsed.ok ? { ok: true, groove: parsed.groove } : { ok: false, reason: parsed.error };
}

/**
 * Set a voice's mix fader (v1.5 FR-3, D-35/D-39). Pure merge, server-owned.
 */
export function setTrackGain(groove: Groove, drum: string, gain: number): ToggleResult {
  if (!Number.isFinite(gain) || gain < 0 || gain > 1.5) {
    return { ok: false, reason: `trackGain ${gain} out of range 0..1.5` };
  }
  if (!groove.voices.some((v) => v.drum === drum)) {
    return { ok: false, reason: `no ${drum} voice in the groove` };
  }
  const voices = groove.voices.map((v) => (v.drum === drum ? { ...v, trackGain: gain } : v));
  const parsed = parseGroove({ ...groove, voices });
  return parsed.ok ? { ok: true, groove: parsed.groove } : { ok: false, reason: parsed.error };
}

