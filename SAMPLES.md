# Sample Sources & License Status

This project bundles **no audio**. All samples are streamed by the browser page at
runtime from Strudel's CDN and never enter this repo or any built artifact (SPEC
decision D-7, NFR-4). This file tracks where they come from and what is known about
their licensing — a prerequisite for any future offline/vendored mode.

## What the page loads at runtime

| Asset | URL | License | Status |
|-------|-----|---------|--------|
| Strudel engine | `https://unpkg.com/@strudel/web@1.3.0` | AGPL-3.0-or-later | Verified (all `@strudel/*` packages + superdough). Loaded unmodified by the browser; never bundled or redistributed here. |
| Sample map | `https://strudel.b-cdn.net/tidal-drum-machines.json` | — | Index only (bank_drum → sample URLs). The server also fetches this to report per-kit drum availability in `list_kits`. |
| Drum samples | `https://strudel.b-cdn.net/tidal-drum-machines/...` (WAVs) | **Unverified** | See below. |

## tidal-drum-machines: the unverified-WAV note

The drum hits are from [ritchse/tidal-drum-machines](https://github.com/ritchse/tidal-drum-machines) —
community captures of classic hardware (Roland TR-808/909/707/606, LinnDrum, LinnLM1,
Akai MPC60, Oberheim DMX, E-mu SP-12, Alesis HR-16, and many more), the same library
Strudel itself prebakes.

As of 2026-07-25 the upstream repo does **not** declare a per-WAV license. Context:

- Short sampled captures of famous hardware drum machines are widely redistributed and
  the library is already served publicly by Strudel's own CDN — but "widely done" is
  not a license.
- Until upstream licensing is clarified (or we re-record/replace with verifiably
  CC0/CC-BY captures), the WAVs stay out of this repo. Streaming from Strudel's CDN
  keeps redistribution on their side of the line and this repo pure MIT.

**Consequence:** internet is required at play time, and offline mode is blocked on this
verification (see SPEC Non-Goals).

## Curated banks exposed to the LLM

`src/core/kits.ts` exposes 10 banks from the library, chosen for recognizability and
described for kit selection (RolandTR808, RolandTR909, RolandTR707, RolandTR606,
LinnDrum, LinnLM1, AkaiMPC60, OberheimDMX, EmuSP12, AlesisHR16) with drum voices
bd, sd, hh, oh, rim, cp, lt, mt, ht, rd, cr where a bank provides them. `list_kits`
reports actual per-bank availability from the live sample map.

## Vetted alternatives for a future offline mode

From the research phase (RESEARCH.md §4), candidate sources with clearer licensing:

| Source | License | Notes |
|--------|---------|-------|
| [Hydrogen drum kits](https://hydrogen-music.org) | GPL/CC, varies per kit | Check per kit; some CC0/CC-BY |
| [Freesound](https://freesound.org) | filterable to CC0 | Per-sample checks required outside the CC0 filter |
| Salamander Drumkit | CC-BY | Multi-velocity acoustic kit |
| [99Sounds](https://99sounds.org) | free, per-pack terms | Check per pack |

Any sample that ever lands in this repo must have its source and license recorded here
first (see CLAUDE.md project rules).
