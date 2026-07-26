# Grid Step Editing (click-to-toggle) — Spec

Status: approved
Branch: main (D-12 carried over: straight to main, no PRs)

## Context Restore

Approved 2026-07-25 (user request mid-jam: "turn on/off specific steps by clicking on
the UI… update the JSON so the next time the LLM changes something it sees the
update"; click model = simple toggle per AskUserQuestion). Builds on drummer-v1
(done) and drummer-v1.1-page-grid (code complete). Nothing implemented yet. Next: M1.

## Overview

Make the v1.1 step grid a two-way instrument: clicking a cell toggles that drum's hit
at that step. The page sends a `toggleStep` request over the existing WS; the server —
which owns the session groove — applies the edit, so `now_playing` and `update_groove`
see the human's changes exactly like the LLM's own. While playing, the server pushes
the recompiled evaluate back out, so audio changes at the next bar boundary and every
connected page converges; the clicked page updates its cell optimistically for instant
feedback.

## Goals / Non-Goals

**Goals**: toggle existing rows' steps from the grid; human edits and LLM edits share
one source of truth (the server session groove); no audible glitches (same
bar-boundary swap path as every other change).

**Non-Goals**: adding new drum rows from the UI (the LLM adds voices); velocity/micro
editing from the UI (toggle only, per D-19); multi-user conflict resolution beyond
last-writer-wins; persisting grooves.

## Functional Requirements

- FR-1: Page → server WS message `{type: "toggleStep", drum, step}`. The sidecar
  routes it to a handler registered via `onEdit(handler)`; tools.ts registers the
  handler and owns the merge.
- FR-2: Toggle semantics — hit present at (drum, step) → remove it; removing a
  voice's last hit removes the voice; hit absent → add `{step, vel: 0.8}` (D-19).
  Result re-validated via `parseGroove`; on success it becomes the session groove.
- FR-3: While playing, a successful edit pushes a fresh evaluate (code + groove):
  audio applies at the next bar boundary, replay state stays coherent, all pages
  re-render. While stopped/paused-server-side, the edit mutates state only — it must
  NEVER start playback (same principle as stop's replay-clearing).
- FR-4: Invalid requests (unknown drum, no voice row for it, step out of range, no
  groove loaded, or an edit that would leave the groove invalid — e.g. removing the
  last remaining hit of the only voice) are refused: state unchanged, stderr log. If
  refused while playing, the server re-pushes the current evaluate so the optimistic
  page snaps back.
- FR-5: Page: clicking any cell in an existing row sends `toggleStep` and toggles the
  cell optimistically (instant visual); the next broadcast re-render is
  authoritative. Clicks are accepted whenever a groove with that row is on the grid,
  armed or not, playing or not.
- FR-6: LLM visibility: `now_playing` returns the edited groove; `update_groove`
  merges on top of it. (Automatic via shared state — but explicitly tested.)

## Non-Functional Requirements

- NFR-1: All v1/v1.1 invariants hold (stdout hygiene, licensing boundary, no new
  deps, bar-boundary-only audible changes). Old pages against the new server: they
  never send `toggleStep`, nothing changes for them.
- NFR-2: The toggle merge is a pure function in `src/core/` (like the compiler),
  fully unit-tested; sidecar routing and tools wiring covered by integration tests;
  the click path by e2e (real click in headless Chrome → `now_playing` reflects it).

## Assumptions & Resolved Decisions

- D-19: Click = simple on/off toggle; new hits at vel 0.8 — user, 2026-07-25
  (AskUserQuestion; velocity nuance stays the LLM's job).
- D-20: Server owns the merge; a page edit is a *request*; optimistic UI is corrected
  by the next broadcast (or the FR-4 revert push). Accepted edge: a refused edit
  while *stopped* leaves the optimistic cell wrong until the next push (rare — only
  the last-hit-of-last-voice case).
- D-21: Edits never resurrect playback when stopped (FR-3), mirroring v1's stop
  semantics.

## Architecture & Dependency Chain

```
src/core/edit.ts (new)   — pure toggleStep(groove, drum, step) → result   [M1]
src/server/sidecar.ts    — parse toggleStep frames, onEdit(handler)       [M1]
src/server/tools.ts      — register handler: merge, state, push/revert    [M1]
page/main.js, grid.js    — cell click → WS send + optimistic toggle       [M2]
scripts/e2e.ts           — real-click checks                              [M2]
```

## Milestones

### M1: Server side — pure toggle + WS routing + session wiring
- **Scope:** `src/core/edit.ts` (new), `src/server/sidecar.ts`, `src/server/tools.ts`,
  `test/core/edit.test.ts`, `test/server/sidecar.test.ts`, `test/server/tools.test.ts`.
- **Tasks:** pure `toggleStep`; sidecar: parse `toggleStep` page frames → registered
  `onEdit` handler; tools: handler mutating session groove per FR-2/3/4.
- **Test plan (write first):** edit.test.ts — add to existing voice; remove existing
  hit; removing last hit drops the voice; unknown drum / missing row / out-of-range
  step / removing the only voice's only hit → refused; added hit vel 0.8; groove
  untouched (no mutation of input). sidecar.test.ts — client-sent toggleStep reaches
  the handler; malformed frames don't. tools.test.ts — edit while playing updates
  now_playing AND pushes evaluate with new code+groove; edit while stopped updates
  state, NO push; refused edit while playing re-pushes current evaluate; update_groove
  after an edit merges on the edited groove (FR-6).
- **Acceptance criteria:** FR-1..FR-4, FR-6; NFR-2.
- **Verification:** `npm test`, `npm run build`.
- **Isolation note:** no page sends toggleStep yet; protocol addition is inert.
- **Status:** pending

### M2: Page — click to toggle, optimistic UI
- **Scope:** `page/main.js` (+ `page/grid.js` if helpers needed), `page/index.html`
  (cursor/hover affordance), `scripts/e2e.ts`.
- **Tasks:** cells carry (drum, step) data attributes; click → WS `toggleStep` +
  optimistic cell class/vel flip; hover styling so cells read as clickable.
- **Test plan:** e2e — click an empty hat cell → now_playing shows the added hit
  (vel 0.8) and the cell lights; click it again → hit gone; audible path already
  covered by existing DSP checks (the push reuses the standard evaluate path).
- **Acceptance criteria:** FR-5; NFR-1.
- **Verification:** `npm test`; `npm run e2e`; live jam sanity check by Adrian.
- **Isolation note:** consumes M1's protocol; old server + new page = clicks are
  sent and ignored (no handler), UI corrected on next broadcast — degraded, not broken.
- **Status:** pending

### M-final: Staff-level peer review
- **Scope:** the full v1.2 diff + this SPEC.md; v1/v1.1 invariants in scope.
- **Tasks:** staff-level reviewer: FR/NFR coverage, D-19..D-21 adherence, regression
  check (especially the sidecar message path and tools state machine), undocumented
  deviations.
- **Acceptance criteria:** zero unaddressed confirmed findings.
- **Verification:** full suite + e2e green; report summarized to the user.
- **Status:** pending

## Progress Log

- 2026-07-25 — Spec drafted and approved (user request + click-model question).
