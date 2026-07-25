import type { Groove, Voice } from "./groove.js";

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

export function compileGroove(groove: Groove): string {
  const totalSteps = groove.bars * groove.resolution;

  const entries = groove.voices.flatMap((voice) => compileVoice(voice, groove.swing, totalSteps));

  const stack = `stack(\n  ${entries.join(",\n  ")}\n).bank("${groove.bank}")${groove.bars > 1 ? `.slow(${groove.bars})` : ""}`;

  return `setcpm(${formatNumber(groove.tempoBpm)}/4)\n$: ${stack}`;
}

function compileVoice(voice: Voice, swing: number, totalSteps: number): string[] {
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
      for (const hit of hits) {
        mini[hit.step] = voice.drum;
        gains[hit.step] = formatNumber(hit.vel);
      }
      let entry = `s("${mini.join(" ")}").gain("${gains.join(" ")}")`;
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
