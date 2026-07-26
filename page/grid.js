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
      return { drum: voice.drum, label: DRUM_NAMES[voice.drum] ?? voice.drum, cells };
    });
  // Beat separators: a bar is 4 beats in 4/4 (D-11), so resolution/4 steps per
  // beat — 4 at 16ths, 3 at triplet-12, 8 at 32nds.
  return { rows, steps, bars, resolution, beatLen: resolution / 4 };
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
