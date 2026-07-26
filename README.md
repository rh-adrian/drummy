# AI Drummer

An open-source AI drummer you can talk to and jam with.

Say *"hey, give me a beat like Brick House"* and a groove starts playing through real
TR-808 / LinnDrum / MPC60 samples in your browser. Say *"more hi-hat, make it swing"*
and the change lands at the next bar boundary, click-free.

There's no app and no UI to learn: it's an [MCP](https://modelcontextprotocol.io) server,
so any MCP client — Claude Code, Claude Desktop — is the chat surface. The LLM authors
the groove from its own song and music-theory knowledge; this server compiles it to
[Strudel](https://strudel.cc) code and streams it to a local browser page that loops it.

## Quickstart (clone → jamming)

Requirements: macOS (Linux likely works but is untested), Node ≥ 20, a current
Chrome/Safari, internet at play time
(Strudel + samples load from CDNs), and an MCP client.

```bash
git clone https://github.com/rh-adrian/ai-drummer.git
cd ai-drummer
npm install
npm run build
```

Register with Claude Code (`-s user` makes it available in every session):

```bash
claude mcp add -s user ai-drummer -- node "$PWD/dist/index.js"
```

For Claude Desktop or other MCP clients, copy [.mcp.json.example](.mcp.json.example)
into your client's MCP config and fix the absolute path.

Then jam:

1. Start a new session in your MCP client (the server starts with it).
2. Open **http://localhost:4747** and click **▶ Start** — one click is required by
   browser autoplay policy. Leave the tab open: it shows the groove as a live step
   grid (one row per drum, cells lit by velocity, a playhead sweeping in time) with
   tempo, kit, and connection status, plus a play/pause button and the compiled
   Strudel code behind a "show code" toggle. **Click any cell to toggle that step** —
   your edits land in the same groove the LLM works on, so "make it swing" after your
   tweak keeps your tweak.
3. Ask for a beat: *"give me a beat like Brick House"*, *"a dusty 90 BPM boom-bap
   groove"*, *"four-on-the-floor house at 124"*.
4. Iterate: *"busier hats"*, *"add ghost notes on the snare"*, *"halftime it"*,
   *"try it on the 909"*, *"slow it down to 95"*.

No MCP client handy? `npm run dev:jam` plays a canned groove through the same page.

## The tools (what the LLM drives)

| Tool | What it does |
|------|--------------|
| `play_groove` | Start (or replace) the looping groove from a structured groove JSON |
| `update_groove` | Partial edit of the playing groove — only the changed fields are sent |
| `set_tempo` | Change BPM smoothly without restarting the loop or losing bar phase |
| `set_kit` | Same pattern, different drum machine's samples |
| `list_kits` | Available banks with sound descriptions + which drums each provides |
| `stop` | Silence; a later `play_groove` starts fresh |
| `now_playing` | Current state: groove, tempo, kit, playing/stopped, page connected |

The tool descriptions teach the model the drummer vocabulary (drum abbreviations,
ghost-note velocity conventions, swing semantics, genre sketches), so any frontier
model can drive it with no external docs.

A groove is a bar grid — `resolution` steps per bar × `bars`, one voice per drum:

```jsonc
{
  "tempoBpm": 100,
  "swing": 0.12,          // 0–0.6, fraction of a step; delays every odd step
  "bank": "RolandTR808",  // see list_kits
  "bars": 1,              // 1–4
  "resolution": 16,       // steps per bar: 8, 12, 16, 24, 32 (12/24 = triplet feels)
  "voices": [
    { "drum": "bd", "hits": [ { "step": 0 }, { "step": 7, "vel": 0.9 }, { "step": 10 } ] },
    { "drum": "sd", "hits": [ { "step": 4 }, { "step": 12 },
                              { "step": 6, "vel": 0.25 } ] },   // ghost note
    { "drum": "hh", "hits": [ { "step": 0, "vel": 0.6 }, { "step": 2, "vel": 0.5 } /* … */ ] }
  ]
}
```

**Per-hit velocity and per-hit micro-timing (`micro`, push/drag) are first-class** —
that's the difference between a robotic grid and something that feels like Brick House.

## How it works

```
MCP client (Claude Code / Desktop) — the chat surface
  → MCP server (stdio)            src/server/tools.ts   drummer-vocabulary tools
    → groove schema + compiler    src/core/*            groove JSON → Strudel code
    → HTTP+WS sidecar             src/server/sidecar.ts serves the page, pushes code
      → browser page              page/                 @strudel/web via CDN, loops it
```

Everything runs in one process launched by your MCP client. The page connects back over
a websocket, applies incoming patterns at the **next bar boundary** (Strudel's clock
phase is preserved, so swaps are click-free and never lose their place), heartbeats its
status, and auto-reconnects. Real-time control is a non-goal — a change landing at the
top of the next bar (~2–4 s) is how you'd count a band in anyway.

## Configuration

| Env var | Default | Meaning |
|---------|---------|---------|
| `AI_DRUMMER_PORT` | `4747` | Port for the page + websocket sidecar |

Set it in the MCP registration, e.g.
`claude mcp add -s user ai-drummer -e AI_DRUMMER_PORT=5757 -- node "$PWD/dist/index.js"`.

## Troubleshooting

- **No sound** — you must click **▶ Start** on the page once per load (browser
  autoplay policy). The tab must stay open; audio keeps playing in a background tab.
  Also check the page's own play/pause button (next to the tempo) isn't showing ▶ —
  it pauses locally without the LLM knowing to restart.
- **"No drummer page is connected"** — the tool result already says it: open
  http://localhost:4747 and click Start, then ask again.
- **"port 4747 is already in use"** — another ai-drummer session (another Claude
  window?) owns the port. One jam session per port: close the other session, or give
  this one its own `AI_DRUMMER_PORT`.
- **No internet** — playback needs it: the page loads `@strudel/web` from unpkg and
  samples from Strudel's CDN at runtime (see Licensing). Offline mode would require
  vendoring samples, which is blocked on license verification ([SAMPLES.md](SAMPLES.md)).
- **First hit of a freshly-switched kit sounds clipped** — can happen once on very slow
  connections while samples stream in; the next bar is fine.
- **Page shows connected but tools say it isn't** — a tab left hidden *and stopped* for
  5+ minutes gets its timers throttled by Chrome, which stalls the heartbeat. Focus or
  reload the tab.

## Development

```bash
npm test          # vitest — schema, compiler, sidecar, MCP tools (in-memory transport)
npm run dev:jam   # sidecar + canned groove, no MCP client needed
npm run e2e       # full stack: real stdio server + headless Chrome + audio assertions
npm run capture   # DSP verification harness: onset grid, tempo, ghost/accent RMS, swing
```

`e2e` and `capture` drive a headless Chrome via Playwright — run
`npx playwright install chromium` once first. They record the page's actual audio
output to WAV and assert on it (onsets on the grid, measured tempo, ghost notes quieter
than accents, bar-boundary swap continuity, post-stop silence): audio correctness is CI-checkable,
not ear-checked. Development is spec-driven; [specs/drummer-v1/SPEC.md](specs/drummer-v1/SPEC.md)
is the source of truth for requirements, decisions, and progress.

Background reading: [RESEARCH.md](RESEARCH.md) (landscape analysis and why symbolic
beats neural audio here), [IDEAS.md](IDEAS.md) (parked future expansions, e.g.
mouthed-bassline → bass MIDI).

## Licensing

This repo is **MIT** — all code here is ours and freely licensed.

Two things it deliberately does **not** contain:

- **Strudel** (`@strudel/web`, AGPL-3.0-or-later) — loaded unmodified from unpkg by
  *your browser* at page runtime. It is not bundled, linked, imported, or redistributed
  by this project; the server only ever emits Strudel *source code as text*. AGPL
  obligations attach to Strudel itself (which is already open), not to this repo.
- **Drum samples** (tidal-drum-machines) — streamed from Strudel's CDN by the browser.
  The individual WAV licenses are unverified upstream, so they stay out of the repo
  entirely. Sources and license status are tracked in [SAMPLES.md](SAMPLES.md).

The trade-off is deliberate: internet required at play time, in exchange for a repo
that is pure MIT with zero license ambiguity.
