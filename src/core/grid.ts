import { DRUM_ABBRS } from "./kits.js";
import type { Groove, Voice } from "./groove.js";

// Drum-tab grid notation (v1.4, D-30): one row per drum, one character per step.
// Research-backed representation — LLMs reason over drum grooves far better in
// spatial text grids than in per-voice hit lists (arXiv:2505.08203).

// Letter → velocity tiers, matching the Acoustic kit's real dynamic layers
// (accent→FF, normal→F, soft→MP, ghost→Ghost).
const LETTER_VEL: Record<string, number> = {
  X: 1,
  O: 1, // paper-notation alias for an accent
  x: 0.7,
  o: 0.5,
  g: 0.25,
};

const RESTS = new Set(["-", "."]);
const SEPARATORS = /[| ]/g;

// Same visual order as the page grid (page/grid.js ROW_ORDER): cymbals on top,
// kick at the bottom, like a drum chart. A test in test/core/grid.test.ts
// asserts renderGrid and the page's gridModel agree on row order.
const ROW_ORDER = ["cr", "ch", "sp", "rd", "oh", "hh", "ht", "mt", "lt", "cb", "cp", "rim", "sd", "bd"];

const LEGEND = 'X (accent) x (normal) o (soft) g (ghost), "-" or "." for rests, "|" as a cosmetic beat separator';

export type GridResult = { ok: true; voices: Voice[] } | { ok: false; error: string };

export function gridToVoices(grid: Record<string, string>, bars: number, resolution: number): GridResult {
  const totalSteps = bars * resolution;
  const voices: Voice[] = [];

  for (const [drum, row] of Object.entries(grid)) {
    if (!DRUM_ABBRS.includes(drum)) {
      return { ok: false, error: `grid row "${drum}": unknown drum — valid drums are: ${DRUM_ABBRS.join(", ")}` };
    }
    const steps = row.replace(SEPARATORS, "");
    if (steps.length !== totalSteps) {
      return {
        ok: false,
        error: `grid row "${drum}": ${steps.length} steps but bars=${bars} × resolution=${resolution} needs ${totalSteps} ("|" and spaces don't count)`,
      };
    }
    const hits: Voice["hits"] = [];
    for (let step = 0; step < steps.length; step++) {
      const char = steps[step];
      if (RESTS.has(char)) continue;
      const vel = LETTER_VEL[char];
      if (vel === undefined) {
        return { ok: false, error: `grid row "${drum}": unknown character "${char}" at step ${step} — use ${LEGEND}` };
      }
      hits.push({ step, vel, micro: 0 });
    }
    // All-rest rows are placeholders (drum-tab convention) — skip, don't error.
    if (hits.length > 0) voices.push({ drum, hits, trackGain: 1, muted: false });
  }

  if (voices.length === 0) {
    return { ok: false, error: "grid has no hits at all — add X/x/o/g characters to at least one row" };
  }
  return { ok: true, voices };
}

// Unknown drums sort last, matching page/grid.js (indexOf -1 would put them first).
function order(drum: string): number {
  const i = ROW_ORDER.indexOf(drum);
  return i === -1 ? ROW_ORDER.length : i;
}

/** One "hh:  x-x-|..." line. barLen = steps per "||" group (a bar, or a fill window). */
function rowText(voice: Voice, totalSteps: number, beat: number, barLen: number): string {
  const chars = new Array<string>(totalSteps).fill("-");
  for (const hit of voice.hits) chars[hit.step] = nearestLetter(hit.vel);
  const barsOut: string[] = [];
  for (let start = 0; start < totalSteps; start += barLen) {
    const beats: string[] = [];
    for (let b = start; b < start + barLen; b += beat) {
      beats.push(chars.slice(b, b + beat).join(""));
    }
    barsOut.push(beats.join("|"));
  }
  // Fixed 5-char prefix so rows align for any drum name length (max 3 + ":").
  return `${(voice.drum + ":").padEnd(5)}${barsOut.join("||")}`;
}

export function renderGrid(groove: Groove): string {
  const { bars, resolution } = groove;
  const beat = resolution / 4;

  const lines = [...groove.voices]
    .sort((a, b) => order(a.drum) - order(b.drum))
    .map((voice) => {
      // Non-unity trackGain (v1.5 FR-6) and mute (v1.6 FR-2) are annotated so
      // the LLM sees the user's mixer state.
      const gain = voice.trackGain ?? 1;
      const vol = gain === 1 ? "" : ` [vol ${Math.round(gain * 100)}%]`;
      const muted = voice.muted ? " [muted]" : "";
      return `${rowText(voice, bars * resolution, beat, resolution)}${vol}${muted}`;
    });

  // Fills (v1.7 FR-5): rendered in the same notation so the LLM can read its
  // own variations back and iterate on them.
  if (groove.fills && groove.fills.length > 0) {
    groove.fills.forEach((fill, i) => {
      lines.push("");
      lines.push(`fill ${i + 1} (last ${fill.steps} steps):`);
      for (const voice of [...fill.voices].sort((a, b) => order(a.drum) - order(b.drum))) {
        lines.push(rowText(voice, fill.steps, beat, fill.steps));
      }
    });
  }

  return lines.join("\n");
}

function nearestLetter(vel: number): string {
  if (vel >= 0.85) return "X";
  if (vel >= 0.6) return "x";
  if (vel >= 0.375) return "o";
  return "g";
}
