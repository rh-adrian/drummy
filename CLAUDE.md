# AI Drummer — Agent Instructions

Open-source conversational AI drummer: a drummer-vocabulary MCP server (TypeScript,
stdio) that compiles structured grooves to Strudel code and pushes them over websocket
to a local browser page for playback through classic drum-machine samples.

Orient before changing anything:

- `specs/drummer-v1/SPEC.md` — **source of truth**: requirements (FR/NFR), every
  resolved decision (D-*), milestone status, progress log. Development is spec-driven;
  read its Context Restore section first.
- `README.md` — user-facing: quickstart, tool reference, troubleshooting, licensing.
- `RESEARCH.md` — landscape analysis and why the architecture is what it is.
- `SAMPLES.md` — sample sources and license status.

## Layout

```
src/core/       groove schema (zod) + groove→Strudel compiler + kit list  (pure, no I/O)
src/server/     sidecar.ts (HTTP static + WS push)  tools.ts (the 7 MCP tools)
src/index.ts    stdio entry: McpServer + sidecar lifecycle
page/           browser client: @strudel/web via CDN, bar-quantized swaps, heartbeat
scripts/        dev-jam.ts (no-MCP dev loop)  capture.ts + e2e.ts (audio verification)
test/           vitest (schema, compiler, sidecar, tools via in-memory transport)
```

## Commands

`npm test` · `npm run build` · `npm run dev:jam` · `npm run e2e` · `npm run capture`
(the last two need `npx playwright install chromium` once). Never start long-running
dev processes without cleaning them up; kill anything holding port 4747.

## Project rules

- **Living documents:** update README.md (and SAMPLES.md / RESEARCH.md where relevant)
  alongside any code or design change. Overturned decisions get recorded in the SPEC as
  a new D-* entry, not silently.
- **stdout is sacred** (NFR-2): it carries JSON-RPC. No `console.log` anywhere in
  `src/` — log to stderr. A test enforces this; don't weaken it.
- **Licensing boundary** (D-7, NFR-4): repo is pure MIT. Strudel (AGPL) and the samples
  are CDN-loaded by the browser at runtime — never bundle, vendor, import, or
  redistribute them. Any sample that ever lands in-repo must be recorded in SAMPLES.md
  with source + license *first*.
- **The groove schema always carries per-hit velocity and micro-timing** plus global
  swing. Any change that drops them is a regression (FR-7).
- **Real-time is a non-goal.** Bar-boundary hot-swap is the design; don't "optimize"
  swaps to apply mid-bar.
- **Tool errors are isError results with LLM-actionable text** (FR-9) — keep protocol
  input schemas permissive so `parseGroove` owns validation and its curated messages
  survive. Tool descriptions are the LLM's drummer manual (FR-10); keep them teaching
  vocabulary, not just types.
- **Audio verification is automated** (D-13): capture harness + DSP assertions
  (+ Gemini listen for feel). Don't replace it with "sounds fine to me".
- Symbolic patterns + real samples is settled (vs. neural audio) — RESEARCH.md §2.
  Don't re-litigate without new evidence.
