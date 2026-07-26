import { describe, it, expect } from "vitest";
import { parseGroove } from "../../src/core/groove.js";

const acousticGroove = {
  tempoBpm: 100,
  bank: "Acoustic",
  voices: [
    { drum: "bd", hits: [{ step: 0 }] },
    { drum: "cb", hits: [{ step: 2, vel: 0.7 }] },
    { drum: "ch", hits: [{ step: 4 }] },
    { drum: "sp", hits: [{ step: 8, vel: 0.5 }] },
  ],
};

const validGroove = {
  tempoBpm: 100,
  swing: 0.12,
  bank: "RolandTR808",
  bars: 1,
  resolution: 16,
  voices: [
    {
      drum: "bd",
      hits: [
        { step: 0, vel: 1.0 },
        { step: 7, vel: 0.9, micro: -0.05 },
        { step: 10, vel: 0.85 },
      ],
    },
    {
      drum: "sd",
      hits: [
        { step: 4, vel: 0.95 },
        { step: 9, vel: 0.25 },
        { step: 12, vel: 0.95 },
      ],
    },
    { drum: "hh", hits: [{ step: 0 }, { step: 2 }, { step: 4 }, { step: 6 }] },
  ],
};

describe("parseGroove", () => {
  it("accepts the Acoustic bank and the v1.3 voices cb/ch/sp", () => {
    const result = parseGroove(acousticGroove);
    expect(result.ok).toBe(true);
  });

  it("accepts a valid groove and applies defaults", () => {
    const result = parseGroove(validGroove);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groove.tempoBpm).toBe(100);
    // defaults
    expect(result.groove.voices[2].hits[0].vel).toBe(1);
    expect(result.groove.voices[2].hits[0].micro).toBe(0);
  });

  it("defaults swing to 0, bars to 1, resolution to 16", () => {
    const result = parseGroove({
      tempoBpm: 120,
      bank: "RolandTR909",
      voices: [{ drum: "bd", hits: [{ step: 0 }] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groove.swing).toBe(0);
    expect(result.groove.bars).toBe(1);
    expect(result.groove.resolution).toBe(16);
  });

  it("rejects an unknown drum name and lists valid drums in the message", () => {
    const result = parseGroove({
      ...validGroove,
      voices: [{ drum: "kick", hits: [{ step: 0 }] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("kick");
    expect(result.error).toContain("bd");
  });

  it("rejects an unknown bank and lists valid banks in the message", () => {
    const result = parseGroove({ ...validGroove, bank: "TR808" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("TR808");
    expect(result.error).toContain("RolandTR808");
  });

  it("rejects a step outside bars*resolution with an actionable message", () => {
    const result = parseGroove({
      ...validGroove,
      bars: 1,
      resolution: 16,
      voices: [{ drum: "bd", hits: [{ step: 16 }] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/step/i);
    expect(result.error).toContain("16");
    expect(result.error).toMatch(/0.{0,4}15/); // states the valid range
  });

  it("accepts steps in later bars when bars > 1", () => {
    const result = parseGroove({
      ...validGroove,
      bars: 2,
      voices: [{ drum: "bd", hits: [{ step: 31 }] }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects velocity above 1 and at or below 0", () => {
    const over = parseGroove({
      ...validGroove,
      voices: [{ drum: "bd", hits: [{ step: 0, vel: 1.5 }] }],
    });
    expect(over.ok).toBe(false);
    const zero = parseGroove({
      ...validGroove,
      voices: [{ drum: "bd", hits: [{ step: 0, vel: 0 }] }],
    });
    expect(zero.ok).toBe(false);
  });

  it("rejects micro offsets beyond ±0.5 of a step", () => {
    const result = parseGroove({
      ...validGroove,
      voices: [{ drum: "bd", hits: [{ step: 0, micro: 0.75 }] }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate voices for the same drum", () => {
    const result = parseGroove({
      ...validGroove,
      voices: [
        { drum: "bd", hits: [{ step: 0 }] },
        { drum: "bd", hits: [{ step: 8 }] },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/duplicate/i);
  });

  it("rejects multiple hits on the same step within a voice", () => {
    const result = parseGroove({
      ...validGroove,
      voices: [{ drum: "bd", hits: [{ step: 0, vel: 1 }, { step: 0, vel: 0.3 }] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("step 0");
    expect(result.error).toMatch(/flam/i);
  });

  it("names valid banks when bank is missing entirely", () => {
    const result = parseGroove({ tempoBpm: 100, voices: [{ drum: "bd", hits: [{ step: 0 }] }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("RolandTR808");
  });

  it("rejects tempo outside 40-300 bpm", () => {
    expect(parseGroove({ ...validGroove, tempoBpm: 20 }).ok).toBe(false);
    expect(parseGroove({ ...validGroove, tempoBpm: 400 }).ok).toBe(false);
  });

  it("rejects empty voices with an actionable message", () => {
    const result = parseGroove({ ...validGroove, voices: [] });
    expect(result.ok).toBe(false);
  });

  it("accepts triplet resolutions (12, 24)", () => {
    expect(parseGroove({ ...validGroove, resolution: 12, voices: [{ drum: "bd", hits: [{ step: 11 }] }] }).ok).toBe(true);
    expect(parseGroove({ ...validGroove, resolution: 24, voices: [{ drum: "bd", hits: [{ step: 23 }] }] }).ok).toBe(true);
  });
});

describe("trackGain (v1.5 FR-1)", () => {
  const base = { tempoBpm: 100, bank: "RolandTR808" };

  it("accepts trackGain 0..1.5 and defaults it to 1", () => {
    const withGain = parseGroove({
      ...base,
      voices: [{ drum: "hh", hits: [{ step: 0 }], trackGain: 0.6 }],
    });
    expect(withGain.ok).toBe(true);
    if (withGain.ok) expect(withGain.groove.voices[0].trackGain).toBe(0.6);

    const without = parseGroove({ ...base, voices: [{ drum: "hh", hits: [{ step: 0 }] }] });
    expect(without.ok).toBe(true);
    if (without.ok) expect(without.groove.voices[0].trackGain).toBe(1);

    for (const edge of [0, 1.5]) {
      const r = parseGroove({ ...base, voices: [{ drum: "hh", hits: [{ step: 0 }], trackGain: edge }] });
      expect(r.ok, `trackGain ${edge}`).toBe(true);
    }
  });

  it("rejects out-of-range trackGain with an actionable message", () => {
    for (const bad of [-0.1, 1.6]) {
      const r = parseGroove({ ...base, voices: [{ drum: "hh", hits: [{ step: 0 }], trackGain: bad }] });
      expect(r.ok, `trackGain ${bad}`).toBe(false);
      if (!r.ok) expect(r.error).toContain("trackGain");
    }
  });

  it("applies trackGain default 1 to grid-notation voices too", () => {
    const r = parseGroove({ ...base, grid: { hh: "x---------------" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.groove.voices[0].trackGain).toBe(1);
  });
});

describe("empty channels and mute (v1.6 FR-1/FR-2)", () => {
  const base = { tempoBpm: 100, bank: "RolandTR808" };

  it("accepts a voice with zero hits (cleared channel keeps its row, D-40)", () => {
    const r = parseGroove({ ...base, voices: [{ drum: "hh", hits: [] }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.groove.voices[0].hits).toEqual([]);
  });

  it("defaults muted to false and round-trips muted: true", () => {
    const off = parseGroove({ ...base, voices: [{ drum: "hh", hits: [{ step: 0 }] }] });
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.groove.voices[0].muted).toBe(false);
    const on = parseGroove({ ...base, voices: [{ drum: "hh", hits: [{ step: 0 }], muted: true }] });
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.groove.voices[0].muted).toBe(true);
  });
});
