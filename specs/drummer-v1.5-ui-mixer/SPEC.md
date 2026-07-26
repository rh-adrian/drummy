# Drummer v1.5 — Count Header, Track Volume, Velocity Cell Editing — Spec

Status: in-progress
Branch: main (straight-to-main per D-12)

## Context Restore

Approved, M1 DONE 2026-07-26: trackGain in schema (0-1.5 default 1, gain =
vel×trackGain, Acoustic .n() untouched), edit.ts cycleStep (off→0.7→1.0→0.25→off,
nearest-of-three-tiers snap for odd vels) + setTrackGain, renderGrid appends
" [vol N%]" when trackGain≠1, page/grid.js countHeader(bars,resolution) (1 e & a /
1 & a / 1 & / dots at 24-32) + gridModel rows carry trackGain. 183 tests green.
NEXT: M2 — sidecar routes {type:"setTrackGain"} page message; tools.ts onEdit
swaps toggleStep→cycleStep + handles trackGain merges + teaching text (trackGain
doc, count vocabulary, D-38 preservation on voice replacement); page header row +
sliders + cycle clicks + CSS separators; e2e additions. Key files:
src/core/groove.ts (voice schema), src/core/compile.ts (gain emit),
src/core/edit.ts (click merge), src/core/grid.ts (renderGrid), page/grid.js
(gridModel — pure), page/main.js + index.html (DOM/CSS/WS),
src/server/sidecar.ts (page-message routing), src/server/tools.ts (teaching).

## Overview

Make the page a real instrument panel: a drummer's count header (Bar 1 · 1 e & a
2 e & a …) with strong beat/bar separation, a volume fader per track that lives
in the groove itself (`trackGain`, so the LLM sees the user's mix and it survives
reloads), and cell clicks that cycle off → normal → STRESS → ghost using the same
velocity tiers as v1.4's grid letters. All human edits keep flowing through the
server-owned merge (v1.2 architecture) so the LLM and the human stay on one shared
groove.

## Goals / Non-Goals

Goals:
- Count header + visual bar/beat segregation on the page grid.
- Per-voice `trackGain` (0–1.5, default 1) end-to-end: schema → compiler → page
  slider → WS → server merge → LLM visibility in renders/teaching.
- Click-cycle cell editing: off → x(0.7) → X(1.0) → g(0.25) → off.

Non-Goals:
- No mute/solo buttons (a slider at 0 is a mute; solo is a later idea).
- No drag-multiselect or velocity-drag editing; click-cycle only.
- No new grooves fields beyond trackGain; no page-local-only state.
- Machine-bank compiled output stays byte-identical when trackGain is absent.

## Functional Requirements

