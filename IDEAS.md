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

## Neural groove humanizer (captured 2026-07-26, D-34 of v1.4)

If grid notation + musicianship teaching (v1.4) still leaves grooves feeling stiff:
a post-processing "humanize" stage that applies real-drummer velocity contours and
micro-timing to a quantized groove before compilation. Prior art: Google Magenta's
GrooVAE (https://magenta.withgoogle.com/groovae), trained on the Groove MIDI Dataset
(13.6 h of pro drummers on a TD-11, https://magenta.tensorflow.org/datasets/groove).
Their split matches our schema exactly: "score" = quantized steps, "groove" =
velocity + micro-timing. Could also be a hand-rolled rule set (swing + accent
contour + push/pull per genre) as a `humanize: 0-1` groove field — no ML dependency.

## Break / silence fills (captured 2026-07-26, v1.7 M1 note)

Grid fills currently require at least one hit ("grid has no hits at all" is an
error). A deliberate all-rest fill = a dramatic full-band STOP at the loop end —
musically legit (think James Brown hits). If wanted: allow an explicit
`{"silence": true}` fill form rather than weakening the no-hits validation.

## BPM slider on the page (captured 2026-10-25)

The transport has a BPM number box (v1.6) and the LLM has `set_tempo`. A slider next
to the box would make tempo feel like the volume faders: drag to find the pocket
instead of typing numbers. Came up while charting song-tab lookup; unrelated to it.
