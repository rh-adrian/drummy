import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { parseGroove, type Groove } from "../core/groove.js";
import { compileGroove } from "../core/compile.js";
import { BANKS, BANK_NAMES, DRUMS, DRUM_ABBRS } from "../core/kits.js";
import type { PageStatus, SidecarPush } from "./sidecar.js";

// MCP tool surface (M3). Tool descriptions double as the drummer's manual for
// the LLM (FR-10): they must teach the vocabulary well enough that a frontier
// model can drive the kit with no external docs. Business failures (invalid
// groove, page not open, port collision) are isError results, never protocol
// errors (FR-9) — so input schemas stay permissive and parseGroove does the
// real validation with LLM-actionable messages.

/** The subset of the sidecar the tools need — lets tests inject a mock. */
export interface SidecarHandle {
  port: number;
  url: string;
  push(msg: SidecarPush): void;
  setLastEvaluate(code: string): void;
  pageConnected(): boolean;
  lastStatus(): PageStatus | null;
}

/** Startup failed (port in use): every tool reports the error instead. */
export interface SidecarUnavailable {
  unavailableError: string;
}

export interface DrummerOptions {
  /** Injectable for tests; defaults to fetching Strudel's tidal-drum-machines map. */
  fetchSampleMap?: () => Promise<Record<string, unknown>>;
}

const SAMPLE_MAP_URL = "https://strudel.b-cdn.net/tidal-drum-machines.json";

function isUnavailable(s: SidecarHandle | SidecarUnavailable): s is SidecarUnavailable {
  return "unavailableError" in s;
}

