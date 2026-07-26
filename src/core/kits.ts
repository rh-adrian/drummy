export interface Bank {
  name: string;
  description: string;
}

export interface Drum {
  abbr: string;
  name: string;
}

// Sample banks loaded at page runtime: tidal-drum-machines from Strudel's CDN
// (names must match the bank prefixes in tidal-drum-machines.json, e.g.
// RolandTR808_bd) plus the Acoustic kit indexed by page/acoustic.json (see
// SAMPLES.md). Descriptions are written for the LLM choosing a kit.
export const BANKS: Bank[] = [
  { name: "Acoustic", description: "Real acoustic kit (Salamander) — velocity picks the actual soft/medium/hard recording, real ghost notes, semi-open→open hat. Rock, funk, soul, anything human" },
  { name: "RolandTR808", description: "Boomy, deep analog kick, snappy snare, iconic cowbell — hip-hop, electro, trap, R&B" },
  { name: "RolandTR909", description: "Punchy kick, cracking snare, sizzling open hats — house, techno, club music" },
  { name: "RolandTR707", description: "Crisp 12-bit digital kit, tight and clean — 80s pop, freestyle, early house" },
  { name: "RolandTR606", description: "Thin, buzzy analog kit with hissy hats — minimal, lo-fi electronic" },
  { name: "LinnDrum", description: "Warm punchy sampled kit of the 80s — Prince, funk, synth-pop ballads" },
  { name: "LinnLM1", description: "The original Linn — tight dry funk/pop drums, very early-80s" },
  { name: "AkaiMPC60", description: "Gritty 12-bit sampler crunch — boom-bap hip-hop, neo-soul" },
  { name: "OberheimDMX", description: "Hard-hitting early digital kit — 80s hip-hop, new wave" },
  { name: "EmuSP12", description: "Crunchy lo-fi 12-bit character — golden-era hip-hop" },
  { name: "AlesisHR16", description: "Clean late-80s 16-bit kit — pop, new jack swing" },
];

// Drum voice abbreviations used in Strudel/tidal-drum-machines sample names.
export const DRUMS: Drum[] = [
  { abbr: "bd", name: "kick (bass drum)" },
  { abbr: "sd", name: "snare" },
  { abbr: "hh", name: "closed hi-hat" },
  { abbr: "oh", name: "open hi-hat" },
  { abbr: "rim", name: "rimshot / sidestick" },
  { abbr: "cp", name: "clap" },
  { abbr: "lt", name: "low tom" },
  { abbr: "mt", name: "mid tom" },
  { abbr: "ht", name: "high tom" },
  { abbr: "rd", name: "ride cymbal" },
  { abbr: "cr", name: "crash cymbal" },
  { abbr: "cb", name: "cowbell" },
  { abbr: "ch", name: "china cymbal" },
  { abbr: "sp", name: "splash cymbal" },
];

export const BANK_NAMES = BANKS.map((b) => b.name);
export const DRUM_ABBRS = DRUMS.map((d) => d.abbr);
