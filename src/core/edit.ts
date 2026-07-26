import { parseGroove, type Groove } from "./groove.js";

// Pure toggle merge for grid click-editing (v1.2 FR-2/FR-4). The server owns
// the session groove; a page click is a request that lands here. Like the
// compiler, this is pure core logic: no I/O, input never mutated.

/** New hits land at a solid, audible velocity; nuance stays the LLM's job (D-19). */
export const CLICK_VELOCITY = 0.8;

export type ToggleResult = { ok: true; groove: Groove } | { ok: false; reason: string };

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
