# Research: AI Drummers & the Landscape (July 2026)

Research conducted 2026-07-25 into existing generative-AI drummer tools, prior art in
music MCP servers, and free drum sample sources — to scope an open-source
"AI drummer you can talk to and jam with."

## 1. Existing gen-AI drum tools

### Conversational / text-to-beat (turn-based)

- **[DrumBot AI](https://musictech.com/news/gear/drumbot-ai/)** — closest existing thing to
  "an AI drummer you talk with." Browser-based. Plain-English prompts
  ("a heavy half-time groove with ghost notes on the snare") refined via chat-style
  back-and-forth. Can analyze uploaded audio and generate a complementary drum part.
  Eight genre models. Free tier (75 credits/mo), paid $14.99 / $29.99. Exports MIDI/WAV.
  **Limitation:** turn-based loop generation, no live jamming, no named-song references.

- **[Drumloop AI](https://www.drumloopai.com/)** — simple text-to-drum-loop generator
  pitched as a jam-session co-pilot. WAV/MP3/MIDI export.

- **[Fadr DrumGPT](https://www.audiocipher.com/post/fadr-drumgpt-ai-drum-generator)** —
  text prompts → 16-note drum kits/patterns. Free.

- **[MIDI Agent](https://www.midiagent.com/ai-drum-pattern-generator)** — natural-language
  drum pattern generation as a VST inside the DAW.

- **[aidrums.com](https://aidrums.com/)** — directory of the whole 2026 AI-drum landscape.

### Real-time / live jamming (neural audio)

- **[Magenta RealTime 2](https://magenta.withgoogle.com/magenta-realtime)** (Google, June 2026) —
  free, open-weights, runs locally on Apple Silicon (230M-param small model from M1 up;
  2.4B base model also local). ~200 ms end-to-end latency. Ships with a **"Jam" app**
  (type a genre/style description, it plays live and follows your audio/MIDI input) and an
  **MRT2 DAW plugin**. Weights: Hugging Face `google/magenta-realtime-2`;
  code: GitHub `magenta/magenta-realtime`.
  ([Gigazine coverage](https://gigazine.net/gsc_news/en/20260605-magenta-realtime-2-live-music-ai/))
  - **Verdict for this project:** wrong abstraction. It's a *continuous audio* generator —
    a texture machine steered by embeddings. No discrete hits, no MIDI out, no
    "move the snare to the 3." Full-ensemble rather than drums-only.

- **[Magenta DrumBot](https://magenta.withgoogle.com/drumbot)** (older Google web toy,
  distinct from DrumBot AI) — drums along in real time with a melody you play, via the
  Drumify model. Dated proof of concept.

### The "like Brick House" caveat (applies to ALL of the above)

No existing tool reliably takes a **song title** as a style reference — partly copyright,
partly training. The working pattern everywhere: describe the groove instead
("funky mid-'70s groove ~100 BPM, tight syncopated 16th hats, kick locked to the bassline,
dry fat snare on 2 and 4, ghost notes"). **This translation step is exactly what an LLM
agent is good at** — which is the core insight behind this project.

## 2. Why symbolic beats neural audio for this project

- LLMs are strong at writing **symbolic patterns** (step grids / MIDI), weak at nothing
  relevant here. Frontier models lack note-perfect transcription recall but reliably know
  groove-level facts (tempo, feel, hat pattern, kick/bass relationship) for nearly any
  well-known song — the same info a session drummer uses.
- Symbolic + real samples = precise control ("move that kick", "less swing"),
  tiny latency, deterministic playback, trivially open source.
- Latency: a change is just regenerating a small pattern JSON and hot-swapping at the
  next bar boundary → **~2–4 s perceived**, applied "at the top of the loop," which is
  musically natural. (Original tolerance was 15 s; we'll beat it comfortably.)

## 3. Prior art: music MCP servers

- **[Strudel MCP Server](https://skywork.ai/skypage/en/ai-engineer-guide-strudel-live-coding/1981613226920611840)** —
  uncomfortably close to this idea already. Strudel (browser port of TidalCycles) is free,
  open source, and **bundles the open-licensed tidal-drum-machines sample library**
  (real captures of TR-808, TR-909, LinnDrum, and dozens more) triggerable from a terse
  pattern language LLMs write well. Existing MCP has play/analyze/save tools.
- **[sonic-pi-mcp](https://github.com/abhishekjairath/sonic-pi-mcp)** — LLM writes
  Sonic Pi code, sent over OSC. Free, open source; Sonic Pi ships with drum samples.
- **[Ableton Live MCPs](https://mcpmarket.com/server/ableton-live)** — 8+ implementations
  (incl. AbletonMCP, Ableton Copilot MCP), but Ableton is paid → not a fit for an
  open-source project.
- Ecosystem overview: [MCP + music/audio production guide](https://chatforest.com/guides/mcp-music-audio-production/).

**The gap / ownable niche:** nothing is packaged as *an AI drummer you talk to*. Existing
MCPs expose generic "run this code" surfaces. Differentiator = an opinionated agent + MCP
whose tools speak **drummer language** (`set_groove`, `add_fill`, `swing_amount`,
`halftime`, `set_kit`) over a pattern schema with **per-hit velocity + micro-timing**.

## 4. Free / open-licensed drum sample sources

| Source | License | Notes |
|--------|---------|-------|
| [tidal-drum-machines](https://github.com/ritchse/tidal-drum-machines) | open-licensed | Captures of TR-808/909, LinnDrum, dozens of classic machines; bundled with Strudel |
| [Hydrogen drum kits](https://hydrogen-music.org) | GPL/CC (varies per kit) | Acoustic + electronic kits for the Hydrogen drum machine |
| [Freesound](https://freesound.org) | CC0 filterable | Check license per sample; CC0 filter is safe |
| Salamander Drumkit | CC-BY | Multi-velocity acoustic kit captures (same author as Salamander Piano) |
| [99Sounds](https://99sounds.org) | free | Curated free packs; check per-pack terms |

Note: sampled captures of famous *hardware drum machines* are generally fine to
redistribute under their stated licenses; per-sample license checks matter on Freesound.

## 5. Proposed architecture

```
You (chat/voice)
   → LLM agent (song knowledge + music theory → groove description)
   → MCP server (drummer-vocabulary tools)
   → Sequencer engine (loops pattern JSON on a clock; bar-boundary hot-swap)
   → Sample library (open-licensed captures)
```

### Pattern schema requirements

- Steps per bar (16ths minimum; support 32nds/triplets)
- **Per-hit velocity** (ghost notes!)
- **Per-hit micro-timing offset** (push/drag, laid-back snare)
- Global swing amount
- Kit selection + per-voice sample mapping
- Fill slots (e.g., every 4th/8th bar variant)

### Candidate builds

1. **Thin path (prototype first):** agent + drummer-vocabulary MCP on top of Strudel
   (or its existing MCP) as engine. Samples + scheduling solved. Validate that
   LLM-written grooves *feel good* in an afternoon.
2. **Self-contained path:** small Node/Python looping sampler (Web Audio or
   `sounddevice`) playing pattern JSON on a clock with bar-boundary hot-swap + own kit
   folder. Zero dependencies; MCP schema fully ours.

Decision gate: prototype on (1); go to (2) only if owning the engine proves worth it.

## 6. Exploration addendum (2026-07-25, spec phase)

Three-agent deep dive before writing `specs/drummer-v1/SPEC.md`. Full details there; headlines:

- **Niche confirmed open** — no "drummer-vocabulary MCP" exists anywhere. ~25 Strudel MCP
  projects surveyed; all substantial ones (live-coding-music-mcp 225★, dj-claude,
  strudel-ai-dj) are AGPL-3.0 and architecturally different (Playwright over strudel.cc,
  or ext-apps UI). **Decision: build fresh, borrow ideas** (named-slot stacks,
  cycle-boundary swaps, stateful jam tools).
- **Strudel is AGPL-3.0-or-later** (all `@strudel/*` npm packages + superdough).
  tidal-drum-machines WAV licenses unverified. **Decision: runtime CDN loading**
  (`@strudel/web@1.3.0` from unpkg, samples from strudel.b-cdn.net) — nothing bundled,
  repo stays pure MIT; internet required at play time; offline = future milestone after
  license verification.
- **Pattern hot-swap confirmed viable:** Strudel re-evaluate preserves clock phase
  (Cyclist just swaps the pattern reference) but applies at the next ~50 ms tick, not the
  bar. Bar-boundary quantize is implemented client-side (delay to next cycle start).
- **MCP stack:** `@modelcontextprotocol/sdk` ^1.29.0 (v2 beta), McpServer + registerTool
  + zod, stdio; stdio+WS-sidecar is community precedent — pitfalls: never log to stdout,
  handle port collision, close sidecar on transport close.

## 7. Open questions

- Voice input: out of scope initially? (Text chat first; voice is a front-end concern.)
- Does Strudel's scheduling allow clean bar-boundary pattern swap from an external
  controller, or does the existing MCP restart playback? (Verify during prototype.)
- Groove *feel* evaluation: how do we judge "does this feel like Brick House"?
  Consider a small human-rated test set of 10 famous grooves.
- MIDI out (drive external synths/DAW) as a stretch goal.

## 8. Outcome: v1 built (2026-07-25)

The thin path (§5, candidate 1) was validated the same day — not on top of an existing
Strudel MCP (all AGPL, wrong shape; see §6) but as a fresh MIT-licensed
drummer-vocabulary MCP server pushing compiled Strudel code to a local page. The core
bet held: a frontier model given only the tool descriptions authored a convincing
Brick-House-style groove (syncopated kick, ghost-noted backbeat, 16th hats) on its
first attempt, unprompted, and iterated on it musically.

§7's open questions, resolved:

- **Voice input** — confirmed out of scope for v1 (SPEC D-5); arrives free via MCP
  clients / OS dictation later.
- **Bar-boundary swap** — yes, cleanly, but not for free: Strudel's re-evaluate
  preserves clock phase yet applies at the next ~50 ms tick, so the page quantizes
  swaps to the bar itself, firing 300 ms *early* because the scheduler queues ahead
  (SPEC D-10 + M2 log). Measured: swap downbeat within 5 ms of the bar line.
- **Groove feel evaluation** — solved without humans in the loop (SPEC D-13): a
  Playwright harness records the page's real audio to WAV, DSP assertions check
  onsets/tempo/ghost-vs-accent/swing/seams, and Gemini (native audio understanding)
  judges feel. The human-rated 10-groove test set was never needed.
- **MIDI out** — still a stretch goal; parked alongside other expansions in IDEAS.md.

Decision gate from §5: the standalone engine (candidate 2) was **not** needed — Strudel
loaded at page runtime left nothing to own except the schema and compiler, which we own
anyway. Full requirements, decisions, and milestone log: `specs/drummer-v1/SPEC.md`.
