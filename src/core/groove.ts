import { z } from "zod";
import { BANK_NAMES, DRUM_ABBRS } from "./kits.js";

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
  hits: z.array(hitSchema).min(1, { message: "a voice needs at least one hit" }),
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
  voices: z.array(voiceSchema).min(1, { message: "a groove needs at least one voice (e.g. bd)" }),
});

export type Groove = z.infer<typeof grooveSchema>;
export type Voice = Groove["voices"][number];
export type Hit = Voice["hits"][number];

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

  const groove = parsed.data;
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
