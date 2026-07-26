// Generates page/acoustic.json — the Acoustic bank's sample map — from the
// pinned studiorack/salamander-drumkit tree (see SAMPLES.md for source and
// license). The map is an index only; no audio is downloaded or committed.
//
// Every voice gets exactly 8 slots ordered soft→loud (compile.ts picks the
// slot from velocity: min(7, floor(vel*8))). Within a dynamic layer the slots
// use different round-robin takes, so neighbouring velocities also vary the
// take. Re-run with: npx tsx scripts/build-acoustic-map.ts
//
// Curation notes:
// - sd slots 0-2 are the real ghost-note recordings (FR-4): the schema teaches
//   ghosts as vel 0.2-0.4, and slot = floor(vel*8), so ghosts must cover
//   vel < 0.375 (M-final review finding).
// - oh ramps the semi-open ladder into fully open at the top (D-26).
// - rim (stick) and ch (china) exist at one recorded dynamic; their 8 slots
//   are distinct takes and .gain() carries the dynamics.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = "studiorack/salamander-drumkit";
const PINNED_SHA = "8b6faa8847b4c02f4b5dd42c1836c28ffbe89d33";

const SLOTS: Record<string, string[]> = {
  bd: ["kick_OH_P_1", "kick_OH_P_2", "kick_OH_F_1", "kick_OH_F_2", "kick_OH_F_3", "kick_OH_FF_1", "kick_OH_FF_2", "kick_OH_FF_3"],
  sd: ["snare_OH_Ghost_1", "snare_OH_Ghost_2", "snare_OH_Ghost_3", "snare_OH_MP_1", "snare_OH_F_1", "snare_OH_F_2", "snare_OH_FF_1", "snare_OH_FF_2"],
  rim: ["snareStick_OH_F_1", "snareStick_OH_F_2", "snareStick_OH_F_3", "snareStick_OH_F_4", "snareStick_OH_F_5", "snareStick_OH_F_6", "snareStick_OH_F_7", "snareStick_OH_F_8"],
  hh: ["hihatClosed_OH_P_1", "hihatClosed_OH_P_2", "hihatClosed_OH_P_3", "hihatClosed_OH_P_4", "hihatClosed_OH_F_1", "hihatClosed_OH_F_2", "hihatClosed_OH_F_3", "hihatClosed_OH_F_4"],
  oh: ["hihatSemiOpen1_OH_P_1", "hihatSemiOpen2_OH_P_1", "hihatSemiOpen3_OH_F_1", "hihatSemiOpen4_OH_F_1", "hihatSemiOpen5_OH_F_1", "hihatSemiOpen6_OH_F_1", "hihatOpen_OH_F_1", "hihatOpen_OH_FF_1"],
  lt: ["loTom_OH_PP_1", "loTom_OH_PP_2", "loTom_OH_MP_1", "loTom_OH_MP_2", "loTom_OH_MP_3", "loTom_OH_FF_1", "loTom_OH_FF_2", "loTom_OH_FF_3"],
  ht: ["hiTom_OH_P_1", "hiTom_OH_P_2", "hiTom_OH_F_1", "hiTom_OH_F_2", "hiTom_OH_F_3", "hiTom_OH_FF_1", "hiTom_OH_FF_2", "hiTom_OH_FF_3"],
  rd: ["ride2_OH_PP_1", "ride2_OH_PP_2", "ride2_OH_MP_1", "ride2_OH_MP_2", "ride2_OH_MP_3", "ride2_OH_FF_1", "ride2_OH_FF_2", "ride2_OH_FF_3"],
  cr: ["crash1_OH_P_1", "crash1_OH_P_2", "crash1_OH_P_3", "crash1_OH_P_4", "crash1_OH_FF_1", "crash1_OH_FF_2", "crash1_OH_FF_3", "crash1_OH_FF_4"],
  cb: ["cowbell_P_1", "cowbell_P_2", "cowbell_MP_1", "cowbell_MP_2", "cowbell_MP_3", "cowbell_FF_1", "cowbell_FF_2", "cowbell_FF_3"],
  ch: ["china1_OH_FF_1", "china1_OH_FF_2", "china1_OH_FF_3", "china1_OH_FF_4", "china1_OH_FF_5", "china1_OH_FF_6", "china1_OH_FF_7", "china1_OH_FF_8"],
  sp: ["splash1_OH_P_1", "splash1_OH_P_2", "splash1_OH_P_3", "splash1_OH_P_4", "splash1_OH_F_1", "splash1_OH_F_2", "splash1_OH_F_3", "splash1_OH_F_4"],
};

async function main() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${PINNED_SHA}?recursive=1`);
  if (!res.ok) throw new Error(`GitHub tree fetch failed: ${res.status}`);
  const tree = (await res.json()) as { truncated: boolean; tree: Array<{ path: string }> };
  if (tree.truncated) throw new Error("tree listing truncated — cannot validate");
  const upstream = new Set(tree.tree.map((e) => e.path));

  const map: Record<string, string | string[]> = {
    _base: `https://raw.githubusercontent.com/${REPO}/${PINNED_SHA}/Samples/`,
  };
  for (const [voice, slots] of Object.entries(SLOTS)) {
    if (slots.length !== 8) throw new Error(`${voice}: expected 8 slots, got ${slots.length}`);
    const files = slots.map((s) => `${s}.flac`);
    for (const f of files) {
      if (!upstream.has(`Samples/${f}`)) throw new Error(`${voice}: Samples/${f} not in pinned tree`);
    }
    map[`Acoustic_${voice}`] = files;
  }

  const out = fileURLToPath(new URL("../page/acoustic.json", import.meta.url));
  writeFileSync(out, JSON.stringify(map, null, 2) + "\n");
  console.log(`wrote ${out}: ${Object.keys(SLOTS).length} voices, 8 slots each, pinned to ${PINNED_SHA.slice(0, 7)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