FR-1 (trackGain schema): `voices[i].trackGain` — number 0–1.5, default 1 —
accepted everywhere a voice is (play_groove voices, update_groove voices).
Compiled gain per hit = vel × trackGain (formatted like today's gains). The
Acoustic `.n()` slot mapping stays a function of vel ONLY — a turned-down snare
still triggers hard-hit recordings played quietly, not ghost samples (D-35).

FR-2 (trackGain persistence): update_groove voice replacement and grid-row
replacement PRESERVE the existing voice's trackGain unless the replacement
explicitly provides one. Page slider changes and LLM voice edits therefore
compose instead of silently resetting the mix (D-38).

FR-3 (volume sliders): each grid row has a fader (0–150%, default 100%). On
release the page sends `{type:"setTrackGain", drum, gain}`; the server merges via
pure core logic (like toggleStep), re-pushes the evaluate, and the change lands
at the next bar boundary. Slider position always reflects the authoritative
groove (broadcasts win over local drag state).

FR-4 (cell cycle editing): a cell click advances the hit through tiers:
off → x(0.7) → X(1.0) → g(0.25) → off. For hits the LLM wrote at in-between
velocities, the current tier is the nearest-letter snap (v1.4 midpoints), and the
click advances from there. Server-owned merge (replaces v1.2's on/off toggle;
overturns D-19's fixed 0.8 click velocity → D-36). Page shows the optimistic next
state instantly; the broadcast is authoritative. Cell shading already tracks vel.

FR-5 (count header): above the grid, a header shows bar labels and a drummer's
count per step — resolution 16: `1 e & a`, 8: `1 &`, 12: `1 & a` (triplet),
24/32: beat numbers with `·` between. Beat boundaries get a strong separator,
bar boundaries a stronger one, on header and cells alike. Header comes from pure
math in page/grid.js (testable), DOM/CSS in main.js/index.html (D-37).

FR-7 (grid zoom, added by Adrian 2026-07-26): a 70-220% zoom slider in the
transport bar scales the whole grid (cells, header, labels, faders) via a CSS
variable; page-local view preference persisted in localStorage, not groove
state.

FR-6 (LLM awareness): renderGrid appends ` [vol N%]` to any row whose trackGain
≠ 1, so mixes show up in play/update/now_playing responses. Teaching text: the
groove schema documents trackGain (mix, not dynamics); GROOVE_GUIDE teaches the
count vocabulary so "the & of 3 in bar 2" maps to a step for the model
(step = (bar−1)·resolution + (beat−1)·resolution/4 + offset, offset e/&/a =
1/2/3 sixteenths at resolution 16).

## Non-Functional Requirements

NFR-1: all merge logic pure in src/core (no I/O), errors LLM/user-actionable;
page never owns the groove.
NFR-2: byte-identical compiled output for grooves without trackGain — the v1.4
snapshot test and all machine-bank tests stay green untouched.
NFR-3: stdout sacred; no console.log in src/.
NFR-4: slider drags must not spam evaluates — send on release (change event),
not continuously.

## Assumptions & Resolved Decisions

D-35: sliders control a new per-voice `trackGain` groove field (not a
browser-local mixer, not velocity rewriting) — Adrian 2026-07-26. Keeps mix
separate from dynamics; on the Acoustic kit velocity keeps picking the recording.
D-36: cell clicks cycle off→x→X→g→off — Adrian 2026-07-26. Overturns v1.2 D-19
(fixed 0.8 click velocity): new hits now enter at x=0.7 and cycle from there.
D-37: count header in drummer syllables (1 e & a) + bar numbers + layered
separators — Adrian 2026-07-26 (over numeric bar.beat and separators-only).
D-38: trackGain survives voice replacement unless explicitly overridden —
exploration decision 2026-07-26 (otherwise every LLM voice edit would silently
reset the user's fader).
D-39: trackGain range 0–1.5 (0 = mute, >1 = boost headroom), slider UI 0–150%.

## Architecture & Dependency Chain

src/core/groove.ts (trackGain in voiceSchema)
  → src/core/compile.ts (gain = vel × trackGain)
  → src/core/edit.ts (cycleStep replaces toggleStep; setTrackGain — pure merges)
  → src/core/grid.ts (renderGrid [vol N%] annotation)
    → src/server/sidecar.ts (route setTrackGain page message; PageEdit union)
    → src/server/tools.ts (wire new merges into onEdit; teaching text FR-6)
      → page/grid.js (countHeader pure math; cycle-tier helper)
      → page/main.js + index.html (header row, sliders, cycle clicks, CSS)
        → README.md (page section update)

M1 = core links (all additive, nothing calls them yet). M2 = server + page +
teaching + e2e. M-final = staff review.

## Milestones

### M1: Core — trackGain, cycle merge, header math
- **Scope:** src/core/groove.ts, compile.ts, edit.ts, grid.ts; page/grid.js
  (pure parts); test/core/*, test/page/grid.test.ts
- **Tasks (TDD):** voiceSchema trackGain (0–1.5, default 1, actionable errors);
  compiler gain = vel×trackGain (Acoustic slots untouched by trackGain);
  edit.ts: cycleStep (nearest-tier + advance, off at end; voice dropped when
  last hit cycles off; same guards as toggleStep) and setTrackGain (clamp+
  validate, voice must exist); renderGrid ` [vol N%]` when ≠1; page/grid.js
  countHeader(bars, resolution) → per-step {label, beat, bar} + gridModel
  exposes trackGain per row.
- **Acceptance criteria:** FR-1, FR-2 (core half), FR-4 merge logic, FR-5 math,
  FR-6 render half; NFR-1, NFR-2.
- **Test plan (write first):** schema accepts/rejects trackGain bounds; compile
  vel×trackGain incl. formatNumber and byte-identical-without-trackGain
  (snapshot untouched); cycleStep from absent/0.7/1.0/0.25/0.85(snap)/0.3;
  cycle-off drops empty voice, refuses empty groove; setTrackGain bounds +
  unknown drum; renderGrid vol annotation on/off; countHeader for res
  8/12/16/24/32 × bars 1/2 (labels, beat/bar flags).
- **Verification:** `npm test`
- **Isolation note:** all additive — no caller passes trackGain yet, cycleStep
  not wired (toggleStep still in place for the server until M2), header math
  unused by DOM. Compiled output unchanged for every existing groove (NFR-2).
- **Status:** done (2026-07-26)

### M2: Wire + page — sliders, cycle clicks, count header, teaching
- **Scope:** src/server/sidecar.ts, tools.ts; page/main.js, index.html;
  test/server/*; scripts/e2e.ts; README.md, CLAUDE.md
- **Tasks:** sidecar routes `setTrackGain` (validated shape → onEdit union);
  tools.ts onEdit handles cycle + trackGain merges (cycleStep replaces
  toggleStep), teaching text (trackGain doc, count vocabulary, [vol] meaning);
  page: header row + layered beat/bar separators (CSS), slider per row
  (change-event send, broadcast-driven position), click → optimistic next tier;
  e2e: header present with correct count labels, slider drag → state.code gain
  change, cell cycle click → class/alpha progression (+ existing 29 checks
  green).
- **Acceptance criteria:** FR-2 (tools half), FR-3, FR-4 UI, FR-5 DOM, FR-6
  teaching; NFR-3, NFR-4.
- **Test plan (write first):** tools tests — slider edit lands in groove +
  next render shows [vol]; voice replacement preserves trackGain (FR-2/D-38);
  explicit trackGain in replacement wins; cycle edit from LLM-written 0.9 hit
  snaps+advances; sidecar test — setTrackGain message routing + malformed
  rejection.
- **Verification:** `npm test`; `npm run e2e`; live jam: Adrian drags a fader,
  cycles a cell to ghost, and confirms the LLM's next now_playing sees both.
- **Isolation note:** protocol addition is a new message type (old pages ignore
  nothing — they never send it); toggleStep→cycleStep swap is server-internal;
  responses only gain [vol] text.
- **Status:** done (2026-07-26; Adrian's live fader/cycle check pending, see log)

### M-final: Staff-level peer review
- **Scope:** full v1.5 diff + this SPEC.md
- **Tasks:** spec-reviewer as staff engineer: FR/NFR coverage implemented AND
  tested, D-35..D-39 followed, isolation held, undocumented deviations.
- **Acceptance criteria:** zero unaddressed confirmed findings; accepted ones
  recorded as D-*.
- **Verification:** full suite + e2e green; review summarized to Adrian.
- **Status:** pending

## Progress Log

- 2026-07-26: FR-7 added at Adrian's request, same day: grid zoom slider
  (70-220%) in the transport bar — pure view preference via the #grid --zoom
  CSS variable (everything grid-side is em-based so one variable scales cells,
  count header, labels, faders), persisted in localStorage, never touches the
  groove. Motivated by the count-header syllables being too small to read.

- 2026-07-26: M2 done — sidecar PageEdit is now a discriminated union
  (cycleStep/setTrackGain; legacy "toggleStep" frames get cycle semantics so
  stale tabs keep working), tools.ts routes both merges + D-38 preservation in
  update_groove (grid replacements always keep the fader; JSON replacements
  keep it unless trackGain explicit), teaching text (trackGain doc + count
  vocabulary with worked example), page header/bar rows + faders + cycle
  clicks + layered separators. 190 unit tests. e2e now 32 checks (v1.2 toggle
  checks replaced by v1.5 cycle checks, RELOCATED from phase C to D1 — four
  cycle round-trips no longer fit before the rateC DSP window; D1 is safe
  because D2 re-anchors its own measurement). Deviations: cycleNext page
  helper landed in M2 not M1 (trivial); v1.2 tools/e2e click tests updated to
  cycle expectations (intentional, D-36).

- 2026-07-26: M1 done — trackGain (schema/compile/renderGrid [vol N%]),
  cycleStep + setTrackGain pure merges, countHeader + gridModel.trackGain.
  183 unit tests green, build clean. Deviations: v1.4's exact-shape grid test
  updated to include trackGain: 1 (schema addition, intentional); cycle snap
  uses the three cycle tiers (0.25/0.7/1.0) so o-tier (0.5) hits snap to x
  before advancing — recorded here as the FR-4 interpretation.

- 2026-07-26: Spec drafted. D-35/36/37 decided by Adrian (AskUserQuestion, incl.
  clarification round on slider semantics); D-38/39 by exploration. v1.2's D-19
  (fixed 0.8 click velocity) will be overturned by D-36 at M2 wire-up.
