import { z } from "zod";
import { BANK_NAMES, DRUM_ABBRS } from "./kits.js";
import { gridToVoices } from "./grid.js";

// Error messages are written for LLM self-correction: they name the offending
// value and state the valid alternatives or range.

const hitSchema = z.object({
  step: z.number().int().min(0),
  vel: z
    .number()
    .gt(0, { message: "vel must be > 0 (silent hits should simply be omitted)" })
    .max(1, { message: "vel must be <= 1 (1 = full accent; ghost notes are typically 0.2-0.4)" })
    .default(1),
  micro: z
    .number()
    .min(-0.5, { message: "micro must be >= -0.5 (fraction of one step; negative = early)" })
    .max(0.5, { message: "micro must be <= 0.5 (fraction of one step; positive = late)" })
    .default(0),
});

const voiceSchema = z.object({
  drum: z
    .string({ required_error: `drum is required — valid drums are: ${DRUM_ABBRS.join(", ")}` })
    .refine((d) => DRUM_ABBRS.includes(d), {
      message: `unknown drum — valid drums are: ${DRUM_ABBRS.join(", ")}`,
    }),
  // Empty is legal (v1.6 D-40): a cleared channel keeps its row (and fader/
  // mute state) — it just doesn't sound. removeDrums deletes the row entirely.
  hits: z.array(hitSchema),
  // Mute (v1.6 D-41): silent but everything kept — separate from trackGain so
  // unmuting restores the exact mix.
  muted: z.boolean().default(false),
  // Track volume (v1.5, D-35): a mix fader, NOT dynamics — multiplies the
  // compiled gain but never affects which velocity layer plays.
  trackGain: z
    .number()
    .min(0, { message: "trackGain must be between 0 and 1.5 (0 = muted, 1 = unity, >1 = boost)" })
    .max(1.5, { message: "trackGain must be between 0 and 1.5 (0 = muted, 1 = unity, >1 = boost)" })
    .default(1),
});

const grooveSchema = z.object({
  tempoBpm: z
    .number()
    .min(40, { message: "tempoBpm must be between 40 and 300" })
    .max(300, { message: "tempoBpm must be between 40 and 300" }),
  swing: z
    .number()
    .min(0, { message: "swing must be between 0 and 0.6 (fraction of a step to delay off-steps)" })
    .max(0.6, { message: "swing must be between 0 and 0.6 (fraction of a step to delay off-steps)" })
    .default(0),
  bank: z
    .string({ required_error: `bank is required — valid banks are: ${BANK_NAMES.join(", ")}` })
    .refine((b) => BANK_NAMES.includes(b), {
      message: `unknown bank — valid banks are: ${BANK_NAMES.join(", ")}`,
    }),
  bars: z.number().int().min(1).max(4).default(1),
  resolution: z
    .union([z.literal(8), z.literal(12), z.literal(16), z.literal(24), z.literal(32)], {
      errorMap: () => ({ message: "resolution must be 8, 12, 16, 24, or 32 steps per bar (12/24 for triplet feels)" }),
    })
    .default(16),
  voices: z.array(voiceSchema).min(1, { message: "a voice list needs at least one voice (e.g. bd)" }).optional(),
  // Grid notation (v1.4): drum → pattern string, converted via gridToVoices.
  grid: z.record(z.string(), z.string()).optional(),
  // Fills (v1.7): up to 6 pre-authored end-of-loop variations, substituted by
  // in-pattern per-cycle randomness (D-46). Input form is {grid} (rows cover
  // the LAST K steps); the parsed form {steps, voices} is also accepted so
  // parseGroove is idempotent for edit merges.
  fills: z
    .array(
      z
        .object({
          grid: z.record(z.string(), z.string()).optional(),
          steps: z.number().int().optional(),
          voices: z.array(voiceSchema).optional(),
        })
        .passthrough(),
    )
    .max(6, { message: "at most 6 fills — pick the best variations" })
    .optional(),
  fillsEnabled: z.boolean().default(true),
  fillChance: z
    .number()
    .min(0.05, { message: "fillChance must be between 0.05 and 1 (fraction of loops that end in a fill)" })
    .max(1, { message: "fillChance must be between 0.05 and 1 (fraction of loops that end in a fill)" })
    .default(0.25),
});

export type Voice = z.infer<typeof voiceSchema>;
export type Hit = Voice["hits"][number];
/** A parsed fill: voices with WINDOW-LOCAL steps (0..steps-1), anchored at the loop end. */
export type Fill = { steps: number; voices: Voice[] };
export type Groove = Omit<z.infer<typeof grooveSchema>, "voices" | "grid" | "fills"> & {
  voices: Voice[];
  fills?: Fill[];
};

