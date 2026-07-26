# Drummer v1.4 — Grid Notation & Groove Musicianship — Spec

Status: in-progress
Branch: main (straight-to-main per D-12)

## Context Restore

M1 and M2 DONE 2026-07-26 (M1 commit c52e9fc). Core: src/core/grid.ts
(gridToVoices + renderGrid), parseGroove accepts `grid` XOR `voices`; letters
X/x/o/g = 1/0.7/0.5/0.25, O alias, all-rest rows skipped, fixed 5-char row
prefix, "|" per beat, "||" between bars, snap midpoints 0.85/0.6/0.375. Tools:
grid field on play_groove + update_groove (update converts rows with merged
bars/resolution, replaces voices by drum; grid+voices or grid∩removeDrums →
errors), play/update responses append renderGrid, now_playing appends
"\n\nGrid:\n<render>" after the JSON (e2e + tests parse JSON via
split("\n\nGrid:")[0]), play_groove description = GRID_GUIDE + MUSICIANSHIP +
GROOVE_GUIDE. README/CLAUDE.md/IDEAS.md updated (GrooVAE humanizer parked,
D-34). 158 unit tests green, e2e 29/29. REMAINING: live-jam smoke (driver
relaunched on new build — watch it author in grid, Adrian ear-check), then
M-final staff review → Status done.

## Overview

Add a drum-tab "grid" authoring format to the groove schema: one pattern string per
drum, one character per step, letters encode four velocity tiers. The LLM sees and
writes vertically-aligned rows, so kick/snare/hat relationships are visible in the
notation itself — the representation research shows LLMs reason over drum grooves
best. `now_playing` and groove-accepting tool responses render the active groove
back in the same notation so iteration happens in grid-space. Tool descriptions
gain a musicianship layer (accent hierarchy, continuous timekeeper, ghost notes,
swing) so the model is taught what makes a groove feel human, not just how to
encode hits. The existing JSON `voices` format stays for fine control (exact vel,
micro) and remains what the compiler/page/edit pipeline consume internally.

## Goals / Non-Goals

Goals:
- Grid notation accepted by play_groove/update_groove and rendered in responses.
- Grid→voices conversion is pure core logic with LLM-actionable errors (FR-9 style).
- Tool descriptions teach groove craft (extends v1 FR-10).

Non-Goals:
- No change to compiler output, page, WS protocol, or edit pipeline (they keep
  consuming `voices`).
- No per-hit micro in grid notation (JSON hits format covers it; swing covers feel).
- No neural humanizer (GrooVAE-style post-processor recorded as a future idea).
- No time signatures beyond 4/4 (unchanged from v1).

## Functional Requirements

FR-1 (grid input): `groove.grid` — an object mapping drum abbr → pattern string —
is accepted by play_groove and update_groove anywhere `groove.voices` is. Exactly
one of `grid`/`voices` per call; both or neither → LLM-actionable error.

FR-2 (notation): per row, one character per step. `X` = accent (vel 1.0),
`x` = normal (0.7), `o` = soft (0.5), `g` = ghost (0.25). `O` is accepted as an
alias of `X` (paper notation). `-` and `.` are rests. `|` and spaces are cosmetic
separators, stripped before parsing. Unknown characters → error naming the
character, its row, and the legal set.

FR-3 (dimensions): after stripping separators, every row must have exactly
`bars × resolution` characters. Errors state the expected count, the actual count,
and the row — e.g. "grid row \"hh\": 16 steps but bars=2 × resolution=16 needs 32".
Unknown drum keys get the FR-9-style valid-drums list. Duplicate-voice and
step-range guarantees of parseGroove hold for grid input too.

FR-4 (round-trip): `now_playing`, `play_groove`, and `update_groove` responses
render the current groove as grid text (rows sorted in page ROW_ORDER, beat
separators every resolution/4 chars, `||` between bars). Velocities snap to the
nearest of the four letters for display; the JSON groove stays in the response, so
nothing is lost. Page cell edits (v1.2) show up in the next rendering.

FR-5 (musicianship teaching): play_groove's description carries the notation
manual (legend + a real 1-bar funk example with aligned rows) and a groove-craft
checklist: timekeeper voice nearly never rests; accents follow the music (back-beats
strongest, no uniform velocities, no mechanical ramps); snare ghosts between
back-beats; swing 0.15–0.35 for swung feels; kick/snare converse rather than stack.
update_groove/now_playing descriptions point back to the notation.

FR-6 (fine control preserved): the JSON `voices` format remains fully supported
and documented as the escape hatch for exact velocities and per-hit micro (FR-7 of
v1 untouched).

## Non-Functional Requirements

NFR-1: grid parsing lives in src/core (pure, no I/O), same error-message discipline
as parseGroove (name the offending value, state the fix).
NFR-2: machine-bank and existing-JSON behavior byte-identical — all v1–v1.3 tests
stay green untouched (except tool-description assertions that intentionally change).
NFR-3: stdout stays sacred; no new logging.

## Assumptions & Resolved Decisions

