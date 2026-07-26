# Drummer v1.7 — Fills: Pre-Rendered Variations, Random Substitution — Spec

Status: done
Branch: main (straight-to-main per D-12)

## Context Restore

Spec drafted 2026-07-26 during the SRV Pride-and-Joy jam (v1.6 shipped same day;
its live check + M-final review still pending — fold in). Adrian's ask: the LLM
pre-renders ~6 fills; the framework substitutes one at the loop's end "every
once in a while"; a UI toggle turns fills on/off; substitution timing must be
unpredictable ("periodic = sounds fake"). Key design: randomness lives INSIDE
the compiled pattern via Strudel's `wrandcat` (weighted per-cycle choice,
cycle-seeded → non-periodic, no timers/WS churn — D-46; verified present in
our @strudel/web bundle). No milestone started. Key files: src/core/groove.ts
(fills/fillsEnabled/fillChance), compile.ts (variant compilation + wrandcat),
grid.ts (fill rendering), src/server/sidecar.ts (setFills msg), tools.ts
(teaching + merge), page/main.js + index.html (toggle), scripts/e2e.ts.

## Overview

A groove can now carry up to 6 pre-authored fills — short end-of-loop variations
written in the same grid notation. The compiler builds one complete pattern per
variant (base, and base-with-fill-i where the fill replaces the final window)
and emits a single Strudel `wrandcat` weighted so a fill plays on roughly
`fillChance` of cycles (default ~1 in 4). Strudel's randomness is seeded by
cycle number: which loop gets a fill and which fill it gets never falls into a
repeating period, satisfying the no-predictability requirement with zero
runtime machinery — no timers, no per-loop pushes, survives page reloads by
construction. A transport toggle (server-owned, undo-able, LLM-visible like
every page control) switches fills off for practice or focus.

## Goals / Non-Goals

Goals:
- `fills` (≤6) + `fillsEnabled` + `fillChance` on the groove, end-anchored,
  grid-notation-first, validated with actionable errors.
