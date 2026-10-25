// PROTOTYPE (issue #7) — throwaway. Records every section of every song file
// through the real page (headless Chrome, same tee hook as scripts/capture.ts)
// so a person can listen to the AI's transcriptions anywhere, as plain MP3s.
//
//   npx tsx prototypes/song-tabs/render.ts <out-dir> <songs-dir>...
//
// Writes <out-dir>/<songs-dir name>/<song>--<section>.mp3 (needs ffmpeg on PATH
// or FFMPEG=/path/to/ffmpeg). Song files and clips hold real tab content: keep
// both out of git.
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { parseGroove } from "../../src/core/groove.js";
import { compileGroove } from "../../src/core/compile.js";
import { startSidecar } from "../../src/server/sidecar.js";
import { encodeWavPcm16 } from "../../src/capture/analysis.js";

const PORT = 4791;
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const MIN_SECONDS = 12;
const MAX_SECONDS = 24;

// Same tee as scripts/capture.ts: mirror everything bound for the speakers
// into a ScriptProcessor that collects mono PCM while window.__recording is set.
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
            if (window.__recording) window.__pcmChunks.push(Array.from(e.inputBuffer.getChannelData(0)));
          };
          ctx.__cap = cap;
          window.__capSampleRate = ctx.sampleRate;
        }
        origConnect.call(this, ctx.__cap);
      }
    } catch (err) { console.warn("capture hook error", err); }
    return origConnect.call(this, target, ...rest);
  };
})();`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const [outDir, ...songDirs] = process.argv.slice(2);
if (!outDir || songDirs.length === 0) {
  console.error("usage: render.ts <out-dir> <songs-dir>...");
  process.exit(2);
}

const sidecar = await startSidecar({ port: PORT });
const browser = await chromium.launch({
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
await page.addInitScript(CAPTURE_HOOK);
await page.goto(sidecar.url);
await page.click("#arm");
await sleep(2000);

for (const dir of songDirs) {
  const label = path.basename(dir);
  await mkdir(path.join(outDir, label), { recursive: true });
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
    const song = JSON.parse(await readFile(path.join(dir, file), "utf8"));
    for (const [section, input] of Object.entries(song.sections ?? {})) {
      const parsed = parseGroove(input);
      if (!parsed.ok) {
        console.error(`  SKIP ${label}/${file} [${section}]: ${parsed.error}`);
        continue;
      }
      const g = parsed.groove;
      const loopSec = (g.bars * 240) / g.tempoBpm;
      const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, 2 * loopSec));
      // Unrecorded warm-up loop: lands the swap at a bar boundary and decodes samples.
      sidecar.push({ type: "evaluate", code: compileGroove(g), groove: g });
      await sleep(loopSec * 1000 + 2500);
      await page.evaluate("window.__pcmChunks = []; window.__recording = true");
      await sleep(seconds * 1000);
      await page.evaluate("window.__recording = false");
      const rate = (await page.evaluate("window.__capSampleRate")) as number;
      const chunks = (await page.evaluate("window.__pcmChunks")) as number[][];
      const pcm = new Float32Array(chunks.flat());
      const base = path.join(outDir, label, `${file.replace(/\.json$/, "")}--${section}`);
      await writeFile(`${base}.wav`, encodeWavPcm16(pcm, rate));
      execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", `${base}.wav`, "-ac", "1", "-b:a", "96k", `${base}.mp3`]);
      console.error(`  ${label}/${path.basename(base)}.mp3  ${(pcm.length / rate).toFixed(1)}s  ${g.tempoBpm} BPM`);
    }
  }
}

sidecar.push({ type: "hush" });
await browser.close();
await sidecar.close();
