# Ideas / Future Expansions

Parked concepts — explicitly NOT in scope for the current spec (`specs/drummer-v1/SPEC.md`).
When one gets picked up, it becomes its own spec under `specs/`.

## Bass MIDI from mouthed basslines (captured 2026-07-25)

The vibe: talking to your best buddy the bassist in real life and asking him to play
certain things — including just *mouthing the bassline at him* ("dum dum da-dum") and
having him play it back properly.

Pipeline as originally sketched:

1. **Transient preprocessor** — detect the beginnings of transients in the mouthed audio
   and estimate a BPM from them. If a drum beat is already playing, skip estimation and
   lock to the drummer's BPM instead.
2. **Pitch extraction** — preprocess each mouthed note to pull the actual musical note
   (the hummed/mouthed pitch → nearest real note).
3. **Timing alignment** — line the transients up with the drum beat grid; if no drum beat
   exists, lay them out using the raw timing of each transient.
4. **Note length** — listen for tails on the waveform to know how long each note is held.
5. **Dynamics** — compare transient peak averages to find where the user wants stress
   (accents) on notes.
6. **LLM performance** — hand all of this structured info (notes, grid positions,
   durations, accents, BPM) to an LLM, which plays/refines the bassline via MIDI output.

Notes for whenever this gets specced:

- This deliberately revisits two current non-goals at once: audio *input* analysis and a
  non-drum instrument. The drummer's groove schema (steps, velocity, micro-timing) is a
  good template for the intermediate representation — the preprocessor's output could be
  "groove JSON but with pitches," which the same LLM + MCP surface pattern can drive.
- Steps 1–5 are classic DSP (onset detection, monophonic pitch tracking, envelope
  analysis) — well-trodden; the M2 capture-harness analysis code (onsets, RMS, timing
  grids) is a head start on the same primitives.
- MIDI out means a synth target (DAW, fluidsynth, or a Strudel bass voice) — decide when
  specced.
