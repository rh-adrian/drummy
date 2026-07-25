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
    // hits on even steps must not carry the swing delay
    const swungVoice = code.split("\n").find((l) => l.includes(".late("));
    const straightVoice = code.split("\n").find((l) => l.includes('s("') && !l.includes(".late("));
    expect(swungVoice).toBeDefined();
    expect(straightVoice).toBeDefined();
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
