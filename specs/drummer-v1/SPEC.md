# AI Drummer v1 — Spec

Status: approved
Branch: main (user directive 2026-07-25: no feature branches — commit and push straight to main)

## Context Restore

M1 complete 2026-07-25: TS project scaffolded (tsc build, vitest, MIT LICENSE with AGPL runtime note); `src/core/groove.ts` (zod schema, `parseGroove` returning `{ok}|{error}` with LLM-actionable messages), `src/core/compile.ts` (`compileGroove` → Strudel code: aligned `.gain()` grids, swing+micro as per-delay-group `.late()/.early()` emitted as `d/(bars*res)` so pre-`.slow()` stretching lands exactly d real steps — see comment in compile.ts), `src/core/kits.ts` (BANKS/DRUMS). 28 tests green. **Next: M2** (sidecar + page + capture harness). Work on `main`, push after each milestone (D-12). Audio verified WITHOUT human listening per D-13 (headless capture → DSP assertions → Gemini on VPS via `vps` tailscale ssh → WAVs to user, non-blocking; user cannot use audio).

## Overview

An open-source conversational AI drummer. The user talks to an LLM in any MCP client ("give me a beat like Brick House", "more hi-hat"); the LLM translates song/groove knowledge into a structured groove and calls drummer-vocabulary MCP tools; our TypeScript MCP server compiles the groove to Strudel code and pushes it over websocket to a local browser page (served by the same process) where `@strudel/web` loops it through real drum-machine samples (TR-808/909, LinnDrum, etc.). Changes apply click-free at the next bar boundary. No existing project occupies this niche (verified 2026-07-25); all substantial prior art is AGPL and architecturally different, so we build fresh.

## Goals / Non-Goals

**Goals**
- Talk → beat plays → iterate, at jam-session quality (ghost notes, swing, micro-timing).
- Any MCP client (Claude Code / Claude Desktop) is the chat surface; we ship a server only.
- Whole repo MIT; nothing AGPL or license-unclear bundled or redistributed.

**Non-Goals (this spec)**
- Voice input (later; arrives via MCP clients / OS dictation).
- Listening to / following the user's playing (audio input analysis).
- Non-drum instruments (bass, keys, arrangements).
- MIDI/WAV export.
- Offline operation (requires sample-license verification first; possible later milestone).
- Publishing/marketing polish (npm publish, demo video, community docs). Repo works from clone.

## Functional Requirements

- FR-1: A `play_groove` tool accepts a structured groove (see schema in Architecture) and starts looped playback in the connected browser page. If a groove is already playing, it is replaced.
- FR-2: Groove changes while playing (new `play_groove` or partial `update_groove` per-voice edits) take effect at the **next bar boundary**, click-free, without restarting the clock or losing cycle phase.
- FR-3: A `set_tempo` tool changes BPM mid-playback without stopping or losing phase.
- FR-4: A `set_kit` tool switches the drum-machine sample bank mid-playback; a `list_kits` tool enumerates available banks (from tidal-drum-machines: RolandTR808, RolandTR909, RolandTR707, LinnDrum, AkaiMPC60, OberheimDMX, EmuSP12, …).
- FR-5: A `stop` tool halts playback; a subsequent `play_groove` starts fresh.
- FR-6: A `now_playing` tool returns current state: groove JSON, tempo, kit, playing/stopped, page-connected status.
- FR-7: The groove schema carries **per-hit velocity** and **per-hit micro-timing offset**, plus global swing — and the compiled output audibly reflects them (ghost notes quieter, swung hats swing).
- FR-8: The server serves a local page (`http://localhost:<port>`) that: connects to the server via websocket with auto-reconnect, requires one click to arm audio (browser autoplay policy), displays current pattern/tempo/kit and connection status, and pre-warms samples on kit selection to avoid first-hit dropouts.
- FR-9: Tool errors are returned as MCP `isError` results with actionable text (invalid groove, no page connected + the URL to open, port in use), never thrown protocol errors for business failures.
- FR-10: Tool descriptions teach the LLM the drummer vocabulary and groove-authoring guidance (drum abbreviations, velocity conventions for ghost notes, typical genre feels) so any frontier model can drive it without external docs.

## Non-Functional Requirements

