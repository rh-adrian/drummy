# AI Drummer

An open-source AI drummer you can talk to and jam with.

Say *"hey, give me a beat like Brick House"* and a groove starts playing. Say *"more hi-hat, busier fill at the end"* and it applies at the next bar.

## Concept

Frontier LLMs don't have note-perfect recall of song transcriptions, but they reliably know **groove-level** facts about nearly every song (Brick House ≈ 100 BPM funk, syncopated 16th hats, kick locked to the bass, ghost-noted snare on 2 and 4) — plus deep music theory. That's the same information a session drummer extracts from "play it like Brick House."

So instead of neural audio generation (Magenta, Suno, etc.), this project uses a **symbolic** approach:

1. **Free public drum captures** (real sampled hits from TR-808s, TR-909s, LinnDrums, acoustic kits)
2. **A sequencer engine** that triggers those samples from pattern data on a loop
3. **An MCP server** wrapping the engine in drummer-vocabulary tools (`set_groove`, `add_fill`, `swing_amount`, `halftime`, `set_kit`)
4. **An LLM agent** that translates natural language ("like Brick House") → groove description → pattern

Real-time responsiveness is not required. Changes hot-swap at the next bar boundary, which feels musically natural (~2–4s in practice).

## Architecture (proposed)

```
You (chat/voice)
   │
   ▼
LLM agent  ──  knows songs + music theory, speaks drummer language
   │  MCP tools: set_groove / add_fill / set_tempo / set_kit / mutate ...
   ▼
MCP server
   │  pattern JSON (per-hit velocity + micro-timing offsets)
   ▼
Sequencer engine  ──  loops pattern on a clock, bar-boundary hot-swap
   │
   ▼
Sample library  ──  free/open-licensed drum captures
```

Two candidate builds (see [RESEARCH.md](RESEARCH.md) for full analysis):

| Path | Engine | Effort | Notes |
|------|--------|--------|-------|
| 1. Thin | [Strudel](https://strudel.cc) (browser TidalCycles) | Afternoon prototype | Samples + scheduling already solved; bundled open-licensed drum-machine captures |
| 2. Self-contained | Own Node/Python looping sampler | Larger | Zero dependencies, fully-owned MCP schema |

Plan: prototype on path 1 to validate that LLM-written grooves feel good, then decide if the standalone engine is worth owning.

## Key design principle

The pattern schema must include **per-hit velocity and micro-timing offsets**. That's the difference between a robotic grid and something that feels like Brick House. Ghost notes, swing, and push/drag are first-class citizens.

## Status

Research phase. See [RESEARCH.md](RESEARCH.md).

## License

TBD (intended open source).
