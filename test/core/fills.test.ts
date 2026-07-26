import { describe, it, expect } from "vitest";
import { parseGroove, type Groove } from "../../src/core/groove.js";
import { compileGroove } from "../../src/core/compile.js";
import { setFillsEnabled } from "../../src/core/edit.js";
import { renderGrid } from "../../src/core/grid.js";

// v1.7: pre-authored fills, substituted at the loop end by in-pattern
// weighted per-cycle randomness (wrandcat, D-46).

function groove(input: unknown): Groove {
  const result = parseGroove(input);
  if (!result.ok) throw new Error(`test groove invalid: ${result.error}`);
  return result.groove;
}

const BASE = {
  tempoBpm: 100,
  bank: "RolandTR808",
  voices: [
    { drum: "bd", hits: [{ step: 0, vel: 1 }, { step: 14, vel: 0.7 }] },
    { drum: "hh", hits: [0, 2, 4, 6, 8, 10, 12, 14].map((step) => ({ step, vel: 0.7 })) },
  ],
};

describe("fill schema (FR-1)", () => {
  it("parses a grid fill into window-local voices with derived K", () => {
    const g = groove({ ...BASE, fills: [{ grid: { sd: "Xxxg" } }] });
    expect(g.fills).toHaveLength(1);
    expect(g.fills![0].steps).toBe(4);
    expect(g.fills![0].voices[0].drum).toBe("sd");
    expect(g.fills![0].voices[0].hits.map((h) => [h.step, h.vel])).toEqual([
      [0, 1],
      [1, 0.7],
      [2, 0.7],
      [3, 0.25],
    ]);
  });

  it("defaults fillsEnabled true and fillChance 0.25, keeps explicit values", () => {
    const g = groove({ ...BASE, fills: [{ grid: { sd: "Xxxg" } }] });
    expect(g.fillsEnabled).toBe(true);
    expect(g.fillChance).toBe(0.25);
    const g2 = groove({ ...BASE, fills: [{ grid: { sd: "Xxxg" } }], fillsEnabled: false, fillChance: 0.5 });
    expect(g2.fillsEnabled).toBe(false);
    expect(g2.fillChance).toBe(0.5);
  });

  it("rejects more than 6 fills", () => {
    const fills = Array.from({ length: 7 }, () => ({ grid: { sd: "Xxxg" } }));
    const r = parseGroove({ ...BASE, fills });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/6/);
  });

  it("rejects non-whole-beat, over-a-bar, and disagreeing row lengths, naming the fill", () => {
    const notBeat = parseGroove({ ...BASE, fills: [{ grid: { sd: "Xxxgg" } }] });
    expect(notBeat.ok).toBe(false);
    if (!notBeat.ok) expect(notBeat.error).toContain("fill 1");

    const tooLong = parseGroove({ ...BASE, fills: [{ grid: { sd: "X".repeat(20) } }] });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error).toContain("fill 1");

    const disagree = parseGroove({ ...BASE, fills: [{ grid: { sd: "Xxxg", ht: "XxxgXxxg" } }] });
    expect(disagree.ok).toBe(false);
    if (!disagree.ok) expect(disagree.error).toContain("fill 1");
  });

  it("rejects out-of-range fillChance", () => {
    for (const bad of [0.01, 1.5]) {
      const r = parseGroove({ ...BASE, fills: [{ grid: { sd: "Xxxg" } }], fillChance: bad });
      expect(r.ok, `fillChance ${bad}`).toBe(false);
    }
  });

  it("re-parses its own output (idempotent — edit merges depend on this)", () => {
    const g = groove({ ...BASE, fills: [{ grid: { sd: "Xxxg" } }], fillChance: 0.5 });
    const again = parseGroove({ ...g });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.groove).toEqual(g);
  });
});

