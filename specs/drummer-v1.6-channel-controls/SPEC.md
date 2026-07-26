# Drummer v1.6 — Channel Controls: Mute, Clear + Undo, UI Tempo, Pause Discipline — Spec

Status: in-progress
Branch: main (straight-to-main per D-12)

## Context Restore

Spec drafted 2026-07-26 right after v1.5 shipped (faders/cycle/count header live,
Adrian: "This is starting to get somewhere!"). His asks: (1) mute a channel;
(2) clear all hits on a channel, with undo; (3) change BPM from the UI; (4) grid
edits while the page is paused must not auto-resume audio. All server-owned and
LLM-visible like every prior page control. Decisions D-40..D-45 resolved (Adrian
via AskUserQuestion: empty rows persist after clear; undo covers ALL page edits;
his edits stay paused but LLM changes still un-pause). v1.5 M-final review is
running in parallel — fold any of its findings in before or during M1. No
milestone started. Key files: src/core/groove.ts (hits min 0 + muted),
compile.ts (skip empty/muted, silence fallback), edit.ts (clearTrack/muteTrack,
cycleStep keeps empty voice), grid.ts (renderGrid [muted]/empty rows),
src/server/sidecar.ts (PageEdit union + evaluate origin), tools.ts (undo stack,
teaching), page/main.js + index.html (buttons, BPM input, pause logic),
page/grid.js (pure bits), scripts/e2e.ts.

## Overview

Give each channel real mixer controls — mute and clear — plus a global undo and
a tempo control, and make pause behave like a musician expects. The enabling
model change: a voice may now have zero hits (D-40), so a cleared row stays on
screen (name, fader, mute) ready to be clicked back in, and cycling off a row's
last hit no longer deletes the row. Every control flows through the server-owned
merge and shows up in the LLM's grid rendering (`[muted]`, empty rows, tempo), so
the model always sees what the human did. A new `origin` tag on evaluates lets
the page distinguish "my own edit came back" (stay paused) from "the LLM changed
the music" (un-pause, as designed in v1.1).

## Goals / Non-Goals

Goals:
- Empty channels as first-class groove state (schema, compiler, edits, render).
- Per-channel mute (audio out, state kept) and clear (hits emptied, row kept).
- One undo stack for all page edits (clicks, faders, mutes, clears, tempo).
- BPM control on the page, bar-phase-preserving like set_tempo.
- Page-origin evaluates never un-pause a paused page; LLM-origin still do.

