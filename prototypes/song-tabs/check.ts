// PROTOTYPE (issue #7) — throwaway. Stands in for save_song's validation: checks
// every section of a song file with the real parseGroove and prints the grid the
// AI would get back, or the error it would have to fix.
//
//   npx tsx prototypes/song-tabs/check.ts <song.json>
//
// Song file shape (a draft of save_song's input):
//   { "artist", "title", "tabUrl", "sections": { "main": <groove>, "<name>": <groove>, ... },
//     "notes": "what in the tab did not fit, and what you did about it" }
import { readFileSync } from "node:fs";
import { parseGroove } from "../../src/core/groove.js";
import { renderGrid } from "../../src/core/grid.js";

const file = process.argv[2];
const song = JSON.parse(readFileSync(file, "utf8"));
let bad = 0;
if (!song.sections?.main) {
  console.log("ERROR: sections.main is required (the groove the song is known for)");
  bad++;
}
for (const [name, groove] of Object.entries(song.sections ?? {})) {
  const parsed = parseGroove(groove);
  if (parsed.ok) console.log(`[${name}] OK\n${renderGrid(parsed.groove)}\n`);
  else {
    console.log(`[${name}] ERROR: ${parsed.error}\n`);
    bad++;
  }
}
console.log(bad ? `${bad} problem(s) — fix and re-run` : "ALL SECTIONS VALID");
process.exit(bad ? 1 : 0);