export type ParseResult = { ok: true; groove: Groove } | { ok: false; error: string };

export function parseGroove(input: unknown): ParseResult {
  const parsed = grooveSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const path = i.path.join(".");
      // Surface the offending value for enum-like refinements so the model
      // sees what it sent, not just what was expected.
      const offending = getPath(input, i.path);
      const shown = typeof offending === "string" || typeof offending === "number" ? ` (got: ${offending})` : "";
      return `${path}: ${i.message}${shown}`;
    });
    return { ok: false, error: issues.join("; ") };
  }

  const data = parsed.data;

  if (data.grid && data.voices) {
    return {
      ok: false,
      error: 'provide either "grid" (notation rows) or "voices" (JSON hit lists), not both',
    };
  }
  let voices: Voice[];
  if (data.grid) {
    const converted = gridToVoices(data.grid, data.bars, data.resolution);
    if (!converted.ok) return { ok: false, error: converted.error };
    voices = converted.voices;
  } else if (data.voices) {
    voices = data.voices;
  } else {
    return {
      ok: false,
      error:
        'a groove needs either "grid" (notation rows, e.g. grid: {"bd": "X---|----|X---|----"}) or "voices" (JSON hit lists)',
    };
  }

  // Fills (v1.7 FR-1): window length K comes from the rows; whole beats only,
  // one beat .. one bar, anchored at the loop end (D-48).
  let fills: Fill[] | undefined;
  if (data.fills && data.fills.length > 0) {
    fills = [];
    const beat = data.resolution / 4;
    const windowError = (label: string, k: number) =>
      `${label}: rows must cover a whole number of beats (${beat}-step beats at resolution ${data.resolution}), ` +
      `between one beat and one bar (${data.resolution} steps) — got ${k} steps`;
    for (let i = 0; i < data.fills.length; i++) {
      const fill = data.fills[i];
      const label = `fill ${i + 1}`;
      if (fill.grid && Object.keys(fill.grid).length > 0) {
        const k = String(Object.values(fill.grid)[0]).replace(/[| ]/g, "").length;
        if (k % beat !== 0 || k < beat || k > data.resolution) {
          return { ok: false, error: windowError(label, k) };
        }
        const converted = gridToVoices(fill.grid, 1, k);
        if (!converted.ok) return { ok: false, error: `${label}: ${converted.error}` };
        fills.push({ steps: k, voices: converted.voices });
      } else if (Array.isArray(fill.voices) && typeof fill.steps === "number") {
        // already-parsed form (idempotency for edit merges)
        if (fill.steps % beat !== 0 || fill.steps < beat || fill.steps > data.resolution) {
          return { ok: false, error: windowError(label, fill.steps) };
        }
        for (const v of fill.voices) {
          for (const h of v.hits) {
            if (h.step >= fill.steps) {
              return { ok: false, error: `${label}: step ${h.step} is outside the ${fill.steps}-step fill window` };
            }
          }
        }
        fills.push({ steps: fill.steps, voices: fill.voices });
      } else {
        return {
          ok: false,
          error: `${label}: write it as grid rows covering the LAST steps of the loop, e.g. {"grid": {"sd": "X-xg"}}`,
        };
      }
    }
  }

  const groove: Groove = {
    tempoBpm: data.tempoBpm,
    swing: data.swing,
    bank: data.bank,
    bars: data.bars,
    resolution: data.resolution,
    voices,
    fills,
    fillsEnabled: data.fillsEnabled,
    fillChance: data.fillChance,
  };
  const totalSteps = groove.bars * groove.resolution;
  for (const voice of groove.voices) {
    for (const hit of voice.hits) {
      if (hit.step >= totalSteps) {
        return {
          ok: false,
          error: `voice "${voice.drum}": step ${hit.step} is out of range — with bars=${groove.bars} and resolution=${groove.resolution}, valid steps are 0-${totalSteps - 1}`,
        };
      }
    }
  }

  const seen = new Set<string>();
  for (const voice of groove.voices) {
    if (seen.has(voice.drum)) {
      return {
        ok: false,
        error: `duplicate voice "${voice.drum}" — merge its hits into a single voice entry`,
      };
    }
    seen.add(voice.drum);

    const steps = new Set<number>();
    for (const hit of voice.hits) {
      if (steps.has(hit.step)) {
        return {
          ok: false,
          error: `voice "${voice.drum}" has multiple hits on step ${hit.step} — keep one hit per step (for a flam, put the grace note on a neighboring step with a micro offset)`,
        };
      }
      steps.add(hit.step);
    }
  }

  return { ok: true, groove };
}

function getPath(input: unknown, path: (string | number)[]): unknown {
  let current: unknown = input;
  for (const key of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}
