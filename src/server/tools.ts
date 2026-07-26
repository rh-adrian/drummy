import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { parseGroove, type Groove } from "../core/groove.js";
import { gridToVoices, renderGrid } from "../core/grid.js";
import { compileGroove } from "../core/compile.js";
import { clearTrack, cycleStep, muteTrack, setTrackGain } from "../core/edit.js";
import { BANKS, BANK_NAMES, DRUMS, DRUM_ABBRS } from "../core/kits.js";
import type { PageEdit, PageStatus, SidecarPush } from "./sidecar.js";

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
  setLastEvaluate(code: string, groove?: Groove): void;
  pageConnected(): boolean;
  lastStatus(): PageStatus | null;
  onEdit(handler: (edit: PageEdit) => void): void;
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

// The Acoustic bank's sample map lives in this repo (index only, see
// SAMPLES.md) and is served to the page at /acoustic.json — availability
// comes from disk, no network. Cached once; it's a committed static file.
let acousticMapCache: Record<string, unknown> | null = null;
function acousticSampleMap(): Record<string, unknown> {
  if (!acousticMapCache) {
    try {
      const file = fileURLToPath(new URL("../../page/acoustic.json", import.meta.url));
      acousticMapCache = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch (e) {
      // don't cache the failure — leave null so a later call retries
      console.error("[tools] failed to read acoustic.json:", e);
      return {};
    }
  }
  return acousticMapCache;
}

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
    muted: z
      .boolean()
      .optional()
      .describe(
        "Channel mute (page M button). Muted rows show as [muted] — the mute belongs to the user; leave it unless " +
          "asked. Default false.",
      ),
    trackGain: z
      .number()
      .optional()
      .describe(
        "Track volume fader, 0-1.5 (0 = mute, 1 = unity, >1 = boost). MIX, not dynamics — velocity still picks the " +
          "sample layer. Users set this with the page's sliders; it persists across your voice edits, so leave it " +
          "alone unless asked to change the mix. Default 1.",
      ),
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
      .describe(
        `Sample bank. One of: ${BANK_NAMES.join(", ")}. REQUIRED — call list_kits for descriptions. ` +
          "Acoustic is a real velocity-layered kit: vel picks the actual recording, so dynamics matter — " +
          "sd below ~0.35 triggers real ghost-note captures, and oh opens up from semi-open sizzle to a full wash as vel rises.",
      ),
    bars: z.number().optional().describe("Loop length in bars, 1-4. Default 1."),
    resolution: z
      .number()
      .optional()
      .describe("Steps per bar: 8, 12, 16, 24, or 32. 16 = 16th notes (default; use with swing); 12/24 = triplet feels."),
    grid: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Drum-tab rows, the preferred way to write a groove: {"bd": "X---|----|X---|----", ...}. ' +
          'X/x/o/g = accent/normal/soft/ghost, "-" or "." = rest, "|" and spaces are cosmetic. ' +
          "One character per step, bars × resolution characters per row. Use grid OR voices, not both.",
      ),
    voices: z
      .array(voiceShape)
      .optional()
      .describe("JSON alternative to grid for exact velocities and per-hit micro-timing. One entry per drum."),
  })
  .passthrough();

const VELOCITY_GUIDE =
  "Velocity conventions: accents 1.0, normal hits 0.7-0.9, ghost notes 0.2-0.4 (essential for funk/soul snare work). " +
  "Micro-timing: micro=0.02-0.05 on a hit drags it (laid-back), negative pushes it; use sparingly for feel, e.g. a lazy backbeat.";

const GRID_GUIDE =
  "PREFERRED FORMAT — write groove.grid as drum-tab rows: one pattern string per drum, one character per step. " +
  "Letters set velocity: X = accent (1.0), x = normal (0.7), o = soft (0.5), g = ghost (0.25); \"-\" or \".\" = rest; " +
  '"|" and spaces are cosmetic beat separators (each row needs bars × resolution real characters). ' +
  "Example — one bar of funk at resolution 16:\n" +
  '  "hh": "X-x-|x-o-|X-x-|x-o-"\n' +
  '  "sd": "----|X--g|-g--|X---"\n' +
  '  "bd": "X---|--x-|----|-x--"\n' +
  "Columns are moments in time — read them vertically to SEE how kick, snare, and hats interlock. " +
  "The JSON voices format (hits with exact vel/micro) remains available for fine control beyond the four letters. ";

