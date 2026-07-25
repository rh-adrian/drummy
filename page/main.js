// AI Drummer page: connects to the sidecar over WS, receives compiled Strudel
// code, and swaps patterns at bar boundaries (D-10). Strudel itself (AGPL) is
// loaded unmodified from unpkg at runtime — nothing AGPL lives in this repo (D-7).
import { msUntilNextCycle } from "./quantize.js";

const SAMPLE_MAP_URL = "https://strudel.b-cdn.net/tidal-drum-machines.json";

const el = (id) => document.getElementById(id);
const state = {
  armed: false,
  playing: false,
  wsOpen: false,
  code: null, // currently playing code
  queued: null, // evaluate received before arming
  bank: null,
  tempo: null,
  pendingSwap: null,
  pendingCps: null, // setCps received before initStrudel resolved
};

// initStrudel registers evaluate/hush/etc. as globals and starts prebaking the
// drum-machine sample map immediately (network warm-up before the user arms).
// It returns a Promise resolving to the repl (whose scheduler drives quantize).
let repl = null;
Promise.resolve(
  initStrudel({
    prebake: () => samples(SAMPLE_MAP_URL),
  }),
).then(
  (r) => {
    repl = r;
    // A setCps may also have arrived before init resolved. If an evaluate is
    // queued it carries a stale setcpm, so the pending cps must be applied
    // AFTER that evaluate runs (applyEvaluate handles it); with nothing queued
    // apply it now.
    if (state.pendingCps !== null && !state.queued) {
      repl.setCps(state.pendingCps);
      state.pendingCps = null;
    }
    flushQueued(); // an evaluate may have arrived after arm but before init resolved
  },
  (err) => console.error("initStrudel failed:", err),
);

// ---- scheduler introspection (guarded: repl internals, may shift between versions)
function schedulerNow() {
  try {
    const s = repl?.scheduler;
    if (s && typeof s.now === "function") return s.now();
  } catch {
    /* fall through */
  }
  return null;
}
function schedulerCps() {
  try {
    const cps = repl?.scheduler?.cps;
    if (Number.isFinite(cps) && cps > 0) return cps;
  } catch {
    /* fall through */
  }
  return 0.5; // 120 BPM in 4/4 — only used if introspection fails
}

// ---- pattern application with bar-boundary quantize
//
// Swap SWAP_LEAD_MS before the bar line: the scheduler has already queued
// ~250ms of audio ahead, so a swap exactly on the line loses the new groove's
// first steps. Firing early costs at most a couple of tail-step hits from the
// incoming groove but guarantees its downbeat lands. If we're already inside
// the lead window, we take the following bar line instead.
const SWAP_LEAD_MS = 300;

function applyEvaluate(code) {
  // Warm the bank's samples immediately — by swap time (up to a bar away) the
  // fetches have had time to land, so the new kit's first hits don't drop.
  const bank = code.match(/\.bank\("(\w+)"\)/)?.[1] ?? null;
  if (bank) warmBank(bank);

  if (!state.armed || !repl) {
    state.queued = code;
    render();
    return;
  }
  let delayMs = 0;
  if (state.playing) {
    const now = schedulerNow();
    if (now !== null) {
      const cps = schedulerCps();
      delayMs = msUntilNextCycle(now, cps) - SWAP_LEAD_MS;
      if (delayMs < 0) delayMs += 1000 / cps;
    }
    // introspection failed → delayMs stays 0: swap immediately rather than
    // guessing a phase (degraded but correct-ish; the harness would catch it)
  }
  clearTimeout(state.pendingSwap);
  state.pendingSwap = setTimeout(() => {
    repl.evaluate(code);
    state.playing = true;
    state.code = code;
    state.tempo = code.match(/setcpm\(([\d.]+)\/4\)/)?.[1] ?? state.tempo;
    if (state.pendingCps !== null) {
      // a setCps arrived while repl was null; it postdates this code's setcpm
      repl.setCps(state.pendingCps);
      state.tempo = String(Math.round(state.pendingCps * 240));
      state.pendingCps = null;
    }
    state.bank = bank ?? state.bank;
    render();
    sendStatus();
  }, delayMs);
}

function flushQueued() {
  if (state.armed && repl && state.queued) {
    const code = state.queued;
    state.queued = null;
    applyEvaluate(code);
  }
}

// NOTE: the global `hush` is the silence *pattern* function (it returns a
// Pattern and stops nothing) — repl.stop() is the real transport stop.
function applyHush() {
  clearTimeout(state.pendingSwap);
  state.queued = null;
  state.pendingCps = null;
  repl?.stop();
  state.playing = false;
  render();
  sendStatus();
}

// ---- sample pre-warm: pull this bank's files into the HTTP cache so first
// triggers don't drop (superdough fetches lazily on first hit)
let sampleMapPromise = null;
const warmedBanks = new Set();
async function warmBank(bank) {
  if (warmedBanks.has(bank)) return;
  warmedBanks.add(bank);
  try {
    sampleMapPromise ??= fetch(SAMPLE_MAP_URL).then((r) => r.json());
    const map = await sampleMapPromise;
    const base = map._base ?? "";
    const urls = Object.entries(map)
      .filter(([k]) => k.startsWith(`${bank}_`))
      .map(([, files]) => base + (Array.isArray(files) ? files[0] : files));
    await Promise.allSettled(urls.map((u) => fetch(u, { mode: "cors" })));
  } catch (err) {
    // allow a retry on the next push — a transient failure must not disable
    // pre-warm for this bank (or, via a cached rejected map promise, all banks)
    warmedBanks.delete(bank);
    sampleMapPromise = null;
    console.warn("sample pre-warm failed (playback will lazy-load):", err);
  }
}

// ---- websocket with auto-reconnect
let ws = null;
function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => {
    state.wsOpen = true;
    render();
    sendStatus();
  };
  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "evaluate") applyEvaluate(msg.code);
    else if (msg.type === "hush") applyHush();
    else if (msg.type === "setCps" && Number.isFinite(msg.cps) && msg.cps > 0) {
      if (repl) repl.setCps(msg.cps);
      else state.pendingCps = msg.cps; // applied once initStrudel resolves
      state.tempo = String(Math.round(msg.cps * 240)); // one cycle = one bar of 4/4
      render();
    }
  };
  ws.onclose = () => {
    state.wsOpen = false;
    render();
    setTimeout(connect, 1000);
  };
  ws.onerror = () => ws.close();
}

function sendStatus() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "status",
        armed: state.armed,
        playing: state.playing,
        bank: state.bank,
      }),
    );
  }
}
setInterval(sendStatus, 2000);

// ---- arm on click (browser autoplay policy needs one gesture)
el("arm").addEventListener("click", () => {
  state.armed = true;
  el("overlay").classList.add("hidden");
  flushQueued();
  render();
  sendStatus();
});

// ---- display
function render() {
  el("dot-server").className = `dot ${state.wsOpen ? "on" : ""}`;
  el("dot-audio").className = `dot ${state.armed ? "on" : "warn"}`;
  el("dot-playing").className = `dot ${state.playing ? "on" : ""}`;
  const meta = [];
  if (state.tempo) meta.push(`${state.tempo} BPM`);
  if (state.bank) meta.push(`<span class="bank">${state.bank}</span>`);
  el("meta").innerHTML = meta.join(" · ") || "—";
  el("code").textContent =
    state.code ?? (state.queued ? "// groove queued — press Start" : "// waiting for a groove…");
}

connect();
render();

// Debug/harness introspection only — not part of the page's contract.
window.__ai = { state, getRepl: () => repl };
