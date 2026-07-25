// D-13 audio-verification harness: drives the real page in headless Chrome,
// records the WebAudio output as PCM, writes a WAV, and asserts the audio
// actually contains the groove — onsets on the grid, correct tempo, ghosts
// quieter than accents, measured swing, bar-boundary swap, silence after hush.
//
//   npm run capture            # run all checks, write captures/session.wav
//
// Requires: npx playwright install chromium; internet (Strudel + samples CDN).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { parseGroove, type Groove } from "../src/core/groove.js";
import { compileGroove } from "../src/core/compile.js";
import { startSidecar } from "../src/server/sidecar.js";
import {
  detectOnsets,
  rmsAround,
  matchOnsetsToGrid,
  medianInterval,
  encodeWavPcm16,
} from "../src/capture/analysis.js";

const PORT = 4790;
const CAPTURE_DIR = "captures";
// Deliberately NOT 120: the page's cps-introspection fallback is 0.5 cps
// (120 BPM), so a 120 BPM run can't tell real introspection from the fallback.
const BPM = 96;
const STEP_MS = (60_000 / BPM) * (4 / 16); // 156.25 ms per 16th at 96 BPM
const BAR_MS = STEP_MS * 16; // 2500 ms
const SWING = 0.3; // fraction of a step (D-14) → 46.9 ms late on odd steps

function compile(g: unknown): string {
  const parsed = parseGroove(g);
  if (!parsed.ok) throw new Error(`harness groove invalid: ${parsed.error}`);
  return compileGroove(parsed.groove);
}

// Groove A — anchor/tempo/dynamics: clap stacked on the kick's step 0 marks the
// bar start (loudest onset); quarter kicks carry tempo; snare accent vs ghost.
const grooveA = compile({
  tempoBpm: BPM,
  bank: "RolandTR909",
  voices: [
    { drum: "bd", hits: [{ step: 0 }, { step: 4 }, { step: 8 }, { step: 12 }] },
    { drum: "cp", hits: [{ step: 0 }] },
    { drum: "sd", hits: [{ step: 2, vel: 1.0 }, { step: 10, vel: 0.25 }] },
  ],
});

// Groove B — swing: hats on all 16 steps, odd steps delayed by SWING.
const grooveB = compile({
  tempoBpm: BPM,
  swing: SWING,
  bank: "RolandTR909",
  voices: [
    { drum: "hh", hits: Array.from({ length: 16 }, (_, i) => ({ step: i })) },
  ],
});

// Silent warm-up: starts the scheduler clock and triggers sample decode for
// every drum the session uses, so groove A's first hits land on time.
// (Bank prefix required — bare names aren't registered by the drum-machines map.)
const warmup = `setcpm(${BPM}/4)\n$: s("bd sd cp hh").bank("RolandTR909").gain(0)`;

