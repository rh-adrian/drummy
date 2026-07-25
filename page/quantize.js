// Pure helper shared between the browser page and vitest (plain JS, no build step).
//
// Strudel's evaluate() swaps the pattern at the next ~50ms scheduler tick, which
// lands mid-bar. To make groove changes musical (D-10) the page delays the swap
// until the next cycle boundary: one Strudel cycle = one bar (D-11).

// Within this many ms of the boundary, swap immediately: a timeout that short
// would fire just AFTER the boundary and push the swap a full bar late.
const SNAP_MS = 10;

/**
 * Milliseconds until the next cycle (= bar) boundary.
 * @param {number} cyclePos current cycle position from the scheduler (e.g. 3.75)
 * @param {number} cps cycles per second
 * @returns {number} delay in ms; 0 means "swap now"
 */
export function msUntilNextCycle(cyclePos, cps) {
  if (!Number.isFinite(cyclePos) || !Number.isFinite(cps) || cps <= 0) return 0;
  const frac = cyclePos - Math.floor(cyclePos);
  if (frac === 0) return 0;
  const ms = ((1 - frac) / cps) * 1000;
  return ms < SNAP_MS ? 0 : ms;
}
