import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS browser module, no types (same pattern as quantize.test.ts)
import { gridModel, playheadStep } from "../../page/grid.js";

// v1.1 FR-2/FR-3: pure grid math shared between the page and vitest.

const GROOVE = {
  tempoBpm: 96,
  swing: 0,
  bank: "RolandTR808",
  bars: 1,
  resolution: 16,
  voices: [
    { drum: "bd", hits: [{ step: 0, vel: 1, micro: 0 }, { step: 8, vel: 0.9, micro: 0 }] },
    { drum: "hh", hits: [{ step: 2, vel: 0.5, micro: 0 }] },
    { drum: "sd", hits: [{ step: 4, vel: 0.25, micro: 0 }] },
  ],
};

describe("gridModel", () => {
  it("builds one row per voice with kick on the bottom, cymbals/hats above", () => {
    const m = gridModel(GROOVE);
    expect(m.rows.map((r: { drum: string }) => r.drum)).toEqual(["hh", "sd", "bd"]);
  });

  it("marks cells with hit velocities and leaves the rest null", () => {
    const m = gridModel(GROOVE);
    expect(m.steps).toBe(16);
    const bd = m.rows.find((r: { drum: string }) => r.drum === "bd");
    expect(bd.cells).toHaveLength(16);
    expect(bd.cells[0]).toBe(1);
    expect(bd.cells[8]).toBe(0.9);
    expect(bd.cells[1]).toBeNull();
    const sd = m.rows.find((r: { drum: string }) => r.drum === "sd");
    expect(sd.cells[4]).toBe(0.25); // ghost velocity survives for dim rendering
  });

  it("defaults velocity to 1 for hits without one (defensive against raw grooves)", () => {
    const m = gridModel({ ...GROOVE, voices: [{ drum: "bd", hits: [{ step: 3 }] }] });
    expect(m.rows[0].cells[3]).toBe(1);
  });

  it("spans multiple bars: bars*resolution cells, later-bar steps land where they should", () => {
    const m = gridModel({
      ...GROOVE,
      bars: 2,
      voices: [{ drum: "bd", hits: [{ step: 20, vel: 0.8, micro: 0 }] }],
    });
    expect(m.steps).toBe(32);
    expect(m.rows[0].cells[20]).toBe(0.8);
  });

  it("handles resolutions 8 and 32 and exposes beat length for separators", () => {
    expect(gridModel({ ...GROOVE, resolution: 8, voices: [{ drum: "bd", hits: [{ step: 7 }] }] }).steps).toBe(8);
    expect(gridModel({ ...GROOVE, resolution: 32, voices: [{ drum: "bd", hits: [{ step: 31 }] }] }).steps).toBe(32);
    expect(gridModel(GROOVE).beatLen).toBe(4); // 16ths → 4 per beat
    expect(gridModel({ ...GROOVE, resolution: 12, voices: GROOVE.voices.map((v) => ({ ...v, hits: [{ step: 0 }] })) }).beatLen).toBe(3);
  });

  it("ignores out-of-range steps instead of breaking the layout", () => {
    const m = gridModel({ ...GROOVE, voices: [{ drum: "bd", hits: [{ step: 99, vel: 1, micro: 0 }] }] });
    expect(m.rows[0].cells).toHaveLength(16);
    expect(m.rows[0].cells.every((c: number | null) => c === null)).toBe(true);
  });
});

describe("playheadStep", () => {
  it("maps scheduler cycle position to the current step (one cycle = one bar, D-11)", () => {
    expect(playheadStep(0, 1, 16)).toBe(0);
    expect(playheadStep(0.5, 1, 16)).toBe(8);
    expect(playheadStep(0.999, 1, 16)).toBe(15);
  });

  it("wraps around multi-bar loops using cycles mod bars", () => {
    // bars=2: pattern position = cyclePos mod 2 bars
    expect(playheadStep(3.25, 2, 16)).toBe(20); // 1.25 bars in → step 20
    expect(playheadStep(2.0, 2, 16)).toBe(0);
  });

  it("clamps float edge cases into range and rejects bad input with null", () => {
    expect(playheadStep(0.9999999999999999, 1, 16)).toBeLessThanOrEqual(15);
    expect(playheadStep(NaN, 1, 16)).toBeNull();
    expect(playheadStep(5, 0, 16)).toBeNull();
    expect(playheadStep(-0.001, 1, 16)).toBeNull(); // pre-start / clock weirdness → hide
  });
});
