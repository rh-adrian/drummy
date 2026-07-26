# Page Step-Sequencer Grid (+ Safari audio fix) — Spec

Status: approved
Branch: main (D-12 carried over from drummer-v1: straight to main, no PRs)

## Context Restore

M1 (commit 82b44a6) + M2 (commit bc1df02) done 2026-07-25, pushed to main. New:
`page/grid.js` (pure gridModel/playheadStep, vitest-covered), grid+playhead+play/pause
UI in `page/main.js`/`index.html`, groove field on evaluate push/replay
(`setLastEvaluate(code, groove)`), e2e extended to 18 checks (grid renders, playhead
advances, local play/pause, un-pause on push). 98 unit tests green. **Next: M-final**
staff review of the v1.1 diff (82b44a6..bc1df02 + spec). Still pending after review:
Adrian's manual eye/ear check in Chrome AND Safari (the Safari resume fix has no
automated gate). Builds on drummer-v1 (Status: done, see
`specs/drummer-v1/SPEC.md` — its D-1..D-14 all still bind). Feature: replace the raw
Strudel code display on the page with a drum-machine-style step grid (rows = voices,
columns = steps, cell brightness = velocity) with a live playhead; code moves into a
collapsed details section; bundle the Safari silent-audio fix (AudioContext must be
resumed synchronously in the Start click handler). Nothing implemented yet.

## Overview

The page currently displays the compiled Strudel code — meaningless to most humans.
Replace it as the primary display with a step-sequencer grid like real drum-machine
UIs, driven by the *structured groove JSON* (which the server already holds after
`parseGroove`) rather than by parsing code. The sidecar's evaluate payload/replay gains
an optional `groove` field; the page renders the grid from it, swapping the visual at
the same bar boundary as the audio. A requestAnimationFrame playhead sweeps the steps
using the same scheduler introspection that powers quantize. Separately (user report,
2026-07-25 test drive): Safari plays silence because the Start click never resumes the
AudioContext synchronously — fix in the same page-touching change.

## Goals / Non-Goals

**Goals**
- A human watching the page sees *the beat* — which drums hit on which steps, ghost
  notes visibly quieter, a playhead running in time.
- Audio and visuals stay in lockstep: the grid swaps when the audio swaps (bar
  boundary), not when the message arrives.
- Safari actually makes sound.

**Non-Goals**
- Editing the groove from the page (display only; the LLM is the interface).
- Micro-timing / swing visualization (cells sit on the nominal grid).
- Mobile layout, theming, per-cell animations beyond the playhead.

## Functional Requirements

- FR-1: WS `evaluate` messages and the sidecar replay carry the parsed groove JSON
  (post-defaults) alongside the compiled code. `set_tempo` keeps the replayed groove's
  `tempoBpm` coherent (it already recompiles — the groove it holds is the source).
- FR-2: The page renders a step grid from the groove: one row per voice (labeled with
  the drum abbreviation, kick on the bottom row like hardware), `bars × resolution`
  columns with visual separators at bar (and beat) boundaries, a cell lit where a hit
  exists with brightness proportional to velocity (a 0.25 ghost is clearly dimmer than
  a 1.0 accent). Grid updates at the bar-boundary swap moment, in the same code path
  that calls `repl.evaluate`. Works for resolutions 8–32 and 1–4 bars without breaking
  layout (horizontal scroll acceptable at 32×4).
- FR-3: A live playhead highlights the current step while playing, advancing in time
  with the audio (derived from `scheduler.now() mod bars`, the same introspection
  quantize uses; pattern position is deterministic in Strudel's global cycle count, so
  no extra sync is needed). Hidden/stopped on stop and when introspection fails.
- FR-4: The Strudel code moves into a collapsed `<details>` ("show code") below the
  grid. If an evaluate arrives without a `groove` field (stale/foreign server), the
  page falls back to showing the code open, as today — no blank page.
- FR-5: Clicking ▶ Start resumes the Web Audio context **synchronously inside the
  click handler** (guarded — `getAudioContext` global from @strudel/web if present),
  fixing silent playback in Safari. Chrome behavior unchanged.
- FR-6: A play/pause button on the page — **local transport**: pause stops the page's
  audio (`repl.stop()`); play restarts the current groove from the top of the bar. An
  incoming evaluate while paused applies and plays (a fresh LLM push implies intent to
  hear it); a server hush clears the paused state. The page's paused state reaches the
  LLM through the existing status heartbeat (`now_playing` page status). Disabled until
  armed and a groove exists.

## Non-Functional Requirements

- NFR-1: No new dependencies, no build step for the page (stays plain ES modules);
  licensing boundary (v1 D-7/NFR-4) untouched.
- NFR-2: All v1 NFRs still hold — notably stdout hygiene and the existing test suite
  stays green; old pages (without the new field) don't break against the new server
  and vice versa (field is additive/optional).
- NFR-3: Grid/playhead logic that can be pure (groove → grid model; scheduler time →
  step index) lives in a page module unit-tested in vitest, like `quantize.js`.

## Assumptions & Resolved Decisions

- D-15: Grid primary + collapsible code; live playhead; Safari fix bundled — user,
  2026-07-25 (AskUserQuestion).
- D-16: Grid is driven by groove JSON over WS, never by parsing Strudel code —
  design, 2026-07-25.
- D-18: Play/pause is page-local transport (no new page→server control messages;
  server session state untouched; heartbeat already reports page playing state) —
  user requested the button 2026-07-25; semantics chosen at implementation.
