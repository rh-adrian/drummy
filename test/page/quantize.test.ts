import { describe, it, expect } from "vitest";
// Plain-JS module shared verbatim with the browser page (no build step for page/).
import { msUntilNextCycle } from "../../page/quantize.js";

describe("msUntilNextCycle", () => {
  it("returns 0 exactly on a cycle boundary", () => {
    expect(msUntilNextCycle(4.0, 0.5)).toBe(0);
    expect(msUntilNextCycle(0, 0.5)).toBe(0);
  });

  it("computes the remaining fraction of the cycle in ms", () => {
    // cps 0.5 → one cycle = 2000 ms; halfway through → 1000 ms remain
    expect(msUntilNextCycle(3.5, 0.5)).toBeCloseTo(1000);
    // 120 BPM in 4/4 → cps = 0.5; three-quarters through → 500 ms remain
    expect(msUntilNextCycle(7.75, 0.5)).toBeCloseTo(500);
  });

  it("scales with cps", () => {
    // cps 2 → one cycle = 500 ms; half remaining → 250 ms
    expect(msUntilNextCycle(1.5, 2)).toBeCloseTo(250);
  });

  it("treats a position a hair before the boundary as boundary (avoids ~0ms double-swap)", () => {
    // within 10ms of the boundary → snap to 0 so we don't schedule an
    // unreachable timeout that lands just after the swap tick
    expect(msUntilNextCycle(3.9999, 0.5)).toBe(0);
  });

  it("is defensive about junk input", () => {
    expect(msUntilNextCycle(NaN, 0.5)).toBe(0);
    expect(msUntilNextCycle(1.5, 0)).toBe(0);
    expect(msUntilNextCycle(1.5, NaN)).toBe(0);
  });
});