Non-Goals:
- No solo buttons, no redo, no undo of LLM edits (the stack clears when the LLM
  mutates the groove — undo never silently reverts the model's work).
- No per-channel volume automation or velocity-drag editing.
- No removal of removeDrums (deleting a row entirely stays an LLM operation).

## Functional Requirements

FR-1 (empty channels, D-40): `voices[i].hits` may be empty. parseGroove accepts
it; the compiler emits nothing for hitless voices; a groove whose voices are all
hitless (or all muted) compiles to Strudel silence, not invalid code. cycleStep
on a voice's last hit keeps the voice (row persists). gridModel/renderGrid show
the empty row. The "a voice needs at least one hit" error disappears from the
schema; teaching text explains `hits: []` keeps a row vs removeDrums deletes it.

FR-2 (mute, D-41): `voices[i].muted` boolean, default false. Muted voices are
skipped by the compiler (silent) but keep hits, trackGain, and their row. Page:
an M button per row toggles it (server merge `muteTrack`, toggle semantics);
muted rows render dimmed with the button lit. renderGrid appends `[muted]`
(composes with `[vol N%]`). D-38-style persistence: LLM voice replacement keeps
`muted` unless explicitly provided.

FR-3 (clear, D-40): a ✕ button per row empties that channel's hits via server
merge `clearTrack` (hits: [], everything else kept). The row stays. Confirmed
undoable (FR-4).

FR-4 (undo, D-42): the server keeps a stack (cap 20) of groove snapshots taken
before each successful page-originated edit (cycle, fader, mute, clear, tempo).
`undo` pops one and broadcasts it (page origin). The stack is CLEARED whenever
an LLM tool mutates the groove (play_groove, update_groove, set_kit, set_tempo)
— undo only spans consecutive human actions. Undo with an empty stack is a
no-op (logged to stderr, no push). Page: an ↩ button in the transport.

FR-5 (UI tempo, D-44): a BPM number input (40–300) in the transport sends
`{type:"setTempo", bpm}` on change. The server applies set_tempo semantics:
setCps push (no restart, bar phase kept) + setLastEvaluate with recompiled code
+ groove.tempoBpm updated + undo snapshot. Input value always tracks the
authoritative groove (LLM tempo changes move it). Invalid values are refused
server-side and the input snaps back on the next broadcast.

FR-6 (pause discipline, D-43): evaluate pushes carry `origin: "page" | "llm"`
(absent = "llm" for compatibility). A paused page receiving a page-origin
evaluate updates its grid/state but stays paused and silent, deferring the new
code until resume; an llm-origin evaluate un-pauses as today (v1.1 D-18
refined). A page that is not paused behaves exactly as today for both origins.

## Non-Functional Requirements

NFR-1: all merges pure in src/core; page never owns the groove; stdout sacred.
NFR-2: byte-identical compiled output for grooves using no new fields (muted
defaults false; the v1.4 snapshot test stays green untouched).
NFR-3: undo snapshots are deep copies capped at 20 — no unbounded growth over a
long jam.
NFR-4: existing pages/tools keep working mid-rollout: origin-less evaluates and
legacy toggleStep frames behave as before.

## Assumptions & Resolved Decisions

D-40: empty channels are legal groove state — Adrian 2026-07-26 (clear keeps the
row). Overturns v1.2's voice-drop-on-last-hit and the schema's min-1-hit rule.
D-41: mute is a separate boolean, not trackGain 0 — exploration 2026-07-26
(unmute must restore the fader exactly).
D-42: one undo stack for ALL page edits, cap 20, cleared on LLM mutation —
Adrian 2026-07-26 (chose over clear-only undo); LLM-clearing rule from
exploration (undo must never silently revert the model's work).
D-43: evaluate `origin` tag; page-origin never un-pauses, llm-origin does —
Adrian 2026-07-26 (chose over absolute pause).
D-44: UI BPM input reuses set_tempo semantics (setCps + setLastEvaluate, no
restart) — exploration 2026-07-26.
D-45: grid-notation all-rest rows are STILL skipped on input (placeholder
convention, v1.4) even though empty voices are now legal — an LLM wanting an
empty row sends `hits: []`. renderGrid does emit all-rest rows for empty
voices; that asymmetry is accepted and documented in teaching text.

## Architecture & Dependency Chain

src/core/groove.ts (hits min 0; muted flag)
  → src/core/compile.ts (skip hitless/muted; silence fallback)
  → src/core/edit.ts (clearTrack, muteTrack; cycleStep keeps empty voices)
  → src/core/grid.ts (renderGrid: empty rows, [muted])
    → src/server/sidecar.ts (SidecarPush origin; PageEdit += clearTrack/
      muteTrack/setTempo/undo)
    → src/server/tools.ts (undo stack + snapshot/clear rules; merge routing;
      muted persistence in update_groove; teaching text)
      → page/grid.js (gridModel muted flag)
      → page/main.js + index.html (M/✕ buttons, ↩ undo, BPM input, pause logic)
        → scripts/e2e.ts, README.md, CLAUDE.md

M1 = core (additive: nothing sends the new messages yet).
M2 = server + page + teaching + e2e. M-final = staff review.

## Milestones

### M1: Core — empty channels, mute, clear, silence fallback
- **Scope:** src/core/groove.ts, compile.ts, edit.ts, grid.ts; page/grid.js;
  test/core/*, test/page/grid.test.ts
- **Tasks (TDD):** hits min 0 + muted flag in schema; compiler skips hitless and
  muted voices and emits valid silence when nothing sounds; cycleStep keeps a
  voice at zero hits (update v1.2 drop tests — intentional, D-40); clearTrack +
  muteTrack pure merges; renderGrid renders empty rows and appends [muted]
  (composing with [vol]); gridModel exposes muted.
- **Acceptance criteria:** FR-1, FR-2 (core), FR-3 (core); NFR-1, NFR-2.
- **Test plan (write first):** schema: hits [] ok, muted default false/roundtrip;
  compile: hitless voice emits no stack entry, muted skipped, all-empty groove →
  silence code, snapshot test untouched; edit: clearTrack empties + keeps row,
  muteTrack toggles, cycleStep last-hit-off keeps voice (replaces drop test);
  renderGrid: empty row all rests, [muted], [vol 60%] [muted] combo; gridModel
  muted flag.
- **Verification:** `npm test`
- **Isolation note:** schema loosening is backward-compatible (old grooves stay
  valid); nothing sends clearTrack/muteTrack yet; compiled output for existing
  grooves byte-identical (NFR-2).
- **Status:** done (2026-07-26)

### M2: Wire + page — buttons, undo, BPM, pause discipline
- **Scope:** src/server/sidecar.ts, tools.ts; page/main.js, index.html;
  test/server/*; scripts/e2e.ts; README.md, CLAUDE.md
- **Tasks:** sidecar: evaluate origin field + routing for clearTrack/muteTrack/
  setTempo/undo (validated shapes); tools: undo stack (snapshot before each
  successful page edit, cap 20, cleared on LLM mutation, undo pops+broadcasts),
  setTempo edit path (setCps + setLastEvaluate like the tool), muted persistence
  in update_groove (D-38 pattern), teaching text (hits: [] vs removeDrums,
  [muted], undo existence so the LLM isn't surprised by reverts); page: M/✕ row
  buttons, ↩ undo + BPM input in transport (input tracks broadcasts), paused +
  page-origin evaluate → update grid, defer code, stay silent; e2e: mute
  silences a voice in the DSP capture, clear+undo round-trip, BPM input drives
  cps, paused-edit-stays-paused check.
- **Acceptance criteria:** FR-2..FR-6 complete; NFR-3, NFR-4.
- **Verification:** `npm test`; `npm run e2e`; live jam: Adrian mutes/clears/
  undoes/changes BPM and pauses+edits without auto-play.
- **Isolation note:** origin field is additive (old pages ignore unknown
  fields); new message types are opt-in; undo stack is session state only.
- **Status:** pending

### M-final: Staff-level peer review
- **Scope:** full v1.6 diff + this SPEC.md
- **Tasks:** spec-reviewer as staff engineer: FR/NFR coverage implemented AND
  tested, D-40..D-45 followed, isolation held, undocumented deviations flagged.
- **Acceptance criteria:** zero unaddressed confirmed findings; accepted ones
  recorded as D-*.
- **Verification:** full suite + e2e green; review summarized to Adrian.
- **Status:** pending

## Progress Log

- 2026-07-26: M1 done — hits min-0 + muted in schema, compiler skips muted/
  hitless voices and falls back to `$: silence`, clearTrack/muteTrack pure
  merges, cycleStep keeps empty voices (v1.2 drop tests replaced per D-40),
  renderGrid empty rows + [muted] (composes with [vol]), gridModel muted flag.
  196 unit tests green. Folded in v1.5 M-final MINOR-1: toggleStep +
  CLICK_VELOCITY deleted (dead since v1.5 wired cycleStep; D-19 residue gone).

- 2026-07-26: Spec drafted. D-40/42/43 decided by Adrian (AskUserQuestion),
  D-41/44/45 by exploration. Pause complaint captured verbatim: "If it's paused
  and I edit the grid, I don't want it to auto play."
