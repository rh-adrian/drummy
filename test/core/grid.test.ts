import { describe, it, expect } from "vitest";
import { gridToVoices, renderGrid } from "../../src/core/grid.js";
import { parseGroove, type Groove } from "../../src/core/groove.js";

function groove(input: unknown): Groove {
  const result = parseGroove(input);
  if (!result.ok) throw new Error(`test groove invalid: ${result.error}`);
  return result.groove;
}

describe("gridToVoices", () => {
  it("maps the four velocity letters to their tiers (D-30)", () => {
    const result = gridToVoices({ sd: "Xxog------------" }, 1, 16);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.voices).toEqual([
      {
        drum: "sd",
        hits: [
          { step: 0, vel: 1, micro: 0 },
          { step: 1, vel: 0.7, micro: 0 },
          { step: 2, vel: 0.5, micro: 0 },
          { step: 3, vel: 0.25, micro: 0 },
        ],
      },
    ]);
  });

  it("accepts O as an accent alias (paper notation, FR-2)", () => {
    const result = gridToVoices({ bd: "O---------------" }, 1, 16);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.voices[0].hits).toEqual([{ step: 0, vel: 1, micro: 0 }]);
  });

  it("treats both - and . as rests and strips | and spaces", () => {
    const result = gridToVoices({ hh: "x-x. | x.x- | x-x- | x.x." }, 1, 16);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.voices[0].hits.map((h) => h.step)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it("handles triplet resolutions (12 steps per bar)", () => {
    const result = gridToVoices({ rd: "x-x|x-x|x-x|x-x" }, 1, 12);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.voices[0].hits.map((h) => h.step)).toEqual([0, 2, 3, 5, 6, 8, 9, 11]);
  });

  it("handles multi-bar rows (bars * resolution characters)", () => {
    const result = gridToVoices({ bd: "X---------------x---------------" }, 2, 16);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.voices[0].hits).toEqual([
      { step: 0, vel: 1, micro: 0 },
      { step: 16, vel: 0.7, micro: 0 },
    ]);
  });

  it("skips all-rest rows (drum-tab convention: empty rows are placeholders)", () => {
    const result = gridToVoices({ bd: "X---------------", lt: "----------------" }, 1, 16);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.voices.map((v) => v.drum)).toEqual(["bd"]);
  });

  it("rejects an unknown character, naming it, the row, the step, and the legend", () => {
    const result = gridToVoices({ hh: "x-q-------------" }, 1, 16);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('grid row "hh"');
    expect(result.error).toContain('"q"');
    expect(result.error).toContain("step 2");
    expect(result.error).toMatch(/X.*x.*o.*g/);
  });

  it("rejects an unknown drum with the valid-drums list", () => {
    const result = gridToVoices({ kick: "X---------------" }, 1, 16);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("kick");
    expect(result.error).toContain("bd");
    expect(result.error).toContain("sd");
  });

  it("rejects a row whose step count does not match bars x resolution, showing the math", () => {
    const result = gridToVoices({ hh: "x-x-x-x-x-x-x-x-" }, 2, 16);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('grid row "hh"');
    expect(result.error).toContain("16 steps");
    expect(result.error).toContain("32");
  });

  it("rejects a grid with no hits at all", () => {
    const result = gridToVoices({ bd: "----------------" }, 1, 16);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("no hits");
  });
});

