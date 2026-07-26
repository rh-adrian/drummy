import { describe, it, expect } from "vitest";
import { BANKS, DRUMS } from "../../src/core/kits.js";

describe("kits", () => {
  it("includes the core tidal-drum-machines banks", () => {
    const names = BANKS.map((b) => b.name);
    for (const expected of ["RolandTR808", "RolandTR909", "RolandTR707", "LinnDrum", "AkaiMPC60", "OberheimDMX", "EmuSP12"]) {
      expect(names).toContain(expected);
    }
  });

  it("every bank has a human description for the LLM", () => {
    for (const bank of BANKS) {
      expect(bank.description.length).toBeGreaterThan(10);
    }
  });

  it("defines the standard drum voice abbreviations with names", () => {
    const abbrs = DRUMS.map((d) => d.abbr);
    for (const expected of ["bd", "sd", "hh", "oh", "rim", "cp", "lt", "mt", "ht", "rd", "cr"]) {
      expect(abbrs).toContain(expected);
    }
    for (const drum of DRUMS) {
      expect(drum.name.length).toBeGreaterThan(2);
    }
  });

  it("includes the Acoustic bank (v1.3)", () => {
    expect(BANKS.map((b) => b.name)).toContain("Acoustic");
  });

  it("includes the v1.3 voices cowbell, china, splash", () => {
    const abbrs = DRUMS.map((d) => d.abbr);
    for (const expected of ["cb", "ch", "sp"]) {
      expect(abbrs).toContain(expected);
    }
  });
});
