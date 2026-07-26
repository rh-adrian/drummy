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
    if (hits.length > 0) voices.push({ drum, hits });
  }

  if (voices.length === 0) {
    return { ok: false, error: "grid has no hits at all — add X/x/o/g characters to at least one row" };
  }
  return { ok: true, voices };
}

export function renderGrid(groove: Groove): string {
  const { bars, resolution } = groove;
  const beat = resolution / 4;

  // Unknown drums sort last, matching page/grid.js (indexOf -1 would put them first).
  const order = (drum: string) => {
    const i = ROW_ORDER.indexOf(drum);
    return i === -1 ? ROW_ORDER.length : i;
  };
  const rows = [...groove.voices]
    .sort((a, b) => order(a.drum) - order(b.drum))
    .map((voice) => {
      const chars = new Array<string>(bars * resolution).fill("-");
      for (const hit of voice.hits) chars[hit.step] = nearestLetter(hit.vel);
      const barsOut: string[] = [];
      for (let bar = 0; bar < bars; bar++) {
        const beats: string[] = [];
        for (let start = bar * resolution; start < (bar + 1) * resolution; start += beat) {
          beats.push(chars.slice(start, start + beat).join(""));
        }
        barsOut.push(beats.join("|"));
      }
      // Fixed 5-char prefix so rows align for any drum name length (max 3 + ":").
      return `${(voice.drum + ":").padEnd(5)}${barsOut.join("||")}`;
    });

  return rows.join("\n");
}

function nearestLetter(vel: number): string {
  if (vel >= 0.85) return "X";
  if (vel >= 0.6) return "x";
  if (vel >= 0.375) return "o";
  return "g";
}
