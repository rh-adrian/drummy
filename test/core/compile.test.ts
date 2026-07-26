import { describe, it, expect } from "vitest";
import { parseGroove, type Groove } from "../../src/core/groove.js";
import { compileGroove } from "../../src/core/compile.js";

function groove(input: unknown): Groove {
  const result = parseGroove(input);
  if (!result.ok) throw new Error(`test groove invalid: ${result.error}`);
  return result.groove;
}

const fourOnFloor = {
  tempoBpm: 120,
  bank: "RolandTR909",
  voices: [{ drum: "bd", hits: [{ step: 0 }, { step: 4 }, { step: 8 }, { step: 12 }] }],
};

describe("compileGroove", () => {
  it("emits tempo as setcpm(bpm/4)", () => {
    const code = compileGroove(groove(fourOnFloor));
    expect(code).toContain("setcpm(120/4)");
  });

  it("emits the bank on the stack", () => {
    const code = compileGroove(groove(fourOnFloor));
    expect(code).toContain('.bank("RolandTR909")');
  });

  it("places kick hits on quarters in a 16-step grid", () => {
    const code = compileGroove(groove(fourOnFloor));
    // one s("...") voice line with bd at steps 0,4,8,12 and rests elsewhere
    const mini = code.match(/s\("([^"]+)"\)/)?.[1];
    expect(mini).toBeDefined();
    const steps = mini!.split(" ");
    expect(steps).toHaveLength(16);
    expect(steps[0]).toBe("bd");
    expect(steps[4]).toBe("bd");
    expect(steps[8]).toBe("bd");
    expect(steps[12]).toBe("bd");
    expect(steps[1]).toBe("~");
  });

  it("maps velocity to an aligned gain pattern, ghost quieter than accent", () => {
    const code = compileGroove(
      groove({
        tempoBpm: 100,
        bank: "RolandTR808",
        voices: [{ drum: "sd", hits: [{ step: 4, vel: 0.95 }, { step: 9, vel: 0.25 }] }],
      }),
    );
    const gain = code.match(/\.gain\("([^"]+)"\)/)?.[1];
    expect(gain).toBeDefined();
    const values = gain!.split(" ");
    expect(values).toHaveLength(16);
    expect(Number(values[4])).toBeCloseTo(0.95);
    expect(Number(values[9])).toBeCloseTo(0.25);
    expect(Number(values[4])).toBeGreaterThan(Number(values[9]));
    expect(values[0]).toBe("~");
  });

  it("applies swing as late() on off-16th hits only", () => {
    const code = compileGroove(
      groove({
        tempoBpm: 100,
        swing: 0.2,
        bank: "RolandTR808",
        voices: [{ drum: "hh", hits: [{ step: 0 }, { step: 1 }, { step: 2 }, { step: 3 }] }],
      }),
    );
    // even-step hits and odd-step (swung) hits split into separate stack entries
    const lates = [...code.matchAll(/\.late\(([\d./]+)\)/g)].map((m) => m[1]);
    expect(lates.length).toBeGreaterThan(0);
    // swing of 0.2 steps at resolution 16 = 0.2/16 cycles = 0.0125
    expect(lates.some((l) => Math.abs(eval(l) - 0.2 / 16) < 1e-9)).toBe(true);
    // odd steps carry the swing delay, even steps do not
    const swungVoice = code.split("\n").find((l) => l.includes(".late("));
    const straightVoice = code.split("\n").find((l) => l.includes('s("') && !l.includes(".late("));
    expect(swungVoice).toBeDefined();
    expect(straightVoice).toBeDefined();
    const swungSteps = swungVoice!.match(/s\("([^"]+)"\)/)![1].split(" ");
    const straightSteps = straightVoice!.match(/s\("([^"]+)"\)/)![1].split(" ");
    expect(swungSteps[1]).toBe("hh");
    expect(swungSteps[3]).toBe("hh");
    expect(swungSteps[0]).toBe("~");
    expect(swungSteps[2]).toBe("~");
    expect(straightSteps[0]).toBe("hh");
    expect(straightSteps[2]).toBe("hh");
    expect(straightSteps[1]).toBe("~");
    expect(straightSteps[3]).toBe("~");
  });

  it("emits multi-bar delays as d/(bars*resolution) so slow() stretching lands d real steps", () => {
    const code = compileGroove(
      groove({
        tempoBpm: 100,
        swing: 0.2,
        bank: "RolandTR808",
        bars: 2,
        voices: [{ drum: "hh", hits: [{ step: 1 }, { step: 17 }] }],
      }),
    );
    expect(code).toContain(".slow(2)");
    expect(code).toContain(".late(0.2/32)");
    expect(code).not.toContain("/16)");
  });

  it("applies per-hit micro offsets as late()/early()", () => {
    const code = compileGroove(
      groove({
        tempoBpm: 100,
        bank: "RolandTR808",
        voices: [{ drum: "sd", hits: [{ step: 4 }, { step: 12, micro: -0.1 }] }],
      }),
    );
    // micro -0.1 steps at res 16 → early(0.1/16) or late(-...): we emit .early(0.1/16)
    expect(code).toMatch(/\.early\(0\.1\/16\)|\.late\(-0\.1\/16\)/);
  });

  it("combines swing and micro additively on the same hit", () => {
    const code = compileGroove(
      groove({
        tempoBpm: 100,
        swing: 0.2,
        bank: "RolandTR808",
        voices: [{ drum: "hh", hits: [{ step: 1, micro: 0.1 }] }],
      }),
    );
    // total delay = (0.2 + 0.1)/16 cycles
    const lates = [...code.matchAll(/\.late\(([^)]+)\)/g)].map((m) => eval(m[1]));
    expect(lates.some((v) => Math.abs(v - 0.3 / 16) < 1e-9)).toBe(true);
  });

  it("spans multi-bar grooves with slow(bars) so one cycle stays one bar", () => {
    const code = compileGroove(
      groove({
        tempoBpm: 100,
        bank: "RolandTR808",
        bars: 2,
        voices: [{ drum: "bd", hits: [{ step: 0 }, { step: 16 }] }],
      }),
    );
    expect(code).toContain(".slow(2)");
    const mini = code.match(/s\("([^"]+)"\)/)?.[1];
    expect(mini!.split(" ")).toHaveLength(32);
  });

  it("omits slow() for single-bar grooves", () => {
    const code = compileGroove(groove(fourOnFloor));
    expect(code).not.toContain(".slow(");
  });

  it("handles triplet resolution (12 steps per bar)", () => {
    const code = compileGroove(
      groove({
        tempoBpm: 100,
        bank: "RolandTR808",
        resolution: 12,
        voices: [{ drum: "hh", hits: [{ step: 0 }, { step: 3 }, { step: 6 }, { step: 9 }] }],
      }),
    );
    const mini = code.match(/s\("([^"]+)"\)/)?.[1];
    expect(mini!.split(" ")).toHaveLength(12);
  });

  it("stacks multiple voices", () => {
    const code = compileGroove(
      groove({
        tempoBpm: 100,
        bank: "RolandTR808",
        voices: [
          { drum: "bd", hits: [{ step: 0 }] },
          { drum: "sd", hits: [{ step: 4 }] },
          { drum: "hh", hits: [{ step: 0 }, { step: 2 }] },
        ],
      }),
    );
    expect(code).toContain("stack(");
    expect((code.match(/s\("/g) ?? []).length).toBe(3);
  });

  it("is deterministic: same groove, same output", () => {
    const g = {
      tempoBpm: 97,
      swing: 0.15,
      bank: "LinnDrum",
      voices: [
        { drum: "bd", hits: [{ step: 0 }, { step: 10, vel: 0.7 }] },
        { drum: "hh", hits: [{ step: 1, micro: 0.2 }, { step: 3 }] },
      ],
    };
    expect(compileGroove(groove(g))).toBe(compileGroove(groove(g)));
  });

  it("emits a playable top-level pattern statement ($:)", () => {
    const code = compileGroove(groove(fourOnFloor));
    expect(code).toMatch(/\$:\s*stack\(/);
  });
});

describe("compileGroove — Acoustic velocity layers (v1.3)", () => {
  const acoustic = (vel: number) =>
    groove({
      tempoBpm: 100,
      bank: "Acoustic",
      voices: [{ drum: "sd", hits: [{ step: 4, vel }] }],
    });

  it("emits an aligned n() grid picking the slot from velocity: min(7, floor(vel*8))", () => {
    const cases: Array<[number, number]> = [
      [0.1, 0],
      [0.25, 2],
      [0.5, 4],
      [0.8, 6],
      [0.95, 7],
      [1, 7],
    ];
    for (const [vel, slot] of cases) {
      const code = compileGroove(acoustic(vel));
      const n = code.match(/\.n\("([^"]+)"\)/)?.[1];
      expect(n, `vel ${vel}`).toBeDefined();
      const values = n!.split(" ");
      expect(values).toHaveLength(16);
      expect(values[4], `vel ${vel}`).toBe(String(slot));
      expect(values[0]).toBe("~");
    }
  });

  it("keeps gain = vel: the source files are peak-normalized, so gain restores the dynamics (D-29)", () => {
    const at = (vel: number) => {
      const code = compileGroove(acoustic(vel));
      return Number(code.match(/\.gain\("([^"]+)"\)/)![1].split(" ")[4]);
    };
    expect(at(1)).toBeCloseTo(1);
    expect(at(0.25)).toBeCloseTo(0.25);
    expect(at(0.7)).toBeCloseTo(0.7);
  });

  it("keeps machine-bank output free of n() and byte-identical gain", () => {
    const machine = {
      tempoBpm: 100,
      bank: "LinnDrum",
      voices: [{ drum: "sd", hits: [{ step: 4, vel: 0.25 }, { step: 12, vel: 0.95 }] }],
    };
    const code = compileGroove(groove(machine));
    expect(code).not.toContain(".n(");
    const gain = code.match(/\.gain\("([^"]+)"\)/)![1].split(" ");
    expect(gain[4]).toBe("0.25");
    expect(gain[12]).toBe("0.95");
  });

  it("pins the exact machine-bank output format (byte-identical guarantee, M-final NIT)", () => {
    expect(compileGroove(groove(fourOnFloor))).toBe(
      'setcpm(120/4)\n$: stack(\n  s("bd ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~").gain("1 ~ ~ ~ 1 ~ ~ ~ 1 ~ ~ ~ 1 ~ ~ ~")\n).bank("RolandTR909")',
    );
  });

  it("n grid respects multi-bar grids and multiple voices", () => {
    const code = compileGroove(
      groove({
        tempoBpm: 100,
        bank: "Acoustic",
        bars: 2,
        voices: [
          { drum: "bd", hits: [{ step: 0, vel: 1 }, { step: 16, vel: 0.4 }] },
          { drum: "hh", hits: [{ step: 2, vel: 0.6 }] },
        ],
      }),
    );
    const ns = [...code.matchAll(/\.n\("([^"]+)"\)/g)].map((m) => m[1].split(" "));
    expect(ns).toHaveLength(2);
    for (const n of ns) expect(n).toHaveLength(32);
    expect(ns[0][0]).toBe("7");
    expect(ns[0][16]).toBe("3");
    expect(ns[1][2]).toBe("4");
  });
});

describe("compileGroove — trackGain (v1.5)", () => {
  it("multiplies gain by trackGain, leaving velocity untouched", () => {
    const code = compileGroove(
      groove({
        tempoBpm: 100,
        bank: "RolandTR808",
        voices: [{ drum: "hh", hits: [{ step: 0, vel: 0.7 }, { step: 2, vel: 1 }], trackGain: 0.5 }],
      }),
    );
    const gain = code.match(/\.gain\("([^"]+)"\)/)![1].split(" ");
    expect(gain[0]).toBe("0.35");
    expect(gain[2]).toBe("0.5");
  });

  it("keeps Acoustic n() slots a function of velocity only (D-35)", () => {
    const code = compileGroove(
      groove({
        tempoBpm: 100,
        bank: "Acoustic",
        voices: [{ drum: "sd", hits: [{ step: 4, vel: 0.95 }], trackGain: 0.3 }],
      }),
    );
    const n = code.match(/\.n\("([^"]+)"\)/)![1].split(" ");
    const gain = code.match(/\.gain\("([^"]+)"\)/)![1].split(" ");
    expect(n[4]).toBe("7"); // still the hard-hit recording
    expect(Number(gain[4])).toBeCloseTo(0.285); // played quietly
  });
});
