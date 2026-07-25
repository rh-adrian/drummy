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

## 6. Open questions

- Voice input: out of scope initially? (Text chat first; voice is a front-end concern.)
- Does Strudel's scheduling allow clean bar-boundary pattern swap from an external
  controller, or does the existing MCP restart playback? (Verify during prototype.)
- Groove *feel* evaluation: how do we judge "does this feel like Brick House"?
  Consider a small human-rated test set of 10 famous grooves.
- MIDI out (drive external synths/DAW) as a stretch goal.
