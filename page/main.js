// AI Drummer page: connects to the sidecar over WS, receives compiled Strudel
// code, and swaps patterns at bar boundaries (D-10). Strudel itself (AGPL) is
// loaded unmodified from unpkg at runtime — nothing AGPL lives in this repo (D-7).
import { msUntilNextCycle } from "./quantize.js";
import { gridModel, playheadStep } from "./grid.js";

const SAMPLE_MAP_URL = "https://strudel.b-cdn.net/tidal-drum-machines.json";

const el = (id) => document.getElementById(id);
const state = {
  armed: false,
  playing: false,
  paused: false, // page-local pause (FR-6/D-18); server state untouched
  wsOpen: false,
  code: null, // currently playing code
  groove: null, // parsed groove JSON driving the grid (v1.1 FR-2)
  queued: null, // {code, groove} received before arming
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

function applyEvaluate(code, groove = null) {
  // Warm the bank's samples immediately — by swap time (up to a bar away) the
  // fetches have had time to land, so the new kit's first hits don't drop.
  const bank = code.match(/\.bank\("(\w+)"\)/)?.[1] ?? null;
  if (bank) warmBank(bank);

  if (!state.armed || !repl) {
    state.queued = { code, groove };
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
    state.paused = false; // a fresh push implies intent to hear it (D-18)
    state.code = code;
    state.groove = groove; // grid swaps in the same beat as the audio (FR-2)
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
    const { code, groove } = state.queued;
    state.queued = null;
    applyEvaluate(code, groove);
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
  state.paused = false; // a server stop clears any local pause (FR-6)
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
    if (msg.type === "evaluate") applyEvaluate(msg.code, msg.groove ?? null);
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
        paused: state.paused,
        bank: state.bank,
      }),
    );
  }
}
setInterval(sendStatus, 2000);

// Safari only unlocks audio when resume() runs synchronously inside a gesture
// handler (FR-5); Strudel's own first-click hook may not even be registered yet
// if the CDN script is still initializing, so do it ourselves, guarded.
function resumeAudioSync() {
  try {
    // eslint-disable-next-line no-undef -- global from @strudel/web when loaded
    if (typeof getAudioContext === "function") getAudioContext()?.resume?.();
  } catch {
    /* absent or not ready — Chrome recovers via Strudel's own hook */
  }
}

// ---- arm on click (browser autoplay policy needs one gesture)
el("arm").addEventListener("click", () => {
  resumeAudioSync();
  state.armed = true;
  el("overlay").classList.add("hidden");
  flushQueued();
  render();
  sendStatus();
});

// ---- play/pause: page-local transport (FR-6/D-18). Pause stops the audio;
// play restarts the current groove from the top of the bar. A pending
// bar-boundary swap is deliberately NOT cancelled by pause — an incoming
// evaluate means someone asked to hear something, and it wins (D-18).
el("playpause").addEventListener("click", () => {
  if (!repl || !state.code) return;
  resumeAudioSync();
  if (state.playing) {
    repl.stop();
    state.playing = false;
    state.paused = true;
  } else {
    repl.evaluate(state.code);
    state.playing = true;
    state.paused = false;
  }
  render();
  sendStatus();
});

// ---- step grid (FR-2): rebuilt only when the groove object changes; the
// playhead just toggles a class on the current column's cells.
let builtGroove = null;
let phCols = []; // step index → cell elements in that column
let phLast = null;

function setPlayhead(step) {
  if (step === phLast) return;
  if (phLast !== null) for (const c of phCols[phLast] ?? []) c.classList.remove("ph");
  if (step !== null) for (const c of phCols[step] ?? []) c.classList.add("ph");
  phLast = step;
}

function buildGrid() {
  if (state.groove === builtGroove) return;
  builtGroove = state.groove;
  const grid = el("grid");
  grid.textContent = "";
  phCols = [];
  phLast = null;
  if (!state.groove) return; // render() writes the placeholder text
  const model = gridModel(state.groove);
  phCols = Array.from({ length: model.steps }, () => []);
  for (const row of model.rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "grid-row";
    rowEl.style.setProperty("--steps", String(model.steps));
    const label = document.createElement("span");
    label.className = "grid-label";
    label.textContent = row.drum;
    rowEl.appendChild(label);
    row.cells.forEach((vel, i) => {
      const cell = document.createElement("div");
      let cls = "grid-cell";
      if (i > 0 && i % model.resolution === 0) cls += " barline";
      else if (i > 0 && i % model.beatLen === 0) cls += " beat";
      if (vel !== null) {
        cls += " hit";
        // floor of 0.25 keeps the faintest ghost visible; accents hit 1.0
        cell.style.setProperty("--vel", String(0.25 + 0.75 * vel));
      }
      cell.className = cls;
      rowEl.appendChild(cell);
      phCols[i].push(cell);
    });
    grid.appendChild(rowEl);
  }
}

// ---- playhead loop (FR-3): cycle position mod bars is the pattern position;
// hidden whenever stopped, paused, or introspection fails.
(function phTick() {
  if (state.playing && state.groove && repl) {
    const now = schedulerNow();
    setPlayhead(
      now === null
        ? null
        : playheadStep(now, state.groove.bars ?? 1, state.groove.resolution ?? 16),
    );
  } else {
    setPlayhead(null);
  }
  requestAnimationFrame(phTick);
})();

// ---- display
function render() {
  el("dot-server").className = `dot ${state.wsOpen ? "on" : ""}`;
  el("dot-audio").className = `dot ${state.armed ? "on" : "warn"}`;
  el("dot-playing").className = `dot ${state.playing ? "on" : ""}`;
  const meta = [];
  if (state.tempo) meta.push(`${state.tempo} BPM`);
  if (state.bank) meta.push(`<span class="bank">${state.bank}</span>`);
  el("meta").innerHTML = meta.join(" · ") || "—";
  const btn = el("playpause");
  btn.disabled = !state.armed || !repl || !state.code;
  btn.textContent = state.playing ? "❚❚" : "▶";
  buildGrid();
  if (!state.groove) {
    // FR-4 fallback: an evaluate without groove data (stale/foreign server)
    // must still leave something useful on screen — open the code.
    el("grid").textContent = state.code
      ? "// no groove data for this pattern — see the code below"
      : state.queued
        ? "// groove queued — press Start"
        : "// waiting for a groove…";
    if (state.code) el("codebox").open = true;
  }
  el("code").textContent =
    state.code ?? (state.queued ? "// groove queued — press Start" : "// waiting for a groove…");
}

connect();
render();

// Debug/harness introspection only — not part of the page's contract.
window.__ai = { state, getRepl: () => repl, getPlayheadStep: () => phLast };