// Tee everything routed to the audio destination into a ScriptProcessor that
// accumulates mono PCM while window.__recording is set.
const CAPTURE_HOOK = `(() => {
  window.__pcmChunks = [];
  window.__capSampleRate = 0;
  window.__recording = false;
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    try {
      if (target instanceof AudioDestinationNode) {
        const ctx = this.context;
        if (!ctx.__cap) {
          const cap = ctx.createGain();
          const proc = ctx.createScriptProcessor(4096, 1, 1);
          const mute = ctx.createGain();
          mute.gain.value = 0;
          cap.connect(proc);
          proc.connect(mute);
          origConnect.call(mute, target);
          proc.onaudioprocess = (e) => {
            if (window.__recording) {
              window.__pcmChunks.push(Array.from(e.inputBuffer.getChannelData(0)));
            }
          };
          ctx.__cap = cap;
          window.__capSampleRate = ctx.sampleRate;
        }
        origConnect.call(this, ctx.__cap);
      }
    } catch (err) {
      console.warn("capture hook error", err);
    }
    return origConnect.call(this, target, ...rest);
  };
})();`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.error(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function main() {
  console.error("starting sidecar + headless chrome…");
  const sidecar = await startSidecar({ port: PORT });
  const browser = await chromium.launch({
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.error("  [page]", m.text());
  });
  page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
  await page.addInitScript(CAPTURE_HOOK);
  await page.goto(sidecar.url);
  await page.click("#arm");

  // Let prebake finish, then decode this session's samples silently.
  await sleep(1500);
  sidecar.push({ type: "evaluate", code: warmup });
  await sleep(2600);

  console.error("recording session…");
  await page.evaluate("window.__recording = true");
  sidecar.push({ type: "evaluate", code: grooveA }); // applies at next bar
  await sleep(3.2 * BAR_MS); // ~3 bars of A
  sidecar.push({ type: "evaluate", code: grooveB }); // mid-bar push → quantized
  await sleep(2.1 * BAR_MS); // ~2 bars of B
  sidecar.push({ type: "hush" });
  await sleep(1500);
  await page.evaluate("window.__recording = false");

  const sampleRate = (await page.evaluate("window.__capSampleRate")) as number;
  const chunks = (await page.evaluate("window.__pcmChunks")) as number[][];
  await browser.close();
  await sidecar.close();

  const pcm = new Float32Array(chunks.flat());
  console.error(
    `captured ${(pcm.length / sampleRate).toFixed(1)}s at ${sampleRate} Hz`,
  );
  await mkdir(CAPTURE_DIR, { recursive: true });
  const wavPath = path.join(CAPTURE_DIR, "session.wav");
  await writeFile(wavPath, encodeWavPcm16(pcm, sampleRate));
  console.error(`wrote ${wavPath}`);

  analyze(pcm, sampleRate);

  const failed = checks.filter((c) => !c.pass);
  console.error(
    failed.length === 0
      ? `\nall ${checks.length} audio checks passed`
      : `\n${failed.length}/${checks.length} audio checks FAILED`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

function analyze(pcm: Float32Array, sampleRate: number) {
  console.error("\nanalyzing…");
  const onsets = detectOnsets(pcm, sampleRate).map((t) => t * 1000); // → ms
  check("onsets detected", onsets.length > 20, `${onsets.length} onsets`);
  if (onsets.length <= 20) return;

  // --- segment the session: A = sparse (min gap 2 steps), B = dense 16th hats
  // (max gap = a swung long step, (1+SWING)·step). Split at the midpoint.
  const denseMs = (STEP_MS * (1 + SWING) + STEP_MS * 2) / 2; // 1.65 · step at SWING 0.3
  let swapIdx = -1;
  for (let i = 0; i < onsets.length - 3; i++) {
    const next = [1, 2, 3].map((k) => onsets[i + k] - onsets[i + k - 1]);
    if (next.every((d) => d < denseMs)) {
      swapIdx = i;
      break;
    }
  }
  check("groove swap found", swapIdx > 0, `hat run starts at onset #${swapIdx}`);
  if (swapIdx <= 0) return;
  const aOnsets = onsets.slice(0, swapIdx);
  const bOnsets = onsets.slice(swapIdx);

  // --- bar anchor: loudest onset in groove A's first bar = clap+kick on step 0.
  const firstBar = aOnsets.filter((t) => t < aOnsets[0] + BAR_MS);
  const t0 = firstBar.reduce((best, t) =>
    rmsAround(pcm, sampleRate, t / 1000) > rmsAround(pcm, sampleRate, best / 1000) ? t : best,
  );

  // --- groove A: every hit on its grid slot, across all full bars before the swap.
  // (round, not floor: the swap fires up to SWAP_LEAD_MS before the bar line)
  const aBars = Math.round((onsets[swapIdx] - t0) / BAR_MS);
  const gridA: number[] = [];
  for (let bar = 0; bar < aBars; bar++) {
    for (const step of [0, 2, 4, 8, 10, 12]) {
      gridA.push(t0 + bar * BAR_MS + step * STEP_MS);
    }
  }
  const matchA = matchOnsetsToGrid(aOnsets, gridA, 30); // all in ms
  check(
    "groove A onsets on grid",
    matchA.missed.length === 0 && matchA.extra.length === 0,
    `${matchA.matched.length} matched, ${matchA.missed.length} missed, ${matchA.extra.length} extra, mean err ${matchA.meanAbsErr.toFixed(1)}ms`,
  );
  check("grid timing tight", matchA.meanAbsErr < 15, `${matchA.meanAbsErr.toFixed(1)}ms mean abs error`);

  // --- tempo from kick quarters (steps 0,4,8,12 → 500 ms apart).
  const kicks = gridA
    .filter((_, i) => [0, 2, 3, 5].includes(i % 6)) // steps 0,4,8,12 of each bar
    .map((g) => matchA.matched.find((m) => m.grid === g)?.onset)
    .filter((o): o is number => o !== undefined);
  const ioi = medianInterval(kicks.map((k) => k / 1000)) * 1000;
  const measuredBpm = 60_000 / ioi;
  check(
    "tempo correct",
    Math.abs(measuredBpm - BPM) < 2,
    `median kick interval ${ioi.toFixed(1)}ms → ${measuredBpm.toFixed(1)} BPM (want ${BPM})`,
  );

  // --- dynamics: snare accent (step 2, vel 1.0) vs ghost (step 10, vel 0.25).
  const accentRms = rmsAround(pcm, sampleRate, (t0 + 2 * STEP_MS) / 1000);
  const ghostRms = rmsAround(pcm, sampleRate, (t0 + 10 * STEP_MS) / 1000);
  check(
    "ghost quieter than accent",
    accentRms > ghostRms * 1.5,
    `accent RMS ${accentRms.toFixed(4)} vs ghost ${ghostRms.toFixed(4)} (${(accentRms / ghostRms).toFixed(1)}x)`,
  );

  // --- bar-boundary swap: the incoming groove's downbeat must land on a bar
  // line of A's grid (the early swap may add a couple of tail-step hats just
  // before the line — that's by design, see SWAP_LEAD_MS in page/main.js).
  const distToBar = bOnsets.slice(0, 6).map((t) => {
    const off = (t - t0) % BAR_MS;
    return Math.min(off, BAR_MS - off);
  });
  const downbeat = Math.min(...distToBar);
  check(
    "swap downbeat on bar boundary",
    downbeat < 30,
    `closest early hat ${downbeat.toFixed(1)}ms from bar line (first 6: ${distToBar.map((d) => d.toFixed(0)).join(",")})`,
  );

  // --- swing: 16th hats with swing 0.3 → IOIs alternate 203.1 / 109.4 ms.
  const bIoi = bOnsets.slice(1).map((t, i) => t - bOnsets[i]);
  const evenIoi = bIoi.filter((_, i) => i % 2 === 0);
  const oddIoi = bIoi.filter((_, i) => i % 2 === 1);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const longIoi = Math.max(median(evenIoi), median(oddIoi));
  const shortIoi = Math.min(median(evenIoi), median(oddIoi));
  const expectedLong = STEP_MS * (1 + SWING);
  const expectedShort = STEP_MS * (1 - SWING);
  check(
    "swing measured",
    Math.abs(longIoi - expectedLong) < 12 && Math.abs(shortIoi - expectedShort) < 12,
    `IOIs ${shortIoi.toFixed(1)}/${longIoi.toFixed(1)}ms (want ${expectedShort.toFixed(1)}/${expectedLong.toFixed(1)})`,
  );

  // --- hush: no onsets in, and near-silence over, the final second.
  const endMs = (pcm.length / sampleRate) * 1000;
  const tailOnsets = onsets.filter((t) => t > endMs - 1000);
  let tailSum = 0;
  const tailStart = Math.max(0, pcm.length - sampleRate);
  for (let i = tailStart; i < pcm.length; i++) tailSum += pcm[i] * pcm[i];
  const tailRms = Math.sqrt(tailSum / (pcm.length - tailStart));
  check(
    "silence after hush",
    tailOnsets.length === 0 && tailRms < 0.005,
    `${tailOnsets.length} tail onsets, tail RMS ${tailRms.toFixed(5)}`,
  );
}

main().catch((err) => {
  console.error("capture harness crashed:", err);
  process.exit(1);
});