const MUSICIANSHIP =
  "What makes it feel human — check every groove against this before playing: " +
  "(1) the timekeeper (hh, rd, or cb) almost never rests; holes in the time line sound like mistakes, not feel. " +
  "(2) Accents follow the music: back-beats (sd on beats 2 and 4) are the loudest hits, and hat dynamics vary — never " +
  "give every hit the same letter, never write mechanical velocity ramps. " +
  "(3) Snare ghosts (g) sprinkled between back-beats are what make funk, soul, and hip-hop breathe. " +
  "(4) Use swing 0.15-0.35 for shuffled/swung feels — dead-straight time is for machine genres only. " +
  "(5) Kick and snare converse instead of stacking on the same steps. ";

const GROOVE_GUIDE =
  "A groove is a bar grid: `resolution` steps per bar (16 = 16th notes) times `bars` (1-4). Drums: " +
  `${DRUM_ABBRS.join(", ")}. In 4/4 at resolution 16: beats fall on steps 0/4/8/12 (grid columns 1/5/9/13), backbeat ` +
  "snare on steps 4 and 12, 8th-note hats on even steps, 16th hats on every step. The user's page shows a drummer's " +
  'count header (1 e & a 2 e & a …), so they may name spots that way: within a beat "e"=+1, "&"=+2, "a"=+3 sixteenths; ' +
  'step = (bar-1)*resolution + (beat-1)*resolution/4 + offset — e.g. "the & of 3 in bar 2" at resolution 16 is step 26. ' +
  "Rows tagged [vol N%] carry the user's mix fader (trackGain) — respect it. " +
  "`swing` (0-0.6) delays every odd " +
  "step by that fraction of a step (0.1-0.2 subtle shuffle, ~0.33 hard triplet swing). " +
  VELOCITY_GUIDE +
  " Genre sketches: funk = syncopated bd, sd backbeat + ghosts on 16th offsets, 16th hh with accent pattern; " +
  "house/techno = bd on 0/4/8/12, oh on 2/6/10/14; boom-bap = swing 0.15-0.25, AkaiMPC60 or EmuSP12; " +
  "halftime = sd only on step 8. Keep hats quieter than kick/snare (x/o letters, not X) for a natural mix.";

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

  // Undo (v1.6 FR-4, D-42): snapshots of the groove BEFORE each successful
  // page edit. Cleared whenever an LLM tool mutates the groove — undo only
  // spans consecutive human actions, never silently reverts the model's work.
  const UNDO_CAP = 20;
  let undoStack: Groove[] = [];
  function undoSnapshot(g: Groove) {
    undoStack.push(structuredClone(g));
    if (undoStack.length > UNDO_CAP) undoStack.shift();
  }
  function clearUndo() {
    undoStack = [];
  }

  // Page edits (v1.2 clicks, v1.5 cycle + faders): the human and the LLM share
  // this session groove, so now_playing/update_groove see them automatically.
  if (!isUnavailable(sidecar)) {
    sidecar.onEdit((edit) => {
      const what = JSON.stringify(edit);
      if (!groove) {
        console.error(`[drummer] ignored page edit ${what}: no groove loaded`);
        return;
      }

      if (edit.kind === "undo") {
        const prev = undoStack.pop();
        if (!prev) {
          console.error("[drummer] undo: nothing to undo");
          return;
        }
        groove = prev;
        // While stopped: state-only, like every edit (D-21) — the replay was
        // cleared by hush and must stay clear so reloads stay silent.
        if (playing) sidecar.push({ type: "evaluate", code: compileGroove(groove), groove, origin: "page" });
        return;
      }

      if (edit.kind === "setTempo") {
        // set_tempo semantics (D-44): no restart, bar phase kept.
        if (!Number.isFinite(edit.bpm) || edit.bpm < 40 || edit.bpm > 300) {
          console.error(`[drummer] refused page edit ${what}: bpm must be between 40 and 300`);
          return;
        }
        undoSnapshot(groove);
        groove = { ...groove, tempoBpm: edit.bpm };
        if (playing) {
          sidecar.push({ type: "setCps", cps: edit.bpm / 240 });
          sidecar.setLastEvaluate(compileGroove(groove), groove);
        }
        return;
      }

      const res =
        edit.kind === "cycleStep"
          ? cycleStep(groove, edit.drum, edit.step)
          : edit.kind === "setTrackGain"
            ? setTrackGain(groove, edit.drum, edit.gain)
            : edit.kind === "muteTrack"
              ? muteTrack(groove, edit.drum)
              : clearTrack(groove, edit.drum);
      if (!res.ok) {
        console.error(`[drummer] refused page edit ${what}: ${res.reason}`);
        // Snap the page's optimistic state back to reality (FR-4).
        if (playing) sidecar.push({ type: "evaluate", code: compileGroove(groove), groove, origin: "page" });
        return;
      }
      undoSnapshot(groove);
      groove = res.groove;
      // Never resurrect playback from an edit while stopped (D-21) — it just
      // waits in state for the next play/update.
      if (playing) sidecar.push({ type: "evaluate", code: compileGroove(groove), groove, origin: "page" });
    });
  }

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
        GRID_GUIDE +
        MUSICIANSHIP +
        GROOVE_GUIDE,
      inputSchema: { groove: grooveShape.describe("The groove to play.") },
    },
    async ({ groove: input }) => {
      const failed = guard();
      if (failed) return failed;
      const parsed = parseGroove(input);
      if (!parsed.ok) return err(`Invalid groove — ${parsed.error}`);
      (sidecar as SidecarHandle).push({
        type: "evaluate",
        code: compileGroove(parsed.groove),
        groove: parsed.groove,
      });
      groove = parsed.groove;
      playing = true;
      clearUndo(); // D-42: undo never crosses an LLM mutation
      return ok(`Playing: ${playingSummary(parsed.groove)}\n\n${renderGrid(parsed.groove)}`);
    },
  );

  server.registerTool(
    "update_groove",
    {
      title: "Update the playing groove",
      description:
        "Edit the currently playing groove without restarting it: replace or add drums (as grid rows or JSON voices, " +
        "matched by drum name), remove drums, or change tempo/swing/bank/bars/resolution. Only send what changes — " +
        "everything else is kept. The edit applies at the next bar boundary, click-free. Use this for iteration " +
        "('more hi-hat', 'add ghost notes', 'make it swing'). Grid rows use play_groove's notation (X/x/o/g letters); " +
        "to remove a drum use removeDrums, not an all-rest row. A voice sent with hits: [] clears the pattern but " +
        "KEEPS the row (users can also clear/mute rows and undo their own page edits from the page — [muted] and " +
        "[vol N%] tags are theirs to keep). " +
        VELOCITY_GUIDE,
      inputSchema: {
        tempoBpm: z.number().optional().describe("New tempo in BPM, 40-300."),
        swing: z.number().optional().describe("New swing, 0-0.6 (fraction of a step; odd steps are delayed)."),
        bank: z.string().optional().describe(`New sample bank. One of: ${BANK_NAMES.join(", ")}.`),
        bars: z.number().optional().describe("New loop length in bars, 1-4."),
        resolution: z.number().optional().describe("New steps per bar: 8, 12, 16, 24, or 32."),
        grid: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Drum-tab rows to add or replace, matched by drum — same notation as play_groove. " +
              "A row fully replaces that drum's previous hits.",
          ),
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
            "grid, voices, removeDrums), not wrapped in a groove object.",
        );
      }
      if (edits.grid && edits.voices) {
        return err('Provide either "grid" (notation rows) or "voices" (JSON hit lists), not both.');
      }
      const editedDrums = [
        ...(edits.voices ?? []).map((v) => (v as { drum?: string }).drum),
        ...Object.keys(edits.grid ?? {}),
      ];
      const conflict = (edits.removeDrums ?? []).filter((d) => editedDrums.includes(d));
      if (conflict.length > 0) {
        return err(
          `Contradictory update: ${conflict.join(", ")} appears in both the edits and removeDrums — to replace a ` +
            "drum's hits, just include it in grid/voices; to drop it, just list it in removeDrums.",
        );
      }
      const current = groove as Groove;
      let editVoices = (edits.voices ?? []) as unknown[];
      if (edits.grid) {
        const converted = gridToVoices(edits.grid, edits.bars ?? current.bars, edits.resolution ?? current.resolution);
        if (!converted.ok) {
          // In an update, an all-rest grid usually means "silence this drum" —
          // point at removeDrums instead of parroting the core error's advice.
          const hint = converted.error.includes("no hits") ? " To silence a drum, list it in removeDrums instead." : "";
          return err(`Invalid update — ${converted.error}.${hint} The groove is unchanged.`);
        }
        editVoices = converted.voices;
      }
      // D-38: a replacement that doesn't explicitly set trackGain keeps the
      // voice's current fader (grid rows can never express one, so a grid
      // replacement always keeps it) — the user's mix survives LLM edits.
      const currentByDrum = new Map(current.voices.map((v) => [v.drum, v]));
      editVoices = editVoices.map((v0) => {
        const v = v0 as { drum?: string; trackGain?: number; muted?: boolean };
        const prev = v.drum ? currentByDrum.get(v.drum) : undefined;
        if (!prev) return v0;
        const explicitGain = edits.grid ? undefined : v.trackGain;
        const explicitMuted = edits.grid ? undefined : v.muted;
        return { ...(v0 as object), trackGain: explicitGain ?? prev.trackGain, muted: explicitMuted ?? prev.muted };
      });
      const removed = new Set(edits.removeDrums ?? []);
      const replacements = new Map(editVoices.map((v) => [(v as { drum: string }).drum, v]));
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
      (sidecar as SidecarHandle).push({
        type: "evaluate",
        code: compileGroove(parsed.groove),
        groove: parsed.groove,
      });
      groove = parsed.groove;
      clearUndo(); // D-42
      return ok(`Updated: ${playingSummary(parsed.groove)}\n\n${renderGrid(parsed.groove)}`);
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
      // Keep the replayed evaluate's setcpm (and grid groove) in sync so a page
      // that reloads comes back at the new tempo, not the one baked into the
      // old code.
      live.setLastEvaluate(compileGroove(groove), groove);
      clearUndo(); // D-42
      return ok(`Tempo is now ${bpm} BPM.`);
    },
  );

  server.registerTool(
    "set_kit",
    {
      title: "Switch drum kit",
      description:
        "Switch the playing groove to a different kit's samples — a classic drum machine or the real Acoustic kit " +
        "(same pattern, new sound). The switch lands at the next bar boundary. Call list_kits to see what's " +
        "available and what each kit sounds like.",
      inputSchema: { bank: z.string().describe(`Sample bank name. One of: ${BANK_NAMES.join(", ")}.`) },
    },
    async ({ bank }) => {
      const failed = guard() ?? requirePlaying();
      if (failed) return failed;
      if (!BANK_NAMES.includes(bank)) {
        return err(`Unknown bank "${bank}" — valid banks are: ${BANK_NAMES.join(", ")}.`);
      }
      const next = { ...(groove as Groove), bank };
      (sidecar as SidecarHandle).push({ type: "evaluate", code: compileGroove(next), groove: next });
      groove = next;
      clearUndo(); // D-42
      return ok(`Kit is now ${bank}. ${playingSummary(next)}`);
    },
  );

  server.registerTool(
    "list_kits",
    {
      title: "List drum kits",
      description:
        "List the available kits (classic drum machines plus a real acoustic kit) with sound descriptions, which drums " +
        "each one provides, and the drum abbreviation legend. Read-only.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (isUnavailable(sidecar)) return err(sidecar.unavailableError);
      // Acoustic availability is local (acoustic.json); machine kits need the
      // tidal map fetch and degrade to a note when it's unreachable.
      let machineMap: Record<string, unknown> | null = null;
      try {
        machineMap = await getSampleMap();
      } catch {
        sampleMapPromise = null; // let a later call retry
      }
      const merged = { ...(machineMap ?? {}), ...acousticSampleMap() };
      const availability = new Map(
        BANK_NAMES.map((bank) => [bank, DRUM_ABBRS.filter((drum) => `${bank}_${drum}` in merged)]),
      );
      const lines = BANKS.map((b) => {
        const drums = availability.get(b.name);
        const drumsNote = drums && drums.length > 0 ? ` [drums: ${drums.join(", ")}]` : "";
        return `- ${b.name} — ${b.description}${drumsNote}`;
      });
      const legend = DRUMS.map((d) => `${d.abbr} = ${d.name}`).join(", ");
      const note = machineMap
        ? ""
        : "\n(Machine-kit drum availability unavailable right now — the standard abbreviations usually work.)";
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
        "browser page is connected — followed by the groove rendered in grid notation (play_groove's X/x/o/g rows). " +
        "Read-only — call this to re-orient before editing, and prefer reading/editing the groove in the grid form.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (isUnavailable(sidecar)) return err(sidecar.unavailableError);
      const state = JSON.stringify(
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
      );
      // Grid rendering after the JSON so the model reads (and edits) the groove
      // in the same notation it writes (D-33) — includes any page click-edits.
      return ok(groove ? `${state}\n\nGrid:\n${renderGrid(groove)}` : state);
    },
  );

  return server;
}
