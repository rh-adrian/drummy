import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Validates the committed acoustic sample map (page/acoustic.json) against a
// committed listing of the pinned upstream tree — no network in unit tests.
// The map is an index only (URLs into studiorack/salamander-drumkit); audio
// never enters this repo (D-24, NFR-1).

const PINNED_SHA = "8b6faa8847b4c02f4b5dd42c1836c28ffbe89d33";
const VOICES = ["bd", "sd", "rim", "hh", "oh", "lt", "ht", "rd", "cr", "cb", "ch", "sp"];

const map = JSON.parse(readFileSync(new URL("../../page/acoustic.json", import.meta.url), "utf8"));
const upstreamFiles = new Set(
  readFileSync(new URL("../fixtures/salamander-files.txt", import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean),
);

describe("acoustic sample map", () => {
  it("bases all samples on the pinned salamander commit", () => {
    expect(map._base).toContain(PINNED_SHA);
    expect(map._base).toMatch(/^https:\/\/raw\.githubusercontent\.com\/studiorack\/salamander-drumkit\//);
    expect(map._base.endsWith("/Samples/")).toBe(true);
  });

  it("covers exactly the Acoustic voices (no mt, no cp)", () => {
    const keys = Object.keys(map).filter((k) => k !== "_base");
    expect(keys.sort()).toEqual(VOICES.map((v) => `Acoustic_${v}`).sort());
  });

  it("gives every voice exactly 8 slots of existing upstream files", () => {
    for (const voice of VOICES) {
      const slots = map[`Acoustic_${voice}`];
      expect(Array.isArray(slots), voice).toBe(true);
      expect(slots, voice).toHaveLength(8);
      for (const file of slots) {
        expect(file, voice).toMatch(/\.flac$/);
        expect(upstreamFiles.has(file), `${voice}: ${file} not in pinned tree`).toBe(true);
      }
    }
  });

  it("sd's lowest slots are real ghost-note recordings (FR-4)", () => {
    expect(map.Acoustic_sd[0]).toContain("Ghost");
    expect(map.Acoustic_sd[1]).toContain("Ghost");
  });

  it("oh is velocity-split: semi-open ladder low/mid, full open on top (D-26)", () => {
    for (const slot of map.Acoustic_oh.slice(0, 6)) expect(slot).toContain("hihatSemiOpen");
    for (const slot of map.Acoustic_oh.slice(6)) expect(slot).toMatch(/^hihatOpen/);
  });

  it("no slot repeats a file within a voice (round-robin takes stay distinct)", () => {
    for (const voice of VOICES) {
      const slots = map[`Acoustic_${voice}`];
      expect(new Set(slots).size, voice).toBe(slots.length);
    }
  });
});