- NFR-1: Instruction-to-audible-change latency ≤ 5 s including bar quantization (tool call itself returns fast; the page applies at next bar).
- NFR-2: stdio hygiene — no library or app code ever writes to stdout (corrupts JSON-RPC); logging goes to stderr.
- NFR-3: Lifecycle — when the MCP transport closes, the HTTP/WS sidecar and all timers shut down; no orphaned processes or ports. Port collision (second Claude session) fails tools with an actionable error naming the port.
- NFR-4: Licensing — all authored code MIT. `@strudel/web` (AGPL) loaded unmodified from unpkg at page runtime; samples loaded from Strudel's CDN at runtime. Nothing AGPL/unverified enters the repo or any built artifact.
- NFR-5: Platform — macOS, Node ≥ 20, current Chrome/Safari for the page. Internet required at play time (CDN assets).
- NFR-6: Tests — vitest; the groove→Strudel compiler and schema validation are fully unit-tested; server behaviors covered by integration tests using SDK in-memory transport.

## Assumptions & Resolved Decisions

- D-1: Symbolic patterns + real samples, not neural audio — user, 2026-07-25 (pre-spec research).
- D-2: Strudel-based engine — user, 2026-07-25.
- D-3: MCP-server-only surface; existing MCP clients are the chat UI — user, 2026-07-25.
- D-4: Playback = visible local page kept open (not headless) — user, 2026-07-25.
- D-5: Voice input out of scope for v1 — user, 2026-07-25.
- D-6: MIT license; user confirmed after MIT-vs-AGPL discussion — user, 2026-07-25.
- D-7: Runtime CDN loading of Strudel + samples (no bundling/vendoring); repo stays pure MIT; internet required — user, 2026-07-25.
- D-8: Build fresh, no fork — exploration: all substantial prior art AGPL (viral) and architecturally mismatched; niche ("drummer-vocabulary MCP") confirmed unoccupied — 2026-07-25.
- D-9: TypeScript, `@modelcontextprotocol/sdk` ^1.29.0 (v2 still beta), `McpServer`+`registerTool`+zod, stdio transport, plain `tsc` build, vitest — exploration (matches official reference servers) — 2026-07-25.
- D-10: Bar-boundary quantization implemented client-side in the page: Strudel's re-evaluate preserves clock phase but swaps at next ~50 ms tick, so the page computes time-to-next-cycle from scheduler state and delays `setPattern` — exploration, 2026-07-25.
- D-11: One Strudel cycle = one bar; tempo expressed as BPM in 4/4 via `setcpm(bpm/4)` — assumption (standard Strudel practice), 2026-07-25.
- D-12: Trunk-based workflow — commit and push straight to `main`; no feature branches or PRs for this project — user, 2026-07-25.
- D-13: Audio verification is automated, never dependent on human listening — user (can't use audio in current environment), 2026-07-25. Three layers: (1) Playwright headless-Chrome capture harness records page output to WAV via MediaStreamAudioDestinationNode + MediaRecorder; Node-side DSP assertions on onsets vs step grid, tempo from inter-onset intervals, ghost-vs-accent RMS ratio, measured swing, loop-seam continuity, post-stop silence. (2) Subjective listener: WAVs sent to the VPS where Gemini (native audio understanding) judges groove feel and artifacts. (3) WAV artifacts delivered to the user at checkpoints for eventual ear-check — non-blocking.
- A-1: Single simultaneous jam session per server instance (per MCP client session) is acceptable.
- A-2: The LLM authors grooves from its own song/theory knowledge; the server never resolves song names (also keeps us clear of copyright questions).

## Architecture & Dependency Chain

```
MCP client (Claude Code/Desktop) — chat surface (not ours)
  → MCP tool surface (src/server/tools.ts)          [M3]
    → session state + groove compiler (src/core/*)  [M1]
    → sidecar HTTP+WS server (src/server/sidecar.ts)[M2]
      → browser page (page/*) — @strudel/web via CDN [M2]
```

Planned layout:

```
src/core/groove.ts      # groove schema (zod) + validation      [M1]
src/core/compile.ts     # groove JSON → Strudel code string     [M1]
src/core/kits.ts        # curated bank list + drum voice names  [M1]
src/server/sidecar.ts   # http static + ws push, port handling  [M2]
page/index.html|main.js # Strudel client, quantize, reconnect   [M2]
src/server/tools.ts     # MCP tools, state, error mapping       [M3]
src/index.ts            # entry: McpServer + stdio + sidecar    [M3]
test/                   # vitest                                 [M1–M3]
```

Groove schema (shape; exact zod in M1):

```jsonc
{
  "tempoBpm": 100,
  "swing": 0.12,            // 0..~0.6, fraction of a 16th
  "bank": "RolandTR808",
  "bars": 1,                // 1–4 bar loop
  "resolution": 16,         // steps per bar (16ths); 12/24 for triplet feels
  "voices": [
    { "drum": "bd", "hits": [ { "step": 0, "vel": 1.0, "micro": 0 }, ... ] },
    { "drum": "sd", "hits": [ { "step": 4, "vel": 0.95 }, { "step": 7, "vel": 0.25 } ] }  // ghost note
  ]
}
```

Dependency order (deepest → outermost): core schema/compiler (pure, no I/O) → sidecar + page (runnable standalone via a dev script, no MCP) → MCP tool surface (consumes both) → docs/registration polish. Each milestone maps to one link.

## Milestones

### M1: Groove schema + Strudel compiler (core, pure)
- **Scope:** `src/core/groove.ts`, `src/core/compile.ts`, `src/core/kits.ts`, project scaffolding (package.json, tsconfig strict, vitest, MIT LICENSE), `test/core/*`.
- **Tasks:** scaffold TS project per D-9; define zod groove schema with validation messages written for LLM self-correction; implement compiler emitting Strudel code (voices → `stack()` of `s(...)` patterns with `.bank()`, per-hit velocity via gain, micro-timing via per-hit offset, swing applied to off-16ths, `setcpm(bpm/4)`); curated kit list with human descriptions ("RolandTR808 — boomy hip-hop/electro").
- **Acceptance criteria:** satisfies FR-7 (schema+compiler side), groundwork for FR-1/FR-4; NFR-4 (LICENSE), NFR-6.
- **Test plan (write first):** `groove.schema.test.ts` — valid groove passes; bad drum name / step ≥ bars×resolution / vel>1 fail with actionable messages. `compile.test.ts` — kick-on-quarters compiles to expected pattern; ghost note yields lower gain than accent; swing≠0 shifts off-beat 16ths; micro offset appears; bank name appears; triplet resolution (12) compiles; deterministic output (same input → same string).
- **Verification:** `npm test` green; `npm run build` clean. Audible correctness of compiled output is verified in M2 via the capture harness (D-13) — M1 asserts on the compiled code string only.
- **Isolation note:** pure library, nothing consumes it yet; repo remains docs-only for any other reader.
- **Status:** done (2026-07-25, see Progress Log)

### M2: Sidecar server + Strudel page
- **Scope:** `src/server/sidecar.ts`, `page/`, `scripts/dev-jam.ts` (pushes a hardcoded compiled groove without MCP), `scripts/capture.ts` (D-13 harness: Playwright headless Chrome → MediaRecorder WAV → onset/RMS/swing analysis), `test/server/sidecar.test.ts`.
- **Tasks:** HTTP server (static page + WS upgrade) on configurable port (default 4747, `AI_DRUMMER_PORT` override) with EADDRINUSE → clear error; WS protocol `{type: evaluate|hush|setCps, code?, cps?}` + page→server `{type: status}` heartbeat; page loads `@strudel/web@1.3.0` from unpkg, `initStrudel` with tidal-drum-machines prebake from Strudel CDN, click-to-arm overlay, **bar-boundary quantize** (delay incoming evaluate to next cycle start per D-10), auto-reconnect, current code/tempo/connection display, sample pre-warm on bank change.
- **Acceptance criteria:** satisfies FR-8; FR-2 mechanism (quantize) proven; NFR-1, NFR-3 (shutdown + port error), NFR-5.
- **Test plan (write first):** sidecar unit/integration — serves page HTML; accepts WS and delivers evaluate payloads (mock client); port-in-use path returns typed error; `close()` frees port and terminates WS clients. Page quantize helper (pure function extracted): given cycle position + cps, computes correct delay — unit-tested in vitest. Browser behaviors (autoplay arm, real audio) — manual checklist, scripted via `dev-jam.ts`.
- **Verification:** `npm test`; run the D-13 capture harness against `dev:jam`: assert onsets match the groove grid at the right tempo, ghost RMS < accent RMS, mid-playback groove swap lands on a bar boundary with no discontinuity at the seam, `hush` → silence; send the captured WAVs to the VPS for a Gemini listen (groove feel, clicks/artifacts) and deliver them to the user as checkpoint artifacts (non-blocking); kill script and confirm port released.
- **Isolation note:** standalone dev script is the only consumer; no MCP surface exists yet; M1 API unchanged.
- **Status:** pending

### M3: MCP tool surface + end-to-end
- **Scope:** `src/server/tools.ts`, `src/index.ts`, `test/server/tools.test.ts`, `.mcp.json.example`.
- **Tasks:** `McpServer` with tools `play_groove`, `update_groove`, `set_tempo`, `set_kit`, `list_kits`, `stop`, `now_playing`; in-process session state (current groove/tempo/kit/page-connected); tool handlers validate via M1 schema, compile, push via M2 sidecar; `isError` results per FR-9 (incl. "page not open — open http://localhost:4747 and click Start"); tool descriptions per FR-10 (drummer vocabulary, ghost-note velocity conventions, genre feel hints); annotations (`readOnlyHint` on `list_kits`/`now_playing`); stderr-only logging audit; transport-close → sidecar shutdown.
- **Acceptance criteria:** satisfies FR-1..6, FR-9, FR-10; NFR-2, NFR-3 end-to-end.
- **Test plan (write first):** in-memory-transport integration tests — each tool happy path mutates state and emits expected WS payload (mock sidecar); `play_groove` with invalid groove → `isError` + actionable message; tools with no page connected → `isError` naming the URL; `now_playing` reflects prior calls; `stop` then `play_groove` restarts clean. Static test: grep-level check that no source file calls `console.log`.
- **Verification:** `npm test`; register locally (`claude mcp add ai-drummer -- node <abs>/dist/index.js`); in a fresh Claude Code session say "give me a beat like Brick House, then make the hats busier" while the capture harness records the page: confirm via analysis + Gemini listen (D-13) that a funk-feel groove is playing ≤ 15 s after the ask and the hat change lands on a bar boundary ≤ 5 s after the follow-up; `now_playing` accurate; WAVs delivered to user; two-session port-collision message verified.
- **Isolation note:** consumes M1/M2 through their existing APIs; nothing external depends on the MCP surface until registered by the user.
- **Status:** pending

### M4: Docs & jam-readiness polish
- **Scope:** README.md (rewrite: install, register, jam quickstart, tool reference), RESEARCH.md addendum, SAMPLES.md (CDN sources + license status incl. unverified WAV note), CLAUDE.md refresh, LICENSE header check.
- **Tasks:** clone-to-jamming instructions verified on a clean checkout; document port/env config, troubleshooting (autoplay, port collision, no internet); record AGPL boundary rationale (D-7) in README licensing section.
- **Acceptance criteria:** repo "works from clone" (scope decision from intake); NFR-4 documented.
- **Test plan:** N/A (docs); verification is the clean-clone walkthrough.
- **Verification:** fresh `git clone` to a temp dir → follow README verbatim → jamming, no undocumented steps.
- **Isolation note:** docs only.
- **Status:** pending

### M-final: Staff-level peer review
- **Scope:** the entire feature branch diff + this SPEC.md.
- **Tasks:** launch the spec-reviewer agent as a staff-level engineer: verify every FR/NFR is implemented and tested, every D-* followed, every milestone's isolation guarantee held; flag ANY deviation from the plan, including undocumented ones not in the Progress Log.
- **Acceptance criteria:** zero unaddressed confirmed findings; every deviation either fixed or explicitly accepted by the user and recorded as a new D-* entry.
- **Verification:** full test suite green + review report summarized to the user.
- **Status:** pending

## Progress Log

- 2026-07-25 — Spec drafted from intake (2 AskUserQuestion rounds) + 3-agent exploration (Strudel embedding, MCP landscape, MCP TS SDK). Key exploration facts folded into decisions D-8..D-11. Awaiting sign-off.
- 2026-07-25 — Approved. D-12 (straight-to-main) and D-13 (automated audio verification: capture harness + DSP asserts + Gemini listener on VPS) added; M1/M2/M3 verification steps rewritten to remove human-listening dependencies.
- 2026-07-25 — **M1 done.** TDD red→green, 28 tests. Deviations: none from plan. Discoveries worth keeping: (1) `.late()` before `.slow(bars)` is stretched by the slow factor, so delays are emitted as `d/(bars*resolution)` — documented in compile.ts header; (2) zod default() on hit.vel/micro means compiler can assume both always present; (3) per-hit micro/swing forces splitting voices into delay-groups (one stack entry per distinct delay) since mini-notation can't shift individual events — deterministic ordering by ascending delay keeps output stable for tests.
