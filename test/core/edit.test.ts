import { describe, it, expect } from "vitest";
import { parseGroove, type Groove } from "../../src/core/groove.js";
import { toggleStep } from "../../src/core/edit.js";

// v1.2 FR-2/FR-4: pure toggle merge — the server-side core of click-to-edit.

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

describe("toggleStep", () => {
  it("adds a hit at vel 0.8 to an existing voice (D-19)", () => {
    const res = toggleStep(groove(), "hh", 6);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const hh = res.groove.voices.find((v) => v.drum === "hh")!;
      expect(hh.hits.map((h) => h.step).sort((a, b) => a - b)).toEqual([2, 6]);
      expect(hh.hits.find((h) => h.step === 6)!.vel).toBe(0.8);
    }
  });

  it("removes an existing hit", () => {
    const res = toggleStep(groove(), "bd", 8);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.groove.voices.find((v) => v.drum === "bd")!.hits.map((h) => h.step)).toEqual([0]);
    }
  });

  it("drops the voice when its last hit is removed", () => {
    const res = toggleStep(groove(), "hh", 2);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.groove.voices.map((v) => v.drum)).toEqual(["bd"]);
    }
  });

  it("refuses edits that would leave the groove empty", () => {
    const g = groove();
    const only = toggleStep(g, "hh", 2);
    if (!only.ok) throw new Error("setup");
    const one = toggleStep(only.groove, "bd", 0);
    if (!one.ok) throw new Error("setup");
    // bd is now the only voice with only step 8
    const res = toggleStep(one.groove, "bd", 8);
    expect(res.ok).toBe(false);
  });

  it("refuses a drum with no row and an out-of-range step", () => {
    expect(toggleStep(groove(), "cr", 0).ok).toBe(false); // no cr voice in the groove
    expect(toggleStep(groove(), "kick", 0).ok).toBe(false); // not a drum at all
    expect(toggleStep(groove(), "bd", 16).ok).toBe(false); // 1 bar × res 16 → max 15
    expect(toggleStep(groove(), "bd", -1).ok).toBe(false);
    expect(toggleStep(groove(), "bd", 3.5).ok).toBe(false);
  });

  it("does not mutate the input groove", () => {
    const g = groove();
    const before = JSON.stringify(g);
    toggleStep(g, "hh", 6);
    toggleStep(g, "bd", 8);
    expect(JSON.stringify(g)).toBe(before);
  });
});

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

  it("drops a voice whose last hit cycles off, but refuses to empty the groove", () => {
    let g = groove();
    // hh 0.5 → X → g → off (3 clicks) leaves hh empty → voice dropped
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
    expect(off.groove.voices.some((v) => v.drum === "hh")).toBe(false);
  });

  it("refuses out-of-range steps and unknown voices with reasons", () => {
    expect(cycleStep(groove(), "bd", 99).ok).toBe(false);
    expect(cycleStep(groove(), "sp", 0).ok).toBe(false);
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