function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function err(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

// ---------------------------------------------------------------------------
// Input schemas: permissive on purpose — EVERY groove field is optional at the
// protocol layer so malformed grooves reach parseGroove and come back as
// actionable isError text instead of opaque JSON-RPC validation errors.
// The "REQUIRED." markers are documentation for the LLM, not schema law.
// ---------------------------------------------------------------------------

const hitShape = z
  .object({
    step: z.number().optional().describe("Grid step, 0-based, < bars*resolution. REQUIRED."),
    vel: z
      .number()
      .optional()
      .describe("Velocity, >0 and <=1. 1.0 = full accent, 0.7-0.9 = normal, 0.2-0.4 = ghost note. Default 1."),
    micro: z
      .number()
      .optional()
      .describe(
        "Micro-timing offset in fractions of a step, -0.5..0.5. Positive = late/laid-back, negative = early/pushed. Default 0.",
      ),
  })
  .passthrough();

const voiceShape = z
  .object({
    drum: z.string().optional().describe(`Drum voice. One of: ${DRUM_ABBRS.join(", ")}. REQUIRED.`),
    hits: z.array(hitShape).optional().describe("The hits for this drum, one per step max. REQUIRED."),
  })
  .passthrough();

const grooveShape = z
  .object({
    tempoBpm: z.number().optional().describe("Tempo in BPM, 40-300. REQUIRED."),
    swing: z
      .number()
      .optional()
      .describe(
        "0-0.6, fraction of a step to delay every odd-numbered step. Use resolution 16 for classic swung-16ths feels. Default 0.",
      ),
    bank: z
      .string()
      .optional()
      .describe(`Sample bank (drum machine). One of: ${BANK_NAMES.join(", ")}. REQUIRED — call list_kits for descriptions.`),
    bars: z.number().optional().describe("Loop length in bars, 1-4. Default 1."),
    resolution: z
      .number()
      .optional()
      .describe("Steps per bar: 8, 12, 16, 24, or 32. 16 = 16th notes (default; use with swing); 12/24 = triplet feels."),
    voices: z.array(voiceShape).optional().describe("One entry per drum. REQUIRED."),
  })
  .passthrough();

const VELOCITY_GUIDE =
  "Velocity conventions: accents 1.0, normal hits 0.7-0.9, ghost notes 0.2-0.4 (essential for funk/soul snare work). " +
  "Micro-timing: micro=0.02-0.05 on a hit drags it (laid-back), negative pushes it; use sparingly for feel, e.g. a lazy backbeat.";

const GROOVE_GUIDE =
  "A groove is a bar grid: `resolution` steps per bar (16 = 16th notes) times `bars` (1-4). Each voice is one drum " +
  `(${DRUM_ABBRS.join(", ")}) with hits at steps. In 4/4 at resolution 16: beats fall on steps 0/4/8/12, backbeat snare on 4 and 12, ` +
  "8th-note hats on even steps, 16th hats on every step. `swing` (0-0.6) delays every odd step by that fraction of a step — " +
  "for a classic swung-16ths feel use resolution 16 with swing 0.15-0.35 (0.1-0.2 subtle shuffle, ~0.33 hard triplet swing). " +
  VELOCITY_GUIDE +
  " Genre sketches: funk = syncopated bd, sd backbeat + ghosts on 16th offsets, 16th hh with accent pattern; " +
  "house/techno = bd on 0/4/8/12, oh on 2/6/10/14; boom-bap = swing 0.15-0.25, AkaiMPC60 or EmuSP12; " +
  "halftime = sd only on step 8. Keep hats quieter than kick/snare (0.4-0.7) for a natural mix.";

// ---------------------------------------------------------------------------

export function createDrummerServer(
  sidecar: SidecarHandle | SidecarUnavailable,
  options: DrummerOptions = {},
): McpServer {
  const server = new McpServer(
    { name: "ai-drummer", version: "0.1.0" },
    {
      instructions:
        "AI drummer: author grooves from your own song/genre knowledge and play them through real drum-machine samples " +
        "in the user's browser. Start with play_groove; iterate with update_groove/set_tempo/set_kit as the user reacts. " +
        "Changes land at the next bar boundary (a second or two) — that's by design, like counting a band in.",
    },
  );

  // Session state (A-1: one jam session per server instance).
  let groove: Groove | null = null;
  let playing = false;

  const fetchSampleMap =
    options.fetchSampleMap ??
    (async () => {
      const res = await fetch(SAMPLE_MAP_URL);
      if (!res.ok) throw new Error(`sample map fetch failed: ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    });
  let sampleMapPromise: Promise<Record<string, unknown>> | null = null;
  const getSampleMap = () => (sampleMapPromise ??= fetchSampleMap());

  function guard(): CallToolResult | null {
    if (isUnavailable(sidecar)) return err(sidecar.unavailableError);
    if (!sidecar.pageConnected()) {
      return err(
        `No drummer page is connected — ask the user to open ${sidecar.url} in a browser and click Start (one click is ` +
          "required to enable audio), then call this tool again.",
      );
    }
    return null;
  }

  function requirePlaying(): CallToolResult | null {
    if (!playing || !groove) {
      return err("Nothing is playing — call play_groove first (it accepts the full groove including tempo and bank).");
    }
    return null;
  }

  function playingSummary(g: Groove): string {
    const drums = g.voices.map((v) => v.drum).join(", ");
    return `${g.tempoBpm} BPM on ${g.bank}, ${g.bars} bar${g.bars > 1 ? "s" : ""} of ${drums}` +
      `${g.swing ? `, swing ${g.swing}` : ""}. The change lands at the next bar boundary.`;
  }

  server.registerTool(
    "play_groove",
    {
      title: "Play a groove",
      description:
        "Start (or replace) the looping drum groove in the user's browser. Author the groove yourself from what you know " +
        "about the requested song, artist, or genre — capture the FEEL (which drums, where the accents and ghost notes sit, " +
        "swing, tempo), not a note-for-note transcription. " +
        GROOVE_GUIDE,
      inputSchema: { groove: grooveShape.describe("The groove to play.") },
    },
    async ({ groove: input }) => {
      const failed = guard();
      if (failed) return failed;
      const parsed = parseGroove(input);
      if (!parsed.ok) return err(`Invalid groove — ${parsed.error}`);
      (sidecar as SidecarHandle).push({ type: "evaluate", code: compileGroove(parsed.groove) });
      groove = parsed.groove;
      playing = true;
      return ok(`Playing: ${playingSummary(parsed.groove)}`);
    },
  );

  server.registerTool(
    "update_groove",
    {
      title: "Update the playing groove",
      description:
        "Edit the currently playing groove without restarting it: replace or add voices (matched by drum name), remove " +
        "drums, or change tempo/swing/bank/bars/resolution. Only send what changes — everything else is kept. The edit " +
        "applies at the next bar boundary, click-free. Use this for iteration ('more hi-hat', 'add ghost notes', " +
        "'make it swing'). " +
        VELOCITY_GUIDE,
      inputSchema: {
        tempoBpm: z.number().optional().describe("New tempo in BPM, 40-300."),
        swing: z.number().optional().describe("New swing, 0-0.6 (fraction of a step; odd steps are delayed)."),
        bank: z.string().optional().describe(`New sample bank. One of: ${BANK_NAMES.join(", ")}.`),
        bars: z.number().optional().describe("New loop length in bars, 1-4."),
        resolution: z.number().optional().describe("New steps per bar: 8, 12, 16, 24, or 32."),
        voices: z
          .array(voiceShape)
          .optional()
          .describe("Voices to add or replace, matched by drum. A voice given here fully replaces its previous hits."),
        removeDrums: z.array(z.string()).optional().describe("Drums to remove from the groove entirely."),
      },
    },
    async (edits) => {
      const failed = guard() ?? requirePlaying();
      if (failed) return failed;
      if (Object.values(edits).every((v) => v === undefined)) {
        return err(
          "No changes provided — pass the fields to change at the top level (tempoBpm, swing, bank, bars, resolution, " +
            "voices, removeDrums), not wrapped in a groove object.",
        );
      }
      const conflict = (edits.removeDrums ?? []).filter((d) =>
        (edits.voices ?? []).some((v) => (v as { drum?: string }).drum === d),
      );
      if (conflict.length > 0) {
        return err(
          `Contradictory update: ${conflict.join(", ")} appears in both voices and removeDrums — to replace a drum's ` +
            "hits, just include it in voices; to drop it, just list it in removeDrums.",
        );
      }
      const current = groove as Groove;
      const removed = new Set(edits.removeDrums ?? []);
      const replacements = new Map((edits.voices ?? []).map((v) => [(v as { drum: string }).drum, v]));
      const voices: unknown[] = current.voices
        .filter((v) => !removed.has(v.drum))
        .map((v) => replacements.get(v.drum) ?? v);
      for (const [drum, v] of replacements) {
        if (!current.voices.some((cv) => cv.drum === drum)) voices.push(v);
      }
      const merged = {
        tempoBpm: edits.tempoBpm ?? current.tempoBpm,
        swing: edits.swing ?? current.swing,
        bank: edits.bank ?? current.bank,
        bars: edits.bars ?? current.bars,
        resolution: edits.resolution ?? current.resolution,
        voices,
      };
      const parsed = parseGroove(merged);
      if (!parsed.ok) return err(`Invalid update — ${parsed.error}. The groove is unchanged.`);
      (sidecar as SidecarHandle).push({ type: "evaluate", code: compileGroove(parsed.groove) });
      groove = parsed.groove;
      return ok(`Updated: ${playingSummary(parsed.groove)}`);
    },
  );

  server.registerTool(
    "set_tempo",
    {
      title: "Change tempo",
      description:
        "Change the tempo of the playing groove smoothly, without restarting the loop or losing its place in the bar. " +
        "Prefer this over re-sending the groove when only the tempo changes.",
      inputSchema: { bpm: z.number().describe("New tempo in BPM, 40-300.") },
    },
    async ({ bpm }) => {
      const failed = guard() ?? requirePlaying();
      if (failed) return failed;
      if (!Number.isFinite(bpm) || bpm < 40 || bpm > 300) {
        return err(`bpm must be between 40 and 300 (got: ${bpm})`);
      }
      // One cycle = one bar of 4/4 (D-11): cycles/sec = bpm / 60 / 4.
      const live = sidecar as SidecarHandle;
      live.push({ type: "setCps", cps: bpm / 240 });
      groove = { ...(groove as Groove), tempoBpm: bpm };
      // Keep the replayed evaluate's setcpm in sync so a page that reloads
      // comes back at the new tempo, not the one baked into the old code.
      live.setLastEvaluate(compileGroove(groove));
      return ok(`Tempo is now ${bpm} BPM.`);
    },
  );

  server.registerTool(
    "set_kit",
    {
      title: "Switch drum kit",
      description:
        "Switch the playing groove to a different drum machine's samples (same pattern, new sound). The switch lands at " +
        "the next bar boundary. Call list_kits to see what's available and what each kit sounds like.",
      inputSchema: { bank: z.string().describe(`Sample bank name. One of: ${BANK_NAMES.join(", ")}.`) },
    },
    async ({ bank }) => {
      const failed = guard() ?? requirePlaying();
      if (failed) return failed;
      if (!BANK_NAMES.includes(bank)) {
        return err(`Unknown bank "${bank}" — valid banks are: ${BANK_NAMES.join(", ")}.`);
      }
      const next = { ...(groove as Groove), bank };
      (sidecar as SidecarHandle).push({ type: "evaluate", code: compileGroove(next) });
      groove = next;
      return ok(`Kit is now ${bank}. ${playingSummary(next)}`);
    },
  );

  server.registerTool(
    "list_kits",
    {
      title: "List drum kits",
      description:
        "List the available drum machines (sample banks) with sound descriptions, which drums each one provides, and the " +
        "drum abbreviation legend. Read-only.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (isUnavailable(sidecar)) return err(sidecar.unavailableError);
      let availability: Map<string, string[]> | null = null;
      try {
        const map = await getSampleMap();
        availability = new Map(
          BANK_NAMES.map((bank) => [bank, DRUM_ABBRS.filter((drum) => `${bank}_${drum}` in map)]),
        );
      } catch {
        sampleMapPromise = null; // let a later call retry
      }
      const lines = BANKS.map((b) => {
        const drums = availability?.get(b.name);
        const drumsNote = drums && drums.length > 0 ? ` [drums: ${drums.join(", ")}]` : "";
        return `- ${b.name} — ${b.description}${drumsNote}`;
      });
      const legend = DRUMS.map((d) => `${d.abbr} = ${d.name}`).join(", ");
      const note = availability
        ? ""
        : "\n(Per-kit drum availability unavailable right now — the standard abbreviations usually work.)";
      return ok(`Available kits:\n${lines.join("\n")}\n\nDrum abbreviations: ${legend}${note}`);
    },
  );

  server.registerTool(
    "stop",
    {
      title: "Stop playback",
      description: "Stop the drums. A later play_groove starts fresh. Safe to call when already stopped.",
      inputSchema: {},
    },
    async () => {
      // Deliberately no page-connected guard: pushing hush with zero pages
      // still clears the sidecar's replay state, so a page opened later stays
      // silent instead of resurrecting the old groove.
      if (isUnavailable(sidecar)) return err(sidecar.unavailableError);
      if (!playing) return ok("Already stopped.");
      sidecar.push({ type: "hush" });
      playing = false;
      return ok("Stopped.");
    },
  );

  server.registerTool(
    "now_playing",
    {
      title: "What's playing",
      description:
        "Current session state as JSON: whether a groove is playing, the groove itself, tempo, kit, and whether the " +
        "browser page is connected. Read-only — call this to re-orient before editing.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (isUnavailable(sidecar)) return err(sidecar.unavailableError);
      return ok(
        JSON.stringify(
          {
            playing,
            tempoBpm: groove?.tempoBpm ?? null,
            bank: groove?.bank ?? null,
            groove,
            pageConnected: sidecar.pageConnected(),
            pageUrl: sidecar.url,
            pageStatus: sidecar.lastStatus(),
          },
          null,
          2,
        ),
      );
    },
  );

  return server;
}
