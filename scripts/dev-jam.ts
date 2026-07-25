// Manual dev loop for M2 (no MCP yet): starts the sidecar, pushes a hardcoded
// groove, and leaves the server up. Open the printed URL, click Start, listen.
//
//   npm run dev:jam
import { parseGroove } from "../src/core/groove.js";
import { compileGroove } from "../src/core/compile.js";
import { startSidecar, resolvePort } from "../src/server/sidecar.js";

// A LinnDrum pocket groove: kick anchors, backbeat snare with a ghost,
// swung 16th hats with accents on the 8ths.
const groove = {
  tempoBpm: 96,
  swing: 0.18,
  bank: "LinnDrum",
  voices: [
    { drum: "bd", hits: [{ step: 0 }, { step: 7, vel: 0.8 }, { step: 10 }] },
    {
      drum: "sd",
      hits: [{ step: 4 }, { step: 9, vel: 0.2 }, { step: 12 }],
    },
    {
      drum: "hh",
      hits: Array.from({ length: 16 }, (_, i) => ({
        step: i,
        vel: i % 4 === 0 ? 0.9 : i % 2 === 0 ? 0.65 : 0.45,
      })),
    },
  ],
};

const parsed = parseGroove(groove);
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}
const code = compileGroove(parsed.groove);

const sidecar = await startSidecar({ port: resolvePort() });
sidecar.push({ type: "evaluate", code });

console.error(`ai-drummer dev jam
  open ${sidecar.url} and click Start
  pushing:\n\n${code}\n
Ctrl-C to stop.`);

process.on("SIGINT", async () => {
  await sidecar.close();
  process.exit(0);
});