describe("renderGrid", () => {
  it("renders rows in page ROW_ORDER with beat separators and nearest-letter velocities (FR-4)", () => {
    const g = groove({
      tempoBpm: 100,
      bank: "Acoustic",
      voices: [
        { drum: "bd", hits: [{ step: 0, vel: 1 }, { step: 10, vel: 0.7 }] },
        { drum: "sd", hits: [{ step: 4, vel: 0.95 }, { step: 12, vel: 0.3 }] },
        { drum: "hh", hits: [0, 2, 4, 6, 8, 10, 12, 14].map((step) => ({ step, vel: 0.6 })) },
      ],
    });
    expect(renderGrid(g)).toBe(
      ["hh:  x-x-|x-x-|x-x-|x-x-", "sd:  ----|X---|----|g---", "bd:  X---|----|--x-|----"].join("\n"),
    );
  });

  it("snaps velocities to the nearest letter tier", () => {
    const g = groove({
      tempoBpm: 100,
      bank: "Acoustic",
      voices: [
        {
          drum: "sd",
          hits: [
            { step: 0, vel: 0.86 }, // → X (≥ 0.85 midpoint)
            { step: 1, vel: 0.61 }, // → x
            { step: 2, vel: 0.45 }, // → o
            { step: 3, vel: 0.37 }, // → g (< 0.375 midpoint)
          ],
        },
      ],
    });
    expect(renderGrid(g)).toContain("Xxog");
  });

  it("separates bars with || and pads 3-letter drum names evenly", () => {
    const g = groove({
      tempoBpm: 100,
      bank: "Acoustic",
      bars: 2,
      voices: [
        { drum: "rim", hits: [{ step: 0, vel: 0.7 }, { step: 16, vel: 0.7 }] },
        { drum: "bd", hits: [{ step: 0, vel: 1 }] },
      ],
    });
    expect(renderGrid(g)).toBe(
      ["rim: x---|----|----|----||x---|----|----|----", "bd:  X---|----|----|----||----|----|----|----"].join("\n"),
    );
  });

  it("groups triplet resolutions by resolution/4 per beat", () => {
    const g = groove({
      tempoBpm: 100,
      bank: "Acoustic",
      resolution: 12,
      voices: [{ drum: "rd", hits: [{ step: 0, vel: 0.7 }, { step: 3, vel: 0.7 }, { step: 6, vel: 0.7 }, { step: 9, vel: 0.7 }] }],
    });
    expect(renderGrid(g)).toBe("rd:  x--|x--|x--|x--");
  });

  it("round-trips: parsing a rendered grid reproduces steps and letter-tier velocities", () => {
    const original = groove({
      tempoBpm: 100,
      bank: "Acoustic",
      voices: [
        { drum: "hh", hits: [0, 2, 4, 6].map((step) => ({ step, vel: 0.7 })) },
        { drum: "sd", hits: [{ step: 4, vel: 1 }, { step: 7, vel: 0.25 }] },
      ],
    });
    const rows = Object.fromEntries(
      renderGrid(original)
        .split("\n")
        .map((line) => {
          const [name, pattern] = line.split(":");
          return [name.trim(), pattern.trim()];
        }),
    );
    const back = gridToVoices(rows, 1, 16);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const byDrum = Object.fromEntries(back.voices.map((v) => [v.drum, v.hits]));
    expect(byDrum.hh).toEqual(original.voices[0].hits);
    expect(byDrum.sd).toEqual(original.voices[1].hits);
  });
});

describe("parseGroove with grid input (FR-1)", () => {
  const base = { tempoBpm: 100, bank: "Acoustic" };

  it("accepts grid instead of voices and produces the equivalent groove", () => {
    const viaGrid = parseGroove({ ...base, grid: { bd: "X---|----|X---|----" } });
    const viaVoices = parseGroove({ ...base, voices: [{ drum: "bd", hits: [{ step: 0, vel: 1 }, { step: 8, vel: 1 }] }] });
    expect(viaGrid.ok).toBe(true);
    expect(viaVoices.ok).toBe(true);
    if (!viaGrid.ok || !viaVoices.ok) return;
    expect(viaGrid.groove).toEqual(viaVoices.groove);
  });

  it("rejects grid AND voices together with an actionable message", () => {
    const result = parseGroove({
      ...base,
      grid: { bd: "X---------------" },
      voices: [{ drum: "sd", hits: [{ step: 4 }] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("grid");
    expect(result.error).toContain("voices");
    expect(result.error).toMatch(/not both/i);
  });

  it("rejects neither grid nor voices, teaching both formats", () => {
    const result = parseGroove(base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("grid");
    expect(result.error).toContain("voices");
  });

  it("surfaces grid conversion errors through parseGroove", () => {
    const result = parseGroove({ ...base, grid: { hh: "x-x-" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('grid row "hh"');
  });

  it("respects bars and resolution when sizing the grid", () => {
    const result = parseGroove({ ...base, bars: 2, resolution: 12, grid: { bd: "X--|---|---|---||x--|---|---|---" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groove.voices[0].hits).toEqual([
      { step: 0, vel: 1, micro: 0 },
      { step: 12, vel: 0.7, micro: 0 },
    ]);
  });
});