- Compile-time variant generation + weighted per-cycle random selection.
- Page toggle; fills state readable by the LLM (renderGrid/now_playing).
- Teaching: how to author fills that breathe (intensity range, setup into the
  downbeat, crash lands on the NEXT loop's 1).

Non-Goals:
- No mid-cycle switching (variants swap per whole cycle, like every evaluate).
- No per-fill probability weighting (all fills equally likely when one fires).
- No LLM-per-loop improvisation (that's the pre-render point).
- No UI fill editor (fills are LLM-authored; page editing stays base-groove).

## Functional Requirements

FR-1 (schema): `groove.fills` — array of 1..6 fills, each `{grid}` (or
`{voices}`) in the groove's notation covering the LAST K steps of the loop,
where K = fill row length (after separators) and must be a whole-beat multiple
(resolution/4) between one beat and one bar. All rows in one fill must agree on
K. `fillsEnabled` boolean default true. `fillChance` number 0.05–1 default
0.25. Errors name the offending fill index and the fix.

FR-2 (window ownership, D-47): on a fill cycle, ALL base voices' hits inside
the fill window are dropped; the fill's voices own the window completely (a
fill that wants the hat ticking through writes the hat into itself). Base hits
outside the window are untouched. Fill hits use the same velocity letters and
map to the same acoustic layers.

FR-3 (compilation, D-46): with fills present and enabled, the compiler emits
`wrandcat([[base, w], [variant1, 1], …])` over COMPLETE per-cycle patterns,
with base weight w chosen so P(any fill) = fillChance. Selection is Strudel
cycle-seeded — non-periodic by construction. With fills absent, disabled, or
`fillsEnabled: false`, output is byte-identical to today's (NFR-1).

FR-4 (UI toggle): a "fills" toggle in the transport sends
`{type: "setFills", enabled}` → server merge (`setFillsEnabled`, pure) →
recompile → push (origin "page", undo snapshot like every page edit). The
toggle reflects the authoritative groove; hidden/disabled when the groove has
no fills.

FR-5 (LLM visibility): playingSummary mentions fills ("…, 6 fills ~25%" or
"fills off"); now_playing's grid section renders each fill's rows under a
`fill N (last K steps):` header so the model can read its own fills back and
iterate ("make fill 2 busier").

FR-6 (teaching): play_groove/update_groove teach fill authoring: up to 6, end-
anchored whole-beat windows, vary the intensity (a couple subtle — ghost runs,
hat opens; a couple big — tom rounds, flams), lead INTO the next downbeat (the
crash on the 1 belongs to the base groove's step 0, not the fill), fills own
their window, fillChance semantics, and that the user has a page toggle.

## Non-Functional Requirements

NFR-1: grooves without fills compile byte-identically (v1.4 snapshot + all
machine-bank tests untouched).
NFR-2: all new logic pure in src/core; stdout sacred; page never owns state.
NFR-3: the 7 variants' compiled code stays well under evaluate-push sizes that
the page already handles (it's text; no audio prerendering — "pre-render" means
pre-AUTHORED patterns, samples stream as usual; the bank warm covers fills'
drums since warming is bank-wide on Acoustic).
NFR-4: fill validation failures never leave a partially-applied groove.

## Assumptions & Resolved Decisions

D-46: substitution randomness lives in-pattern via Strudel `wrandcat`
(cycle-seeded, non-periodic) — exploration 2026-07-26. Chosen over server
timers (racy, needs phase tracking) and page-side swapping (fights the
bar-quantized evaluate model). Verified in the @strudel/web bundle.
D-47: a fill owns its whole window for all voices — exploration 2026-07-26.
One mental model; the LLM copies the timekeeper in if it wants it.
D-48: fills anchor at the loop END with whole-beat lengths (1 beat..1 bar) —
from Adrian's "end of bar 2", generalized to any bars/resolution.
D-49: `fillsEnabled` is groove state, toggled from the page, server-owned,
undo-able, default true — Adrian asked for the UI toggle 2026-07-26.
D-50: `fillChance` default 0.25, range 0.05–1 — "every once in a while" ≈
every ~4th loop-end, jittered by the cycle-seeded rand; 1.0 exists mainly so
e2e can force a fill every cycle deterministically.
D-53: channel mute applies inside fills for that drum; fill-only drums bypass
other channels' mutes; the fills toggle is the kill switch — M-final finding
MINOR-3 accepted as designed behavior 2026-07-26, now taught and tested.
D-52: master volume is server session state applied via .postgain, excluded
from undo — 2026-07-26 (monitoring level, not musical content; survives new
grooves from the LLM by design).
D-51: fills are authored in grid notation only — one authoring path (M1
finding, 2026-07-26); the parsed {steps, voices} form is accepted purely for
parseGroove idempotency across edit merges.

## Architecture & Dependency Chain

src/core/groove.ts (fills/fillsEnabled/fillChance schema + window validation)
  → src/core/compile.ts (variant builder + wrandcat emission)
  → src/core/edit.ts (setFillsEnabled pure merge)
  → src/core/grid.ts (renderGrid fill sections)
    → src/server/sidecar.ts (setFills page message)
    → src/server/tools.ts (merge routing + undo + teaching + summary)
      → page/main.js + index.html (fills toggle)
        → scripts/e2e.ts, README.md, CLAUDE.md

M1 = core. M2 = server + page + teaching + e2e. M-final = staff review.

## Milestones

### M1: Core — fill schema, variant compiler, render
- **Scope:** src/core/groove.ts, compile.ts, edit.ts, grid.ts; test/core/*
- **Tasks (TDD):** schema + window validation (K whole-beat, 1 beat..1 bar,
  rows agree, ≤6 fills, fill grid/voices reuse gridToVoices with fill-local
  step space); compile: buildVariant(base, fill) drops base hits in-window and
  overlays fill (steps offset to window start), wrandcat emission with weight
  math for fillChance, plain output when disabled/absent; setFillsEnabled
  merge; renderGrid fill sections.
- **Acceptance criteria:** FR-1, FR-2, FR-3, FR-5 (render half); NFR-1, NFR-4.
- **Test plan (write first):** schema: 6 fills ok/7 rejected, bad K (not
  whole-beat / > bar / rows disagree) errors name fill index, fillChance
  bounds/default; compile: variant drops all base hits in window (multi-voice),
  keeps hits outside, fill maps velocities/slots correctly at window offset,
  wrandcat weight math (fillChance 0.25 & 6 fills → base weight 18), disabled
  → byte-identical, no fills → snapshot untouched; edit: setFillsEnabled
  toggles + revalidates; render: "fill N (last K steps):" sections.
- **Verification:** `npm test`
- **Isolation note:** all additive; nothing sends setFills yet; no-fill
  grooves byte-identical.
- **Status:** done (2026-07-26)

### M2: Wire + page — toggle, teaching, e2e
- **Scope:** src/server/sidecar.ts, tools.ts; page/main.js, index.html;
  test/server/*; scripts/e2e.ts; README.md, CLAUDE.md
- **Tasks:** sidecar setFills routing; tools onEdit setFillsEnabled (undo
  snapshot, origin page); playingSummary + teaching text (FR-5/FR-6);
  update_groove accepts fills/fillsEnabled/fillChance edits; page toggle
  (hidden without fills, tracks broadcasts); e2e: play with 1 loud tom fill at
  fillChance 1 → code contains wrandcat + fill pattern, audible tom onsets in
  a fill window; toggle off → code loses wrandcat; toggle undo-able.
- **Acceptance criteria:** FR-4, FR-5, FR-6 complete; NFR-2, NFR-3.
- **Verification:** `npm test`; `npm run e2e`; live jam: fills on the SRV
  shuffle — Adrian listens for natural, non-periodic fills and flips the
  toggle.
- **Isolation note:** setFills is a new opt-in message; grooves without fills
  unaffected end-to-end.
- **Status:** done (2026-07-26; live fills jam pending with Adrian)

### M-final: Staff-level peer review
- **Scope:** full v1.7 diff + this SPEC.md (+ v1.6 M-final findings if its
  review lands mid-flight)
- **Tasks:** spec-reviewer as staff engineer: FR/NFR coverage implemented AND
  tested, D-46..D-50 followed, isolation held, undocumented deviations.
- **Acceptance criteria:** zero unaddressed confirmed findings.
- **Verification:** full suite + e2e green; review summarized to Adrian.
- **Status:** done (2026-07-26 — PASS-WITH-FINDINGS, all fixed, see log)

## Progress Log

- 2026-07-26: Combined v1.6+v1.7 M-final review (post-public-release bar):
  PASS-WITH-FINDINGS — 0 blockers/majors, 5 MINOR, 7 NIT. Reviewer verified
  wrandcat weight-0 semantics against the shipped @strudel/web 1.3.0 bundle
  (0-weight base unselectable at fillChance 1) and confirmed licensing/README/
  no-secrets hygiene. Fixed same day: MINOR-1 setLastEvaluate now carries
  masterGain + origin (replayed slider/pause correctness, tested); MINOR-2
  undo cap-20 + D-42 clearing on play/set_kit/set_tempo + tempo-edit undo all
  tested; MINOR-3 mute×fills semantics recorded as D-53, taught, tested;
  MINOR-4 rebrand completed (page title/h1, MCP server name "drummy",
  package.json name/bin); MINOR-5 refused setTempo/setMasterGain now snap
  clients back (tested). NIT-1 sidecar tests wrapped in describe; NIT-2
  break-fill idea recorded in IDEAS.md; NIT-3 "(fills off)" summary tested.
  Accepted as-is: NIT-4 fill row-length error wording, NIT-5 parsed-form fill
  validation asymmetry (unreachable via authoring path), NIT-6 duplicated
  setcpm regex in the page's paused branch, NIT-7 page-setTempo merge inline
  in tools (matches the spec's architecture). 241 unit tests.

- 2026-07-26: FR-7 added at Adrian's request, same day: master volume slider
  (🔊, 0-150%) in the transport. SESSION state on the server (not groove state
  — the LLM playing a new song keeps the user's level), compiled as
  .postgain() on the whole pattern (fills obey it too), page slider tracks
  evaluate broadcasts, deliberately NOT on the undo stack (monitoring, not
  music — D-52). 234 unit tests, e2e 44 checks.

- 2026-07-26: M2 done — setFills routing + setFillsEnabled in the edit switch
  (undo-able, origin page), playingSummary fills note, FILL_GUIDE teaching,
  update_groove accepts fills/fillsEnabled/fillChance ([] removes), page
  toggle (hidden without fills, tracks broadcasts). 228 unit tests; e2e 43
  checks. Deviation: the e2e audio-proof is CPS-based, not onset-based — the
  fills update also changes tempo, and the page's cps landing at the new
  value proves the wrandcat code evaluated (an evaluate error would keep the
  old cps); fill audibility itself is Adrian's live-jam check. wrandcat call
  signature ([pattern, weight] pairs, = wchooseCycles) verified against the
  strudel-web bundle source before compiling to it.

- 2026-07-26: M1 done — fills schema (grid input + idempotent parsed form,
  window validation naming the fill), compile refactored to compileStack +
  applyFill with wrandcat emission (base weight n(1-c)/c; slow(bars) wraps the
  wrandcat so the choice is per LOOP — key correctness point), setFillsEnabled
  merge, renderGrid fill sections via shared rowText helper. 222 unit tests.
  Deviations: fills accept grid notation as the only AUTHORING form (the
  {steps, voices} parsed form exists solely for idempotent re-parsing) —
  D-51 recorded; all-rest fill grids still rejected ("no hits") — a silence/
  break fill is a possible future nicety, noted in IDEAS.md territory.

- 2026-07-26: Spec drafted mid-jam. Requirement verbatim: fills "every once in
  a while at the end of bar 2", UI toggle, ~6 pre-rendered variants, "avoid
  predictability in when it gets substituted because then it will sound fake".
  D-46 wrandcat verified in the strudel-web bundle before design.
