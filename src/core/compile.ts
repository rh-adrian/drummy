import type { Fill, Groove, Voice } from "./groove.js";

// Compiles a validated groove to Strudel code.
//
// Timing model: one Strudel cycle = one bar (setcpm(bpm/4), D-11). The mini
// grid holds bars*resolution steps; multi-bar grooves get .slow(bars) on the
// stack so each bar stays one cycle. Because .late() before .slow(bars) is
// stretched by the slow factor, a shift of d steps is emitted as
// .late(d / (bars*resolution)) — after stretching it lands exactly d real
// steps late at any bar count.
//
// Per-hit velocity rides an aligned .gain() grid. Per-hit micro-timing and
// swing (applied to odd "off" steps) can't vary per event inside one mini
// pattern, so each voice is split into groups sharing the same total delay.
//
// The Acoustic bank is velocity-layered (v1.3): page/acoustic.json gives every
// voice exactly ACOUSTIC_SLOTS samples ordered soft→loud, so velocity also
// picks the recording via an aligned .n() grid. The source files are
// peak-normalized (D-29), so the recordings carry the TIMBRE of each dynamic
// while .gain(vel) restores the level — the same vel→gain rule as every
// machine bank.

const ACOUSTIC_BANK = "Acoustic";
const ACOUSTIC_SLOTS = 8;

function acousticSlot(vel: number): number {
  return Math.min(ACOUSTIC_SLOTS - 1, Math.floor(vel * ACOUSTIC_SLOTS));
}

export function compileGroove(groove: Groove): string {
  const totalSteps = groove.bars * groove.resolution;
  const acoustic = groove.bank === ACOUSTIC_BANK;
  const head = `setcpm(${formatNumber(groove.tempoBpm)}/4)`;
  const slow = groove.bars > 1 ? `.slow(${groove.bars})` : "";

  const base = compileStack(groove.voices, groove, totalSteps, acoustic);
  const fills = groove.fillsEnabled && groove.fills ? groove.fills : [];

  if (fills.length === 0) {
    // Everything muted/empty still needs VALID code — silence, not stack().
    if (base === "silence") return `${head}\n$: silence`;
    return `${head}\n$: ${base}${slow}`;
  }

  // Fills (v1.7 D-46): one complete pattern per variant, chosen per cycle by
  // Strudel's cycle-seeded weighted random — non-periodic by construction.
  // slow(bars) wraps the CHOICE so a variant owns a whole loop, not one bar.
  const variants = fills.map((fill) =>
    compileStack(applyFill(groove.voices, fill, totalSteps), groove, totalSteps, acoustic),
  );
  // Base weight so P(any fill) = fillChance; each fill weighs 1.
  const baseWeight = formatNumber((fills.length * (1 - groove.fillChance)) / groove.fillChance);
  const entries = [`[${base}, ${baseWeight}]`, ...variants.map((v) => `[${v}, 1]`)];
  return `${head}\n$: wrandcat(\n${entries.join(",\n")}\n)${slow}`;
}

function compileStack(voices: Voice[], groove: Groove, totalSteps: number, acoustic: boolean): string {
  // Muted and hitless channels are state, not sound (v1.6 D-40/D-41).
  const entries = voices
    .filter((voice) => !voice.muted && voice.hits.length > 0)
    .flatMap((voice) => compileVoice(voice, groove.swing, totalSteps, acoustic));
  if (entries.length === 0) return "silence";
  return `stack(\n  ${entries.join(",\n  ")}\n).bank("${groove.bank}")`;
}

/** Base with the fill overlaid: the fill OWNS its end-of-loop window (D-47). */
function applyFill(voices: Voice[], fill: Fill, totalSteps: number): Voice[] {
  const start = totalSteps - fill.steps;
  const out = voices.map((v) => ({ ...v, hits: v.hits.filter((h) => h.step < start) }));
  for (const fillVoice of fill.voices) {
    const hits = fillVoice.hits.map((h) => ({ ...h, step: h.step + start }));
    const existing = out.find((v) => v.drum === fillVoice.drum);
    if (existing) existing.hits = [...existing.hits, ...hits].sort((a, b) => a.step - b.step);
    else out.push({ ...fillVoice, hits });
  }
  return out;
}

function compileVoice(voice: Voice, swing: number, totalSteps: number, acoustic: boolean): string[] {
  // Group hits by their total delay in steps (swing on off-steps + micro).
  const groups = new Map<number, Voice["hits"]>();
  for (const hit of voice.hits) {
    const delaySteps = round((hit.step % 2 === 1 ? swing : 0) + hit.micro);
    const group = groups.get(delaySteps);
    if (group) group.push(hit);
    else groups.set(delaySteps, [hit]);
  }

  return [...groups.keys()]
    .sort((a, b) => a - b)
    .map((delaySteps) => {
      const hits = groups.get(delaySteps)!;
      const mini: string[] = Array(totalSteps).fill("~");
      const gains: string[] = Array(totalSteps).fill("~");
      const slots: string[] = Array(totalSteps).fill("~");
      for (const hit of hits) {
        mini[hit.step] = voice.drum;
        // trackGain is mix, not dynamics (v1.5 D-35): it scales the level but
        // the Acoustic slot below stays a function of velocity alone.
        gains[hit.step] = formatNumber(hit.vel * (voice.trackGain ?? 1));
        slots[hit.step] = String(acousticSlot(hit.vel));
      }
      let entry = `s("${mini.join(" ")}")`;
      if (acoustic) entry += `.n("${slots.join(" ")}")`;
      entry += `.gain("${gains.join(" ")}")`;
      if (delaySteps > 0) entry += `.late(${formatNumber(delaySteps)}/${totalSteps})`;
      else if (delaySteps < 0) entry += `.early(${formatNumber(-delaySteps)}/${totalSteps})`;
      return entry;
    });
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function formatNumber(value: number): string {
  return round(value).toString();
}
