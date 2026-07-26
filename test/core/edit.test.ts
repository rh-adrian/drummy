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