D-30: 4-letter velocity notation (X/x/o/g = 1.0/0.7/0.5/0.25) — decided by Adrian
2026-07-26 (AskUserQuestion; chosen over letters+digits and paper-exact 2-level).
Rationale: reads like drum tab, maps onto the acoustic kit's real dynamic tiers
(FF/F/MP/Ghost); JSON hits remain for in-between values.
D-31: `grid` and `voices` are mutually exclusive per call — exploration finding
2026-07-26. Merging two formats in one groove invites ambiguity; the error message
tells the model to pick one.
D-32: grid implies no micro; humanization via global `swing` + velocity letters —
exploration finding 2026-07-26. Per-hit micro stays JSON-only.
D-33: responses render grooves back in grid notation (round-trip) — 2026-07-26.
The model should read grooves in the same representation it writes them.
D-34: research anchor — "Not that Groove: Zero-Shot Symbolic Music Editing"
(arXiv:2505.08203) validates spatial drumroll text grids for LLM groove work;
GrooVAE/Groove MIDI Dataset humanizer recorded in IDEAS.md as a possible future
post-processor, not in scope.

## Architecture & Dependency Chain

src/core/grid.ts (new: gridToVoices, renderGrid — pure)
  → src/core/groove.ts (parseGroove accepts `grid`, converts, then validates as today)
    → src/server/tools.ts (descriptions teach notation + craft; responses embed renderGrid)
      → README.md (notation section)

Compiler, sidecar, page, edit pipeline: untouched (consume `voices` as before).
M1 = core links (grid.ts + groove.ts), M2 = tools + docs, M-final = review.

## Milestones

### M1: Core grid notation (parse + render)
- **Scope:** src/core/grid.ts (new), src/core/groove.ts, test/core/grid.test.ts,
  test/core/groove.test.ts
- **Tasks:** TDD gridToVoices (legend, aliases, separators, dimension checks,
  actionable errors); renderGrid (ROW_ORDER rows, beat/bar separators, nearest-letter
  snap); parseGroove accepts `{grid}` XOR `{voices}`.
- **Acceptance criteria:** FR-1, FR-2, FR-3, render half of FR-4; NFR-1, NFR-2.
- **Test plan (write first):**
  - parses the 4 letters + O alias to exact vels; `-`/`.` rests; strips `|`/spaces
  - rejects unknown char / unknown drum / wrong row length / grid+voices / neither,
    each with the specified message shape
  - resolution 12 and bars 2 dimension math
  - renderGrid: separators at resolution/4, `||` between bars, ROW_ORDER ordering,
    nearest-letter snapping (0.95→X, 0.6→x, 0.3→g)
  - round-trip: gridToVoices(renderGrid(g)) preserves steps and letter-tier vels
  - existing parseGroove suite untouched and green
- **Verification:** `npm test`
- **Isolation note:** additive schema path; nothing calls gridToVoices yet; `voices`
  callers byte-identical (NFR-2).
- **Status:** done (2026-07-26, see Progress Log)

### M2: Tool surface — teach the notation, render the round-trip
- **Scope:** src/server/tools.ts, test/server/tools.test.ts, README.md, CLAUDE.md
- **Tasks:** input schemas mention `grid`; play_groove description = notation manual
  + musicianship checklist (FR-5); update_groove/now_playing reference it; all three
  responses embed renderGrid output; README notation section; CLAUDE.md layout note.
- **Acceptance criteria:** FR-4, FR-5, FR-6; NFR-2, NFR-3.
- **Test plan (write first):**
  - play_groove with grid input plays (state.code contains compiled pattern)
  - grid+voices / neither → isError with actionable text
  - now_playing response contains grid rendering with aligned rows
  - update_groove with grid row replaces that voice, response re-renders
  - descriptions contain legend chars, checklist keywords ("ghost", "swing",
    "back-beat", timekeeper rule)
- **Verification:** `npm test`; `npm run e2e` (unchanged 29 checks stay green);
  live jam smoke: relaunch driver, ask for a funk groove, confirm it authors in grid
  notation and Adrian ear-checks the feel.
- **Isolation note:** responses gain text, existing fields unchanged; JSON voices
  path untouched.
- **Status:** done (2026-07-26; live-jam ear check pending with Adrian, see log)

### M-final: Staff-level peer review
- **Scope:** full v1.4 diff + this SPEC.md
- **Tasks:** spec-reviewer as staff engineer: FR/NFR coverage implemented AND
  tested, D-30..D-34 followed, milestone isolation held, any undocumented deviation.
- **Acceptance criteria:** zero unaddressed confirmed findings; accepted deviations
  recorded as D-*.
- **Verification:** full suite + e2e green; review summarized to Adrian.
- **Status:** pending

## Progress Log

- 2026-07-26: M2 done — grid on the tool surface (play/update input, renderGrid in
  play/update/now_playing responses, GRID_GUIDE + MUSICIANSHIP teaching), README/
  CLAUDE.md/IDEAS.md updated. 158 unit, e2e 29/29. Deviations: (1) now_playing
  response is JSON + "\n\nGrid:" section — existing tests and scripts/e2e.ts
  parse sites updated to split on the marker (intentional FR-4 shape change);
  (2) update_groove treats all-rest rows as placeholders (skipped), description
  says use removeDrums to drop a drum. Old jam driver/server from v1.3 killed
  (port 4747 housekeeping done).

- 2026-07-26: M1 done — grid.ts (parse+render) + parseGroove grid support, 20 tests, 149 green, no deviations from plan.
- 2026-07-26: Spec approved by Adrian ("lets go").
- 2026-07-26: Spec drafted from Adrian's "grooves feel fake/amateurish" feedback.
  Diagnosis from the real Low Rider driver JSON: hidden cross-voice alignment,
  formulaic velocity ramps, zero swing/micro, wrong resolution choice. Notation
  decision D-30 made via AskUserQuestion. Research anchors D-34.
