// Pure grid math for the step-sequencer display (v1.1 FR-2/FR-3) — plain JS,
// shared between the browser page and vitest like quantize.js. DOM rendering
// stays in main.js; nothing here may touch the document.

// Display order, top row → bottom row: cymbals/hats up top, kick on the bottom,
// like hardware drum machines and DAW drum editors.
const ROW_ORDER = ["cr", "ch", "sp", "rd", "oh", "hh", "ht", "mt", "lt", "cb", "cp", "rim", "sd", "bd"];

// Full instrument names for row labels (v1.4 FR-7) — display only; the wire
// protocol and click-edit messages keep using the abbreviations.
const DRUM_NAMES = {
  bd: "kick",
  sd: "snare",
  hh: "closed hi-hat",
  oh: "open hi-hat",
  rim: "rimshot",
  cp: "clap",
  lt: "low tom",
  mt: "mid tom",
  ht: "high tom",
  rd: "ride",
  cr: "crash",
  cb: "cowbell",
  ch: "china",
  sp: "splash",
};

/**
 * Build a render model from a parsed groove.
 * @param {object} groove parsed groove JSON (server-validated; hits may lack vel
 *   if a foreign server sent a raw groove — default to full velocity)
 * @returns {{rows: Array<{drum: string, label: string, cells: Array<number|null>}>, steps: number,
 *   bars: number, resolution: number, beatLen: number}}
 */
export function gridModel(groove) {
  const bars = groove.bars ?? 1;
  const resolution = groove.resolution ?? 16;
  const steps = bars * resolution;
  const order = (drum) => {
    const i = ROW_ORDER.indexOf(drum);
    return i === -1 ? ROW_ORDER.length : i;
  };
  const rows = [...(groove.voices ?? [])]
    .sort((a, b) => order(a.drum) - order(b.drum))
    .map((voice) => {
      const cells = Array.from({ length: steps }, () => null);
      for (const hit of voice.hits ?? []) {
        if (Number.isInteger(hit.step) && hit.step >= 0 && hit.step < steps) {
          cells[hit.step] = hit.vel ?? 1;
        }
      }
      return {
        drum: voice.drum,
        label: DRUM_NAMES[voice.drum] ?? voice.drum,
        trackGain: voice.trackGain ?? 1,
        muted: voice.muted ?? false,
        cells,
      };
    });
  // Beat separators: a bar is 4 beats in 4/4 (D-11), so resolution/4 steps per
  // beat — 4 at 16ths, 3 at triplet-12, 8 at 32nds.
  return { rows, steps, bars, resolution, beatLen: resolution / 4 };
}

// Count syllables per beat by resolution (v1.5 FR-5). 16ths count "1 e & a",
// 8ths "1 &", triplet-12 "1 & a"; 24/32 are too dense to name every step, so
// only the beat number is labeled and the rest show a dot.
const COUNTS = { 8: ["", "&"], 12: ["", "&", "a"], 16: ["", "e", "&", "a"] };

/**
 * The drummer's count header (v1.5 FR-5): one entry per step.
 * @param {number} bars
 * @param {number} resolution steps per bar
 * @returns {Array<{label: string, beatStart: boolean, barStart: boolean, bar: number, beat: number}>}
 */
export function countHeader(bars, resolution) {
  const perBeat = resolution / 4;
  const syllables = COUNTS[resolution];
  const cells = [];
  for (let step = 0; step < bars * resolution; step++) {
    const bar = Math.floor(step / resolution) + 1;
    const beat = Math.floor((step % resolution) / perBeat) + 1;
    const sub = step % perBeat;
    const label = sub === 0 ? String(beat) : syllables ? syllables[sub] : "·";
    cells.push({ label, beatStart: sub === 0, barStart: step % resolution === 0, bar, beat });
  }
  return cells;
}

// Click-cycle preview (v1.5 FR-4) — mirrors the server's cycleStep tiers so the
// optimistic cell state matches what the broadcast will confirm.
const CYCLE_TIERS = [0.25, 0.7, 1];

/**
 * The velocity one click ahead of `vel` (null = empty cell → 0.7; ghost → null).
 * @param {number|null} vel
 * @returns {number|null}
 */
export function cycleNext(vel) {
  if (vel === null || vel === undefined) return 0.7;
  let tier = CYCLE_TIERS[0];
  for (const t of CYCLE_TIERS) {
    if (Math.abs(vel - t) < Math.abs(vel - tier)) tier = t;
  }
  if (tier === 0.7) return 1;
  if (tier === 1) return 0.25;
  return null;
}

/**
 * Which step the playhead is on right now. One Strudel cycle = one bar (D-11)
 * and compiled grooves run under .slow(bars), so the pattern position is the
 * scheduler's cycle position mod bars — deterministic in the global cycle
 * count, no sync handshake needed.
 * @param {number} cyclePos scheduler.now()
 * @param {number} bars loop length in bars
 * @param {number} resolution steps per bar
 * @returns {number|null} step index, or null to hide the playhead
 */
export function playheadStep(cyclePos, bars, resolution) {
  if (!Number.isFinite(cyclePos) || cyclePos < 0) return null;
  if (!Number.isFinite(bars) || bars <= 0 || !Number.isFinite(resolution) || resolution <= 0) {
    return null;
  }
  const barPos = cyclePos % bars;
  return Math.min(Math.floor(barPos * resolution), bars * resolution - 1);
}
