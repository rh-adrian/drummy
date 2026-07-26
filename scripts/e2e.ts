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
const BPM_D = 84; // acoustic phase: slow enough that snare decays separate the hits

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

  const np0 = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
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

  // v1.1 FR-2/FR-4: the grid shows the groove (4 rows, every hit lit), and the
  // code details stay collapsed when groove data is present.
  const grid = (await page.evaluate(`(() => ({
    rows: document.querySelectorAll("#grid .grid-row:not(.count-row):not(.bar-row)").length,
    hits: document.querySelectorAll("#grid .grid-cell.hit").length,
    grooveVoices: window.__ai.state.groove ? window.__ai.state.groove.voices.length : 0,
    codeOpen: document.querySelector("#codebox").open,
  }))()`)) as { rows: number; hits: number; grooveVoices: number; codeOpen: boolean };
  check(
    "grid renders the groove",
    grid.rows === 4 && grid.hits >= 15 && grid.grooveVoices === 4 && !grid.codeOpen,
    JSON.stringify(grid),
  );

  // v1.5 FR-5: the drummer's count header labels every step, and FR-3: every
  // voice row carries a track fader.
  const headerInfo = (await page.evaluate(`(() => {
    const cells = [...document.querySelectorAll("#grid .count-row .count-cell")];
    return {
      countCells: cells.length,
      firstBeat: cells.slice(0, 4).map((c) => c.textContent).join(" "),
      sliders: document.querySelectorAll("#grid .track-vol").length,
    };
  })()`)) as { countCells: number; firstBeat: string; sliders: number };
  check(
    "count header + track faders render (v1.5)",
    headerInfo.countCells === 16 && headerInfo.firstBeat === "1 e & a" && headerInfo.sliders === 4,
    JSON.stringify(headerInfo),
  );

  // v1.1 FR-3: playhead sweeps while playing.
  const ph1 = (await page.evaluate("window.__ai.getPlayheadStep()")) as number | null;
  await sleep(600); // one beat at 100 BPM = 4 steps
  const ph2 = (await page.evaluate("window.__ai.getPlayheadStep()")) as number | null;
  check("playhead advances with the beat", ph1 !== null && ph2 !== null && ph1 !== ph2, `step ${ph1} → ${ph2}`);

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
  const np1 = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  check(
    "now_playing reflects the session",
    np1.playing === true && np1.tempoBpm === BPM_C && np1.bank === "RolandTR808" &&
      np1.groove.voices.find((v: { drum: string }) => v.drum === "hh").hits.length === 16,
    `playing=${np1.playing} tempo=${np1.tempoBpm} bank=${np1.bank}`,
  );

  // Cell clicks became a 4-state cycle in v1.5 (D-36) — 4 clicks with WS
  // round-trips no longer fit before the rateC window opens at
  // marks.tempo+2200, so the click checks moved to phase D1 (still before
  // D2's measurement anchor).

  await sleep(5800); // ~3 bars at 125

  // Phase D — v1.3 Acoustic kit, in two sub-steps.
  //
  // D1: cb/ch/sp play + render as grid rows. Cymbals ring for seconds after
  // their last trigger (hush stops the pattern, not already-sounding voices),
  // so this step comes FIRST and the measured ramp below replaces it — by
  // measurement (and stop) time the cymbals have decayed out of every window.
  mark("acoustic");
  const acoustic = await call("play_groove", {
    groove: {
      tempoBpm: BPM_D,
      bank: "Acoustic",
      voices: [
        { drum: "sd", hits: [{ step: 0 }, { step: 8 }] },
        { drum: "cb", hits: [{ step: 2, vel: 0.7 }] },
        { drum: "ch", hits: [{ step: 6, vel: 0.4 }] },
        { drum: "sp", hits: [{ step: 10, vel: 0.4 }] },
      ],
    },
  });
  check("acoustic play_groove ok", !acoustic.isError, textOf(acoustic));
  await sleep(2800); // quantized swap + FLAC streaming warm-up + render
  const newRows = (await page.evaluate(
    `["cb","ch","sp"].map((d) => !!document.querySelector('#grid .grid-cell[data-drum="' + d + '"]')).join(",")`,
  )) as string;
  check("grid shows the v1.3 voices (cb/ch/sp)", newRows === "true,true,true", `cb,ch,sp present: ${newRows}`);

  // v1.5 FR-4: a cell click CYCLES off -> 0.7 -> 1.0 -> 0.25 -> off on the
  // SERVER's groove. Safe here: D2's play_groove below replaces this groove
  // and its DSP window is anchored after its own mark.
  const cbCell = `#grid .grid-cell[data-drum="cb"][data-step="1"]`;
  const cbVel = (d: { groove: { voices: Array<{ drum: string; hits: Array<{ step: number; vel: number }> }> } }) =>
    d.groove.voices.find((v) => v.drum === "cb")!.hits.find((h) => h.step === 1)?.vel ?? null;
  await page.click(cbCell);
  await sleep(400); // WS round trip; server state updates immediately
  const npCycle1 = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  check("cell click adds a normal-tier hit (v1.5 cycle)", cbVel(npCycle1) === 0.7, `vel=${cbVel(npCycle1)}`);
  await page.click(cbCell);
  await sleep(400);
  const npCycle2 = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  check("second click stresses it (v1.5 cycle)", cbVel(npCycle2) === 1, `vel=${cbVel(npCycle2)}`);
  await page.click(cbCell);
  await sleep(400);
  await page.click(cbCell);
  await sleep(400);
  const npCycle4 = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  check("fourth click cycles it off through ghost (v1.5 cycle)", cbVel(npCycle4) === null, `vel=${cbVel(npCycle4)}`);

  // v1.5 FR-3: releasing a track fader lands trackGain in the SERVER's groove
  // and the LLM sees [vol N%] in the rendering.
  await page.evaluate(`(() => {
    const s = document.querySelector('.track-vol[data-drum="cb"]');
    s.value = 50;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await sleep(400);
  const npVolText = textOf(await call("now_playing"));
  const npVol = JSON.parse(npVolText.split("\n\nGrid:")[0]);
  const cbGain = npVol.groove.voices.find((v: { drum: string }) => v.drum === "cb").trackGain;
  check(
    "track fader sets trackGain and renders [vol 50%] (v1.5)",
    cbGain === 0.5 && npVolText.includes("[vol 50%]"),
    `trackGain=${cbGain}`,
  );

  // v1.5 M-final MINOR-2: the zoom slider is a pure view control.
  const zoomVal = (await page.evaluate(`(() => {
    const z = document.querySelector("#zoom");
    z.value = 150;
    z.dispatchEvent(new Event("input", { bubbles: true }));
    return getComputedStyle(document.querySelector("#grid")).getPropertyValue("--zoom").trim();
  })()`)) as string;
  check("zoom slider scales the grid via --zoom (v1.5)", zoomVal === "1.5", `--zoom=${zoomVal}`);

  // v1.6 FR-2: mute silences the voice in the compiled code and tags the render.
  await page.click('.mute-btn[data-drum="cb"]');
  await sleep(400);
  // Server state is immediate; the page's code swap is bar-quantized (up to a
  // full 2-bar cycle), so assert the authoritative view — the compiler's
  // muted-voice skip is proven by unit test.
  const mutedText = textOf(await call("now_playing"));
  const npMuted = JSON.parse(mutedText.split("\n\nGrid:")[0]);
  const cbMuted = npMuted.groove.voices.find((v: { drum: string }) => v.drum === "cb");
  check(
    "mute flags the voice and renders [muted] (v1.6)",
    mutedText.includes("[muted]") && cbMuted.muted === true,
    `muted=${cbMuted.muted}`,
  );
  await page.click('.mute-btn[data-drum="cb"]'); // unmute again
  await sleep(400);

  // v1.6 FR-3/FR-4: clear empties the channel but keeps the row; undo restores it.
  await page.click('.clear-btn[data-drum="cb"]');
  await sleep(400);
  const npCleared = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  const cbCleared = npCleared.groove.voices.find((v: { drum: string }) => v.drum === "cb");
  check("clear empties the channel but keeps its row (v1.6)", cbCleared !== undefined && cbCleared.hits.length === 0, JSON.stringify(cbCleared?.hits));
  await page.click("#undo");
  await sleep(400);
  const npUndone = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  const cbUndone = npUndone.groove.voices.find((v: { drum: string }) => v.drum === "cb");
  check("undo restores the cleared channel (v1.6)", cbUndone.hits.length > 0, `hits=${cbUndone.hits.length}`);

  // v1.6 FR-5: the BPM input drives tempo through the server.
  await page.evaluate(`(() => {
    const b = document.querySelector("#bpm");
    b.value = 120;
    b.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await sleep(400);
  const npBpm = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  check("BPM input changes the tempo server-side (v1.6)", npBpm.tempoBpm === 120, `tempoBpm=${npBpm.tempoBpm}`);

  // v1.6 FR-6: my own edit while paused updates the grid but stays paused.
  await page.click("#playpause"); // pause
  await sleep(200);
  const sdCell = `#grid .grid-cell[data-drum="sd"][data-step="1"]`;
  await page.click(sdCell);
  await sleep(400);
  const pausedState = (await page.evaluate(
    "JSON.stringify({paused: window.__ai.state.paused, sd: window.__ai.state.groove.voices.find(v => v.drum==='sd').hits.some(h => h.step===1)})",
  )) as string;
  check("editing while paused stays paused, grid updates (v1.6)", pausedState === '{"paused":true,"sd":true}', pausedState);
  await page.click("#playpause"); // resume for phase D2
  await sleep(300);
  // undo the paused click so D2 starts from known state (D2 replaces the groove anyway)
  await page.click("#undo");
  await sleep(300);

  // v1.7: fills. fillChance 1 forces a fill EVERY loop (deterministic for
  // testing). The update also drops the tempo to 100 — the new wrandcat code
  // carries setcpm(100/4), so the page's cps landing at 100/240 PROVES the
  // wrandcat pattern evaluated successfully (an evaluate error would leave
  // the old 120-BPM cps running).
  const fillsUpdate = await call("update_groove", {
    tempoBpm: 100,
    fills: [{ grid: { ht: "XxXx" } }, { grid: { lt: "g-X-x-X-" } }],
    fillChance: 1,
  });
  check("update_groove adds fills (v1.7)", !fillsUpdate.isError, textOf(fillsUpdate).split("\n")[0]);
  check(
    "response renders the fill variations (v1.7 FR-5)",
    textOf(fillsUpdate).includes("fill 1 (last 4 steps):") && textOf(fillsUpdate).includes("fill 2 (last 8 steps):"),
    textOf(fillsUpdate).split("fill 1")[1]?.split("\n").slice(0, 2).join(" / ") ?? "missing",
  );
  const npFills = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  check(
    "wrandcat compiled with fillChance 1 (v1.7 FR-3)",
    npFills.groove.fillChance === 1 && npFills.groove.fills.length === 2,
    `fillChance=${npFills.groove.fillChance}, fills=${npFills.groove.fills.length}`,
  );
  await sleep(2600); // let the bar-quantized swap land (~2s bar at 120 + lead)
  const cpsAfterFills = (await page.evaluate("window.__ai.getRepl().scheduler.cps")) as number;
  check(
    "wrandcat pattern evaluated on the page (cps proves the swap, v1.7 D-46)",
    Math.abs(cpsAfterFills - 100 / 240) < 0.001,
    `cps ${cpsAfterFills.toFixed(4)} vs ${(100 / 240).toFixed(4)}`,
  );

  // The transport toggle turns fills off (server-owned, undo-able).
  const fillsVisible = (await page.evaluate('!document.querySelector("#fillsctl").hidden')) as boolean;
  await page.click("#fills");
  await sleep(400);
  const npOff = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  await page.click("#undo");
  await sleep(400);
  const npBack = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  check(
    "fills toggle appears, disables server-side, and undo restores it (v1.7 FR-4)",
    fillsVisible && npOff.groove.fillsEnabled === false && npBack.groove.fillsEnabled === true,
    `visible=${fillsVisible}, off=${npOff.groove.fillsEnabled}, undone=${npBack.groove.fillsEnabled}`,
  );

  // v1.7 FR-7: the master volume slider drives a session-level postgain.
  await page.evaluate(`(() => {
    const m = document.querySelector("#master");
    m.value = 50;
    m.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await sleep(400);
  const npMaster = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  check("master slider sets the session masterGain (v1.7 FR-7)", npMaster.masterGain === 0.5, `masterGain=${npMaster.masterGain}`);
  await page.evaluate(`(() => {
    const m = document.querySelector("#master");
    m.value = 100;
    m.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await sleep(300);

  // D2: velocity ramp, sd ONLY, loud→soft so each hit's long tail decays
  // before anything quieter follows: FF (1.0) → F (0.7) → MP (0.4) → ghost
  // (0.1), one hit every 2 beats across 2 bars (~1.43s apart at 84 BPM).
  // The slot selection is proven by decay SHAPE, not level — the source files
  // are peak-normalized (D-29), so a ghost recording is a short snap and an
  // FF recording rings for seconds; gain can't fake that.
  const ramp = await call("play_groove", {
    groove: {
      tempoBpm: BPM_D,
      bank: "Acoustic",
      bars: 2,
      voices: [
        {
          drum: "sd",
          hits: [
            { step: 0, vel: 1 },
            { step: 8, vel: 0.7 },
            { step: 16, vel: 0.4 },
            { step: 24, vel: 0.1 },
          ],
        },
      ],
    },
  });
  check("acoustic ramp play_groove ok", !ramp.isError, textOf(ramp));
  await sleep(4700); // swap (≤1 bar of D1) + cymbal ring-down before the window opens
  mark("acousticMeasure");
  await sleep(12000); // ~2 ramp cycles measured (one cycle = 2 bars = 5.7s)
  mark("acousticEnd");
  const acousticState = (await page.evaluate(
    "({ code: window.__ai.state.code, bank: window.__ai.state.bank })",
  )) as { code: string; bank: string };
  check(
    "acoustic evaluate carries the velocity slot grid (.n)",
    acousticState.bank === "Acoustic" && acousticState.code.includes(".n("),
    `bank=${acousticState.bank}, .n present=${acousticState.code.includes(".n(")}`,
  );

  // Stop.
  mark("stop");
  const stop = await call("stop");
  check("stop ok", !stop.isError, textOf(stop));
  await sleep(1500);
  mark("end");
  await page.evaluate("window.__recording = false");

  const np2 = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  check("now_playing shows stopped", np2.playing === false, `playing=${np2.playing}`);

  // v1.1 FR-6/D-18: page-local play/pause. After the server stop the button
  // restarts the last groove locally; a second click pauses it.
  await page.click("#playpause");
  await sleep(400);
  const localPlaying = (await page.evaluate("window.__ai.state.playing")) as boolean;
  // Local replay must come back at the LAST groove's tempo — the acoustic
  // play_groove's setcpm was received after the earlier setCps, so by receipt
  // order (v1.2) it superseded it. (Before v1.3 this asserted BPM_C: the newer
  // setCps had to survive an older evaluate's late bar-boundary swap.)
  const cpsAfterRestart = (await page.evaluate("window.__ai.getRepl().scheduler.cps")) as number;
  check(
    "local restart keeps the last groove's cps",
    Math.abs(cpsAfterRestart - BPM_D / 240) < 0.001,
    `cps ${cpsAfterRestart.toFixed(4)} vs ${(BPM_D / 240).toFixed(4)}`,
  );
  await page.click("#playpause");
  await sleep(200);
  const localPaused = (await page.evaluate(
    "({ playing: window.__ai.state.playing, paused: window.__ai.state.paused })",
  )) as { playing: boolean; paused: boolean };
  check(
    "play/pause button drives local transport",
    localPlaying === true && localPaused.playing === false && localPaused.paused === true,
    `restarted=${localPlaying}, then paused=${localPaused.paused}`,
  );
  const npPaused = JSON.parse(textOf(await call("now_playing")).split("\n\nGrid:")[0]);
  check(
    "now_playing sees the page paused (FR-6)",
    npPaused.pageStatus?.paused === true,
    JSON.stringify(npPaused.pageStatus),
  );

  // …and a fresh push while paused applies and plays (D-18).
  const rePlay = await call("play_groove", {
    groove: {
      tempoBpm: 120,
      bank: "RolandTR808",
      voices: [{ drum: "bd", hits: [{ step: 0 }, { step: 4 }, { step: 8 }, { step: 12 }] }],
    },
  });
  await sleep(600); // not playing → swap applies immediately
  const unPaused = (await page.evaluate(
    "({ playing: window.__ai.state.playing, paused: window.__ai.state.paused })",
  )) as { playing: boolean; paused: boolean };
  check(
    "incoming groove un-pauses the page (D-18)",
    !rePlay.isError && unPaused.playing === true && unPaused.paused === false,
    JSON.stringify(unPaused),
  );
  await call("stop");
  await sleep(300);

  // v1.1 FR-4: an evaluate WITHOUT groove data (stale/foreign server) must fall
  // back to showing the code. Injected through the page's real WS handler.
  await page.evaluate(
    `window.__ai.getWs().onmessage({ data: JSON.stringify({ type: "evaluate", code: 'setcpm(90/4)\\n$: s("bd")' }) })`,
  );
  await sleep(500); // stopped → swap applies immediately
  const fallback = (await page.evaluate(
    "({ groove: window.__ai.state.groove, open: document.querySelector('#codebox').open })",
  )) as { groove: unknown; open: boolean };
  check(
    "code-only evaluate opens the code fallback (FR-4)",
    fallback.groove === null && fallback.open === true,
    JSON.stringify(fallback),
  );
  // (the injected pattern plays only until the browser closes below; the server
  // never knew about it, so there is nothing to stop)

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
  const rateC = rate(marks.tempo + 2200, marks.acoustic - 200); // acoustic phase follows — keep it out
  check("phase A groove audible", rateA > 3, `${rateA.toFixed(1)} onsets/s`);
  check("busier hats after update_groove", rateB > rateA * 1.2, `${rateA.toFixed(1)} → ${rateB.toFixed(1)} onsets/s`);
  check("faster after set_tempo", rateC > rateB * 1.12, `${rateB.toFixed(1)} → ${rateC.toFixed(1)} onsets/s (125/100 BPM)`);

  // v1.3: the acoustic velocity ramp — FF/F/MP/ghost, 2 beats apart. Anchor on
  // the loudest detected onset (the FF hit) and compute the other hits'
  // windows from the known pattern phase (onset detection can miss the vel-0.1
  // ghost). Two independent proofs:
  //  - levels: peak ratio FF/ghost ≈ vel ratio (gain path works)
  //  - waveform identity: gain-normalized cross-correlation between the FF and
  //    ghost hits. The same recording at two gains correlates ≈1; different
  //    recordings decorrelate — gain can't fake that, so this can only pass
  //    if .n() actually selected different recordings (D-29).
  const acWin = onsets.filter((t) => t >= marks.acousticMeasure && t < marks.acousticEnd);
  check("acoustic kit audible (FLAC decoded + streamed)", acWin.length >= 4, `${acWin.length} onsets in window`);
  const peakAfter = (tMs: number) => {
    const from = Math.max(0, Math.floor(((tMs - 30) / 1000) * sampleRate));
    const to = Math.min(pcm.length, from + Math.floor(0.2 * sampleRate));
    let p = 0;
    for (let i = from; i < to; i++) p = Math.max(p, Math.abs(pcm[i]));
    return p;
  };
  // Onset-aligned slice: from tMs-30ms, first sample above 30% of local peak.
  const sliceAt = (tMs: number, lenMs: number): Float32Array => {
    const from = Math.max(0, Math.floor(((tMs - 30) / 1000) * sampleRate));
    const scanTo = Math.min(pcm.length, from + Math.floor(0.25 * sampleRate));
    let localPeak = 0;
    for (let i = from; i < scanTo; i++) localPeak = Math.max(localPeak, Math.abs(pcm[i]));
    let start = from;
    for (let i = from; i < scanTo; i++) {
      if (Math.abs(pcm[i]) >= 0.3 * localPeak) {
        start = i;
        break;
      }
    }
    return pcm.slice(start, Math.min(pcm.length, start + Math.floor((lenMs / 1000) * sampleRate)));
  };
  // Max normalized cross-correlation over small lags (absorbs onset-pick error).
  const maxCorr = (a: Float32Array, b: Float32Array): number => {
    const n = Math.min(a.length, b.length) - 300;
    let best = 0;
    for (let lag = -240; lag <= 240; lag += 6) {
      let dot = 0,
        na = 0,
        nb = 0;
      for (let i = 150; i < n; i++) {
        const va = a[i];
        const vb = b[i + lag + 150] ?? 0;
        dot += va * vb;
        na += va * va;
        nb += vb * vb;
      }
      best = Math.max(best, Math.abs(dot) / Math.max(1e-9, Math.sqrt(na * nb)));
    }
    return best;
  };
  const spacing = (60000 / BPM_D) * 2; // one ramp hit every 2 beats
  const ff = acWin
    .filter((t) => t >= marks.acousticMeasure && t < marks.acousticEnd - 3 * spacing - 600)
    .sort((a, b) => peakAfter(b) - peakAfter(a))[0];
  let rampDetail = "no FF onset found in window";
  let rampPass = false;
  if (ff !== undefined) {
    const peaks = [0, 1, 2, 3].map((k) => peakAfter(ff + k * spacing)); // FF → F → MP → ghost
    const spread = peaks[0] / peaks[3];
    const corr = maxCorr(sliceAt(ff, 60), sliceAt(ff + 3 * spacing, 60));
    rampPass =
      Number.isFinite(spread) &&
      spread >= 4 && // vel 1 vs 0.1 through the gain path
      peaks[0] > peaks[1] && peaks[1] > peaks[2] && peaks[2] > peaks[3] &&
      corr < 0.8; // same-recording-at-two-gains would correlate ≈ 1
    rampDetail =
      `peaks FF→ghost: ${peaks.map((p) => p.toFixed(3)).join(" > ")} (spread ${spread.toFixed(1)}×); ` +
      `FF↔ghost waveform corr ${corr.toFixed(3)} (same recording ≈ 1)`;
  }
  check("velocity layers select real recordings (v1.3)", rampPass, rampDetail);

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
