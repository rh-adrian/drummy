// M3 end-to-end verification: real MCP server process (stdio) + real page audio.
// Acts like the LLM: play_groove (funk feel) → update_groove (busier hats) →
// set_tempo → stop, recording the page's audio throughout. Also verifies the
// two-session port-collision message and transport-close → port release (NFR-3).
//
//   npm run build && npm run e2e
//
// Requires: npx playwright install chromium; internet (Strudel + samples CDN).
import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";
import { detectOnsets, encodeWavPcm16 } from "../src/capture/analysis.js";

const PORT = 4791;
const BPM_A = 100;
const BPM_C = 125;

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
    } catch (err) { console.warn("capture hook error", err); }
    return origConnect.call(this, target, ...rest);
  };
})();`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.error(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

function textOf(res: unknown): string {
  return ((res as CallToolResult).content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("\n");
}

async function main() {
  console.error("spawning MCP server (stdio) …");
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, AI_DRUMMER_PORT: String(PORT) },
    stderr: "pipe",
  });
  const client = new Client({ name: "e2e", version: "0.0.0" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;

  console.error("opening page in headless chrome …");
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
  await page.goto(`http://localhost:${PORT}`);
  await page.click("#arm");
  await sleep(3500); // prebake + first heartbeats

  const kits = await call("list_kits");
  check("list_kits shows real drum availability", /RolandTR808[^\n]*\[drums: [^\]]*bd/.test(textOf(kits)), textOf(kits).split("\n")[1] ?? "");

  const np0 = JSON.parse(textOf(await call("now_playing")));
  check("now_playing sees the page (heartbeat recency)", np0.pageConnected === true && np0.playing === false, JSON.stringify({ pageConnected: np0.pageConnected, playing: np0.playing }));

  await page.evaluate("window.__recording = true");
  const marks: Record<string, number> = {};
  const t0 = Date.now();
  const mark = (k: string) => (marks[k] = Date.now() - t0);

  // Phase A — funk groove, Brick-House feel at 100 BPM.
  mark("play");
  const play = await call("play_groove", {
    groove: {
      tempoBpm: BPM_A,
      swing: 0.1,
      bank: "RolandTR808",
      voices: [
        { drum: "bd", hits: [{ step: 0 }, { step: 7, vel: 0.85 }, { step: 10, vel: 0.9 }] },
        { drum: "sd", hits: [{ step: 4 }, { step: 12 }, { step: 6, vel: 0.25 }, { step: 11, vel: 0.25 }] },
        { drum: "hh", hits: [0, 2, 4, 6, 8, 10, 12].map((step) => ({ step, vel: 0.55 })) },
        { drum: "oh", hits: [{ step: 14, vel: 0.7 }] },
      ],
    },
  });
  check("play_groove ok", !play.isError, textOf(play));
  await sleep(7200); // ~3 bars

  // Phase B — iterate: busier hats.
  mark("update");
  const update = await call("update_groove", {
    voices: [{ drum: "hh", hits: Array.from({ length: 16 }, (_, i) => ({ step: i, vel: i % 4 === 0 ? 0.75 : 0.5 })) }],
  });
  check("update_groove ok", !update.isError, textOf(update));
  await sleep(7200);

  // Phase C — tempo up.
  mark("tempo");
  const tempo = await call("set_tempo", { bpm: BPM_C });
  check("set_tempo ok", !tempo.isError, textOf(tempo));
  const np1 = JSON.parse(textOf(await call("now_playing")));
  check(
    "now_playing reflects the session",
    np1.playing === true && np1.tempoBpm === BPM_C && np1.bank === "RolandTR808" &&
      np1.groove.voices.find((v: { drum: string }) => v.drum === "hh").hits.length === 16,
    `playing=${np1.playing} tempo=${np1.tempoBpm} bank=${np1.bank}`,
  );
  await sleep(5800); // ~3 bars at 125

  // Stop.
  mark("stop");
  const stop = await call("stop");
  check("stop ok", !stop.isError, textOf(stop));
  await sleep(1500);
  mark("end");
  await page.evaluate("window.__recording = false");

  const np2 = JSON.parse(textOf(await call("now_playing")));
  check("now_playing shows stopped", np2.playing === false, `playing=${np2.playing}`);

  const sampleRate = (await page.evaluate("window.__capSampleRate")) as number;
  const chunks = (await page.evaluate("window.__pcmChunks")) as number[][];
  await browser.close();

  // Second session while this one holds the port → actionable collision error.
  const transport2 = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, AI_DRUMMER_PORT: String(PORT) },
    stderr: "pipe",
  });
  const client2 = new Client({ name: "e2e-2", version: "0.0.0" });
  await client2.connect(transport2);
  const collide = (await client2.callTool({ name: "now_playing", arguments: {} })) as CallToolResult;
  check(
    "second session gets port-in-use error",
    collide.isError === true && textOf(collide).includes(String(PORT)),
    textOf(collide).slice(0, 80),
  );
  await client2.close();

  // Transport close → sidecar shutdown, port released (NFR-3).
  await client.close();
  await sleep(700);
  const portFree = (() => {
    try {
      execSync(`lsof -ti :${PORT}`, { stdio: "pipe" });
      return false;
    } catch {
      return true;
    }
  })();
  check("port released after transport close", portFree, `port ${PORT}`);

  const pcm = new Float32Array(chunks.flat());
  console.error(`captured ${(pcm.length / sampleRate).toFixed(1)}s at ${sampleRate} Hz`);
  await mkdir("captures", { recursive: true });
  await writeFile("captures/m3-e2e.wav", encodeWavPcm16(pcm, sampleRate));
  console.error("wrote captures/m3-e2e.wav");

  // DSP: onset rate per phase (busier hats → higher rate; faster tempo → higher still).
  const onsets = detectOnsets(pcm, sampleRate).map((t) => t * 1000);
  const rate = (a: number, b: number) => onsets.filter((t) => t >= a && t < b).length / ((b - a) / 1000);
  const rateA = rate(marks.play + 2500, marks.update - 200);
  const rateB = rate(marks.update + 2600, marks.tempo - 200); // +1 bar for the quantized swap
  const rateC = rate(marks.tempo + 2200, marks.stop - 200);
  check("phase A groove audible", rateA > 3, `${rateA.toFixed(1)} onsets/s`);
  check("busier hats after update_groove", rateB > rateA * 1.2, `${rateA.toFixed(1)} → ${rateB.toFixed(1)} onsets/s`);
  check("faster after set_tempo", rateC > rateB * 1.12, `${rateB.toFixed(1)} → ${rateC.toFixed(1)} onsets/s (125/100 BPM)`);

  const tailStart = Math.max(0, pcm.length - sampleRate);
  let sum = 0;
  for (let i = tailStart; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  const tailRms = Math.sqrt(sum / (pcm.length - tailStart));
  const tailOnsets = onsets.filter((t) => t > (pcm.length / sampleRate) * 1000 - 1000);
  check("silence after stop", tailOnsets.length === 0 && tailRms < 0.005, `${tailOnsets.length} tail onsets, RMS ${tailRms.toFixed(5)}`);

  const failed = results.filter((r) => !r.pass);
  console.error(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nall ${results.length} e2e checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("e2e crashed:", err);
  process.exit(1);
});