describe("fill compilation (FR-2/FR-3)", () => {
  it("emits wrandcat with the base weighted for fillChance (1 fill @ 0.25 → weight 3)", () => {
    const code = compileGroove(groove({ ...BASE, fills: [{ grid: { sd: "XxXx" } }] }));
    expect(code).toContain("wrandcat(");
    expect(code).toMatch(/, 3\]/); // base weight n(1-c)/c = 1 * 0.75/0.25
    expect(code).toMatch(/, 1\]/); // the fill variant
  });

  it("weights the base 18 for 6 fills at fillChance 0.25", () => {
    const fills = Array.from({ length: 6 }, () => ({ grid: { sd: "XxXx" } }));
    const code = compileGroove(groove({ ...BASE, fills }));
    expect(code).toMatch(/, 18\]/);
  });

  it("drops ALL base hits inside the window and overlays the fill at the offset (D-47)", () => {
    const code = compileGroove(groove({ ...BASE, fills: [{ grid: { sd: "X-X-" } }] }));
    // variants are the wrandcat entries after the base
    const entries = code.split("wrandcat(")[1];
    const variant = entries.split("],")[1]; // second [pattern, weight] chunk
    // base bd step 14 and hh steps 12/14 are inside the last-4 window → dropped
    const bdMini = variant.match(/s\("(bd[^"]*|[^"]*bd[^"]*)"\)/)?.[1]?.split(" ");
    const hhMini = variant.match(/s\("([^"]*hh[^"]*)"\)/)?.[1]?.split(" ");
    const sdMini = variant.match(/s\("([^"]*sd[^"]*)"\)/)?.[1]?.split(" ");
    expect(bdMini![14]).toBe("~");
    expect(hhMini![12]).toBe("~");
    expect(hhMini![14]).toBe("~");
    expect(sdMini![12]).toBe("sd");
    expect(sdMini![14]).toBe("sd");
    expect(sdMini![13]).toBe("~");
    // outside the window everything survives
    expect(bdMini![0]).toBe("bd");
    expect(hhMini![10]).toBe("hh");
  });

  it("keeps acoustic velocity layers working inside fills", () => {
    const code = compileGroove(
      groove({ ...BASE, bank: "Acoustic", fills: [{ grid: { sd: "X--g" } }] }),
    );
    const variant = code.split("wrandcat(")[1].split("],")[1];
    const sdN = variant.match(/s\("[^"]*sd[^"]*"\)\.n\("([^"]+)"\)/)?.[1]?.split(" ");
    expect(sdN![12]).toBe("7"); // X → slot 7 at window offset 12
    expect(sdN![15]).toBe("2"); // g → slot 2
  });

  it("applies slow(bars) OUTSIDE the wrandcat so the choice is per loop, not per bar", () => {
    const twoBars = {
      ...BASE,
      bars: 2,
      voices: [{ drum: "bd", hits: [{ step: 0, vel: 1 }, { step: 16, vel: 1 }] }],
      fills: [{ grid: { sd: "XxXx" } }],
    };
    const code = compileGroove(groove(twoBars));
    expect(code.trim()).toMatch(/\)\.slow\(2\)$/);
    expect(code.match(/\.slow\(2\)/g)).toHaveLength(1); // never inside a variant
  });

  it("compiles byte-identically to the fill-less groove when disabled or absent (NFR-1)", () => {
    const plain = compileGroove(groove(BASE));
    const disabled = compileGroove(groove({ ...BASE, fills: [{ grid: { sd: "XxXx" } }], fillsEnabled: false }));
    expect(disabled).toBe(plain);
    expect(plain).not.toContain("wrandcat");
  });
});

describe("setFillsEnabled (FR-4 core)", () => {
  it("toggles the flag and revalidates", () => {
    const g = groove({ ...BASE, fills: [{ grid: { sd: "Xxxg" } }] });
    const off = setFillsEnabled(g, false);
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.groove.fillsEnabled).toBe(false);
    const on = setFillsEnabled(off.groove, true);
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.groove.fillsEnabled).toBe(true);
  });

  it("refuses when the groove has no fills", () => {
    const r = setFillsEnabled(groove(BASE), false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("fill");
  });
});

describe("renderGrid fill sections (FR-5)", () => {
  it("renders each fill under a 'fill N (last K steps)' header", () => {
    const g = groove({
      tempoBpm: 100,
      bank: "Acoustic",
      voices: [{ drum: "bd", hits: [{ step: 0, vel: 1 }] }],
      fills: [{ grid: { sd: "XxXx" } }, { grid: { ht: "x-x-x-g-" } }],
    });
    const out = renderGrid(g);
    expect(out).toContain("fill 1 (last 4 steps):");
    expect(out).toContain("sd:  XxXx");
    expect(out).toContain("fill 2 (last 8 steps):");
    expect(out).toContain("ht:  x-x-|x-g-");
  });
});

describe("fills × mute (M-final D-53)", () => {
  it("a muted drum stays silent inside fills; fill-only drums bypass mutes", () => {
    const code = compileGroove(
      groove({
        tempoBpm: 100,
        bank: "RolandTR808",
        voices: [
          { drum: "bd", hits: [{ step: 0, vel: 1 }] },
          { drum: "sd", hits: [{ step: 4, vel: 1 }], muted: true },
        ],
        fills: [{ grid: { sd: "XxXx", ht: "X-X-" } }],
      }),
    );
    const variant = code.split("wrandcat(")[1].split("],")[1];
    expect(variant).not.toContain("sd"); // muted base voice absorbs its fill hits
    expect(variant).toContain("ht"); // fill-only drum plays at unity, unmuted
  });
});
