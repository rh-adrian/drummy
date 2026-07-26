import { parseGroove, type Groove } from "./groove.js";

// Pure toggle merge for grid click-editing (v1.2 FR-2/FR-4). The server owns
// the session groove; a page click is a request that lands here. Like the
// compiler, this is pure core logic: no I/O, input never mutated.

/** New hits land at a solid, audible velocity; nuance stays the LLM's job (D-19). */
export const CLICK_VELOCITY = 0.8;

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
 * Same guards as toggleStep: known voice, in-range step, groove re-validated,
 * a voice losing its last hit is dropped, an empty groove is refused.
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
  const voices = groove.voices
    .map((v) => {
      if (v.drum !== drum) return v;
      const others = v.hits.filter((h) => h.step !== step);
      const hits =
        next === null
          ? others
          : [...others, { step, vel: next, micro: current?.micro ?? 0 }].sort((a, b) => a.step - b.step);
      return { ...v, hits };
    })
    .filter((v) => v.hits.length > 0);
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

/**
 * Toggle the hit at (drum, step): present → removed (a voice losing its last
 * hit is dropped), absent → added at CLICK_VELOCITY. Only drums that already
 * have a voice in the groove can be toggled — the grid shows no other rows.
 */
export function toggleStep(groove: Groove, drum: string, step: number): ToggleResult {
  const steps = groove.bars * groove.resolution;
  if (!Number.isInteger(step) || step < 0 || step >= steps) {
    return { ok: false, reason: `step ${step} out of range 0..${steps - 1}` };
  }
  const voice = groove.voices.find((v) => v.drum === drum);
  if (!voice) {
    return { ok: false, reason: `no ${drum} voice in the groove` };
  }
  const has = voice.hits.some((h) => h.step === step);
  const voices = groove.voices
    .map((v) => {
      if (v.drum !== drum) return v;
      const hits = has
        ? v.hits.filter((h) => h.step !== step)
        : [...v.hits, { step, vel: CLICK_VELOCITY, micro: 0 }].sort((a, b) => a.step - b.step);
      return { ...v, hits };
    })
    .filter((v) => v.hits.length > 0);
  // Re-validate the merged result — this also refuses edits that would leave
  // the groove empty (a groove needs at least one voice).
  const parsed = parseGroove({ ...groove, voices });
  return parsed.ok ? { ok: true, groove: parsed.groove } : { ok: false, reason: parsed.error };
}
