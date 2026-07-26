import { describe, it, expect } from "vitest";
import { parseGroove, type Groove } from "../../src/core/groove.js";

// v1.2's toggleStep (fixed 0.8 click velocity, D-19) was overturned by v1.5's
// cycle editing (D-36) and deleted in v1.6 — cycleStep below is the server-side
// core of click-to-edit.

function groove(): Groove {
  const parsed = parseGroove({
    tempoBpm: 96,
    bank: "RolandTR808",
    voices: [
      { drum: "bd", hits: [{ step: 0 }, { step: 8 }] },
      { drum: "hh", hits: [{ step: 2, vel: 0.5 }] },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.groove;
}

// v1.5 FR-4/FR-3: cycle editing + track volume (pure merges).

import { cycleStep, setTrackGain } from "../../src/core/edit.js";

describe("cycleStep", () => {
  const vel = (g: Groove, drum: string, step: number) =>
    g.voices.find((v) => v.drum === drum)?.hits.find((h) => h.step === step)?.vel;

  it("adds a normal hit (0.7) on an empty cell", () => {
    const res = cycleStep(groove(), "bd", 4);
    expect(res.ok).toBe(true);
    if (res.ok) expect(vel(res.groove, "bd", 4)).toBe(0.7);
  });

  it("cycles normal → stress → ghost → off", () => {
    let g = groove(); // bd has a default-vel (1.0 = stress tier) hit at step 0
    const r1 = cycleStep(g, "bd", 0); // X → g
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(vel(r1.groove, "bd", 0)).toBe(0.25);
    const r2 = cycleStep(r1.groove, "bd", 0); // g → off
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(vel(r2.groove, "bd", 0)).toBeUndefined();
    const r3 = cycleStep(r2.groove, "bd", 0); // off → x
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(vel(r3.groove, "bd", 0)).toBe(0.7);
    const r4 = cycleStep(r3.groove, "bd", 0); // x → X
    expect(r4.ok).toBe(true);
    if (r4.ok) expect(vel(r4.groove, "bd", 0)).toBe(1);
  });

  it("snaps LLM-written velocities to the nearest cycle tier before advancing", () => {
    const base = groove(); // hh step 2 has vel 0.5 → nearest cycle tier is x(0.7) → advance to X
    const r = cycleStep(base, "hh", 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(vel(r.groove, "hh", 2)).toBe(1);
  });

  it("keeps a voice whose last hit cycles off — the empty row persists (v1.6 D-40)", () => {
    let g = groove();
    // hh 0.5 → X → g → off (3 clicks) leaves hh empty but PRESENT
    for (const expected of [1, 0.25]) {
      const r = cycleStep(g, "hh", 2);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      g = r.groove;
      expect(vel(g, "hh", 2)).toBe(expected);
    }
    const off = cycleStep(g, "hh", 2);
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    const hh = off.groove.voices.find((v) => v.drum === "hh");
    expect(hh).toBeDefined();
    expect(hh!.hits).toEqual([]);
  });

  it("refuses out-of-range steps and unknown voices with reasons", () => {
    expect(cycleStep(groove(), "bd", 99).ok).toBe(false);
    expect(cycleStep(groove(), "sp", 0).ok).toBe(false);
    expect(cycleStep(groove(), "bd", 3.5).ok).toBe(false);
    expect(cycleStep(groove(), "bd", -1).ok).toBe(false);
  });

  it("does not mutate the input groove", () => {
    const g = groove();
    const before = JSON.stringify(g);
    cycleStep(g, "hh", 6);
    cycleStep(g, "bd", 8);
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe("setTrackGain", () => {
  it("sets the voice's trackGain and re-validates", () => {
    const res = setTrackGain(groove(), "hh", 0.6);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.groove.voices.find((v) => v.drum === "hh")?.trackGain).toBe(0.6);
  });

  it("rejects gains outside 0..1.5 and unknown drums", () => {
    expect(setTrackGain(groove(), "hh", 1.6).ok).toBe(false);
    expect(setTrackGain(groove(), "hh", -0.1).ok).toBe(false);
    expect(setTrackGain(groove(), "sp", 0.5).ok).toBe(false);
  });
});

// v1.6 FR-2/FR-3: mute + clear (pure merges).

import { clearTrack, muteTrack } from "../../src/core/edit.js";

describe("clearTrack", () => {
  it("empties the channel's hits but keeps the voice, fader, and mute state", () => {
    const withGain = setTrackGain(groove(), "hh", 0.6);
    if (!withGain.ok) throw new Error("setup");
    const res = clearTrack(withGain.groove, "hh");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const hh = res.groove.voices.find((v) => v.drum === "hh")!;
    expect(hh.hits).toEqual([]);
    expect(hh.trackGain).toBe(0.6);
  });

  it("refuses unknown drums with a reason", () => {
    const res = clearTrack(groove(), "sp");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("sp");
  });
});

describe("muteTrack", () => {
  it("toggles muted on and off, preserving hits and fader", () => {
    const withGain = setTrackGain(groove(), "hh", 0.6);
    if (!withGain.ok) throw new Error("setup");
    const on = muteTrack(withGain.groove, "hh");
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    const hhOn = on.groove.voices.find((v) => v.drum === "hh")!;
    expect(hhOn.muted).toBe(true);
    expect(hhOn.trackGain).toBe(0.6);
    expect(hhOn.hits.length).toBeGreaterThan(0);
    const off = muteTrack(on.groove, "hh");
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.groove.voices.find((v) => v.drum === "hh")!.muted).toBe(false);
  });

  it("refuses unknown drums", () => {
    expect(muteTrack(groove(), "sp").ok).toBe(false);
  });
});