- D-17: Codebase exploration phase skipped: every affected file was authored and
  staff-reviewed under drummer-v1 the same day; the dependency chain below is known
  first-hand — 2026-07-25.

## Architecture & Dependency Chain

```
src/server/tools.ts      — pass groove object into sidecar push/setLastEvaluate   [M1]
src/server/sidecar.ts    — evaluate payload/replay gains optional groove field    [M1]
page/grid.js (new)       — pure: groove → grid model; (time,cps,bars) → step idx  [M2]
page/main.js, index.html — render grid + playhead, <details> code, Safari resume  [M2]
scripts/e2e.ts           — assert grid state present + playhead advances          [M2]
```

Additive order: M1 ships a server that sends an extra field old pages ignore; M2 ships
the page that consumes it. Each is safe to stop at.

## Milestones

### M1: Groove over the wire
- **Scope:** `src/server/sidecar.ts`, `src/server/tools.ts`, `test/server/*`.
- **Tasks:** evaluate broadcast + `lastEvaluate` replay become `{type:"evaluate",
  code, groove?}`; `setLastEvaluate(code, groove)`; tools pass the parsed groove at
  every push site (play_groove, update_groove, set_kit, set_tempo's replay sync).
- **Acceptance criteria:** FR-1; NFR-2 (additive field, suite green).
- **Test plan (write first):** sidecar test — evaluate payload delivers `groove` to a
  mock WS client and replays it (incl. after `setLastEvaluate`); tools tests — each
  mutating tool's pushed payload carries the current groove JSON; set_tempo updates
  replayed groove.tempoBpm without broadcasting an evaluate.
- **Verification:** `npm test`, `npm run build`.
- **Isolation note:** page ignores the unknown field until M2; protocol otherwise
  unchanged.
- **Status:** done (2026-07-25, commit 82b44a6)

### M2: Grid, playhead, play/pause, collapsible code, Safari resume
- **Scope:** `page/grid.js` (new), `page/main.js`, `page/index.html` (+styles),
  `test/page/grid.test.ts`, `scripts/e2e.ts`.
- **Tasks:** pure grid-model + playhead-step helpers; render grid at swap time (same
  timeout as `repl.evaluate`); rAF playhead loop gated on playing+introspection;
  `<details>` code fallback per FR-4; synchronous `getAudioContext().resume()` in the
  arm handler (guarded); play/pause button per FR-6/D-18.
- **Acceptance criteria:** FR-2..FR-6; NFR-1, NFR-3.
- **Test plan (write first):** grid.test.ts — groove→model (row order kick-bottom,
  cell velocities, bar/beat boundaries, 8/16/32 res × 1–4 bars); step-index math at
  several scheduler times/tempos incl. multi-bar wraparound; main.js fallback path
  (no groove → code shown) covered via e2e page-state assertion.
- **Verification:** `npm test`; `npm run e2e` extended with: `window.__ai.state.groove`
  populated after play, playhead step advances over ~1s, code `<details>` present.
  Manual: Adrian ear+eye check in Chrome AND Safari (the Safari fix has no automated
  harness — headless runs don't gate on user gestures; record result in the log).
- **Isolation note:** consumes M1's field; server untouched.
- **Status:** done (2026-07-25, commit bc1df02; Adrian's Chrome+Safari manual check
  tracked in M-final)

### M-final: Staff-level peer review
- **Scope:** the full v1.1 diff (M1+M2 commits) + this SPEC.md, with drummer-v1's
  invariants in scope (licensing boundary, stdout hygiene, FR-7 velocity fidelity).
- **Tasks:** staff-level reviewer over the diff: FR/NFR coverage implemented AND
  tested, D-15..D-17 followed, v1 regressions checked, undocumented deviations flagged.
- **Acceptance criteria:** zero unaddressed confirmed findings.
- **Verification:** full suite + e2e green; report summarized to the user.
- **Status:** pending

## Progress Log

- 2026-07-25 — Spec drafted after the first real jam session (user request: "grid
  pattern showing which channels are hitting, like a real drum sequencer"; Safari
  silence reported during the same session). Awaiting sign-off.
- 2026-07-25 — Approved with one addition from the user: a play/pause button (FR-6,
  D-18 local-transport semantics).
- 2026-07-25 — **M1 done** (82b44a6). TDD red→green (5 new failing assertions → 89
  tests). Discovery: the sidecar's broadcast and `lastEvaluate` replay already carry
  arbitrary fields on the push object, so only `setLastEvaluate` (now
  `(code, groove?)`) and the four tool push sites needed real changes.
- 2026-07-25 — **M2 done** (bc1df02). `page/grid.js` pure module (row order
  cymbals→kick-bottom, cells = velocity|null, beatLen = resolution/4 for separators;
  playheadStep = floor((cyclePos mod bars) × resolution), clamped, null on bad input)
  with 9 vitest cases; grid rebuilt only when the groove object changes, playhead
  toggles a class on the current column (rAF loop, hidden when stopped/paused/
  introspection-failed); play/pause per D-18 (pause deliberately does NOT cancel a
  pending bar-boundary swap — an incoming evaluate wins and un-pauses); queued
  evaluates now carry `{code, groove}`; `resumeAudioSync()` (guarded global
  `getAudioContext().resume()`) runs synchronously in BOTH the arm and play/pause
  click handlers (FR-5). e2e grew 10→14 page checks → 18 total: grid rows/hits/
  collapsed-code, playhead advance (caught the bar wrap 15→3), local pause/restart,
  un-pause on fresh push. 98 unit tests + e2e 18/18 green. Deviations: none.
