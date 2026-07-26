// AI Drummer page: connects to the sidecar over WS, receives compiled Strudel
// code, and swaps patterns at bar boundaries (D-10). Strudel itself (AGPL) is
// loaded unmodified from unpkg at runtime — nothing AGPL lives in this repo (D-7).
import { msUntilNextCycle } from "./quantize.js";
import { gridModel, playheadStep, countHeader, cycleNext } from "./grid.js";

const SAMPLE_MAP_URL = "https://strudel.b-cdn.net/tidal-drum-machines.json";
// Acoustic kit (v1.3): index served by the sidecar; the WAV-hosting _base
// inside it points at the pinned salamander mirror (see SAMPLES.md).
const ACOUSTIC_MAP_URL = "/acoustic.json";
const ACOUSTIC_BANK = "Acoustic";

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
  // Latest cps received, with the WS receipt sequence it arrived at. An
  // evaluate only supersedes it if the evaluate was RECEIVED later — an older
  // evaluate can APPLY later (bar-boundary delay) and must not clobber a newer
  // tempo with its baked-in setcpm. Also re-applied by the local play button.
  lastCps: null,
  lastCpsSeq: 0,
};

// Receipt-order counter for WS instructions (see lastCps above).
let msgSeq = 0;

// initStrudel registers evaluate/hush/etc. as globals and starts prebaking the
// drum-machine sample map immediately (network warm-up before the user arms).
// It returns a Promise resolving to the repl (whose scheduler drives quantize).
let repl = null;
Promise.resolve(
  initStrudel({
    // The acoustic map failing must not take down init (e.g. an old server
    // that doesn't serve /acoustic.json yet) — machine kits still work.
    prebake: () =>
      Promise.all([
        samples(SAMPLE_MAP_URL),
        samples(ACOUSTIC_MAP_URL).catch((err) => console.warn("acoustic sample map failed to load:", err)),
      ]),
  }),
).then(
  (r) => {
    repl = r;
    // A setCps may have arrived before init resolved. If an evaluate is queued
    // the swap callback decides by receipt order; with nothing queued apply now.
    if (state.lastCps !== null && !state.queued) {
      repl.setCps(state.lastCps);
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

function applyEvaluate(code, groove = null, seq = ++msgSeq) {
  // Warm the bank's samples immediately — by swap time (up to a bar away) the
  // fetches have had time to land, so the new kit's first hits don't drop.
  const bank = code.match(/\.bank\("(\w+)"\)/)?.[1] ?? null;
  if (bank) warmBank(bank);

  if (!state.armed || !repl) {
    state.queued = { code, groove, seq };
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
    // evaluate() is async — its setcpm applies when evaluation completes, so
    // any newer cps must be re-applied AFTER that, never synchronously here.
    const evalDone = Promise.resolve(repl.evaluate(code)).catch(() => {});
    state.playing = true;
    state.paused = false; // a fresh push implies intent to hear it (D-18)
    state.code = code;
    state.groove = groove; // grid swaps in the same beat as the audio (FR-2)
    state.tempo = code.match(/setcpm\(([\d.]+)\/4\)/)?.[1] ?? state.tempo;
    if (state.lastCps !== null && state.lastCpsSeq > seq) {
      // a setCps received AFTER this code postdates its setcpm — re-apply it
      // once the (async) evaluate lands, or the setcpm clobbers the tempo
      const cps = state.lastCps;
      evalDone.then(() => repl.setCps(cps));
      state.tempo = String(Math.round(cps * 240));
    } else {
      state.lastCps = null; // this code's setcpm supersedes any older setCps
    }
    state.bank = bank ?? state.bank;
    render();
    sendStatus();
  }, delayMs);
}

function flushQueued() {
  if (state.armed && repl && state.queued) {
    const { code, groove, seq } = state.queued;
    state.queued = null;
    applyEvaluate(code, groove, seq); // keep the RECEIPT seq, not flush time
  }
}

// NOTE: the global `hush` is the silence *pattern* function (it returns a
// Pattern and stops nothing) — repl.stop() is the real transport stop.
// NOTE: lastCps deliberately survives hush — the server's groove keeps its
// tempo across stop, so a local play-button restart must too.
function applyHush() {
  clearTimeout(state.pendingSwap);
  state.queued = null;
  repl?.stop();
  state.playing = false;
  state.paused = false; // a server stop clears any local pause (FR-6)
  render();
  sendStatus();
}

// ---- sample pre-warm: pull this bank's files into the HTTP cache so first
// triggers don't drop (superdough fetches lazily on first hit). Machine banks
// warm one file per drum; the Acoustic bank warms every velocity slot, since
// any hit's vel can select any of its 8 recordings.
let sampleMapPromise = null;
let acousticMapPromise = null;
const warmedBanks = new Set();
async function warmBank(bank) {
  if (warmedBanks.has(bank)) return;
  warmedBanks.add(bank);
  const acoustic = bank === ACOUSTIC_BANK;
  try {
    let map;
    if (acoustic) {
      acousticMapPromise ??= fetch(ACOUSTIC_MAP_URL).then((r) => r.json());
      map = await acousticMapPromise;
    } else {
      sampleMapPromise ??= fetch(SAMPLE_MAP_URL).then((r) => r.json());
      map = await sampleMapPromise;
    }
    const base = map._base ?? "";
    const urls = Object.entries(map)
      .filter(([k]) => k.startsWith(`${bank}_`))
      .flatMap(([, files]) => (Array.isArray(files) ? (acoustic ? files : files.slice(0, 1)) : [files]))
      .map((file) => base + file);
    await Promise.allSettled(urls.map((u) => fetch(u, { mode: "cors" })));
  } catch (err) {
    // allow a retry on the next push — a transient failure must not disable
    // pre-warm for this bank (or, via a cached rejected map promise, all banks)
    warmedBanks.delete(bank);
    if (acoustic) acousticMapPromise = null;
    else sampleMapPromise = null;
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
    if (msg.type === "evaluate") applyEvaluate(msg.code, msg.groove ?? null, ++msgSeq);
    else if (msg.type === "hush") applyHush();
    else if (msg.type === "setCps" && Number.isFinite(msg.cps) && msg.cps > 0) {
      if (repl) repl.setCps(msg.cps); // pre-init: applied on repl-resolve / after the queued evaluate
      state.lastCps = msg.cps;
      state.lastCpsSeq = ++msgSeq;
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
    const evalDone = Promise.resolve(repl.evaluate(state.code)).catch(() => {});
    // the code's setcpm may predate a set_tempo — re-apply the newer cps once
    // the (async) evaluate has finished, or its setcpm would clobber it
    if (state.lastCps !== null) {
      const cps = state.lastCps;
      evalDone.then(() => repl.setCps(cps));
    }
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

  // Count header (v1.5 FR-5): bar labels (multi-bar only) + the drummer's count.
  const header = countHeader(model.bars, model.resolution);
  if (model.bars > 1) {
    const barRow = document.createElement("div");
    barRow.className = "grid-row bar-row";
    barRow.style.setProperty("--steps", String(model.steps));
    barRow.appendChild(document.createElement("span"));
    for (let bar = 1; bar <= model.bars; bar++) {
      const barEl = document.createElement("div");
      barEl.className = "bar-title";
      barEl.style.gridColumn = `span ${model.resolution}`;
      barEl.textContent = `Bar ${bar}`;
      barRow.appendChild(barEl);
    }
    grid.appendChild(barRow);
  }
  const countRow = document.createElement("div");
  countRow.className = "grid-row count-row";
  countRow.style.setProperty("--steps", String(model.steps));
  countRow.appendChild(document.createElement("span"));
  header.forEach((c, i) => {
    const cellEl = document.createElement("div");
    let cls = "count-cell";
    if (i > 0 && c.barStart) cls += " barline";
    else if (i > 0 && c.beatStart) cls += " beat";
    if (c.beatStart) cls += " count-beat";
    cellEl.className = cls;
    cellEl.textContent = c.label;
    countRow.appendChild(cellEl);
  });
  grid.appendChild(countRow);

  for (const row of model.rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "grid-row";
    rowEl.style.setProperty("--steps", String(model.steps));
    const label = document.createElement("span");
    label.className = "grid-label";
    const name = document.createElement("span");
    name.className = "grid-name";
    name.textContent = row.label ?? row.drum;
    name.title = row.drum; // hover shows the abbreviation the LLM/tools use
    label.appendChild(name);
    // Track fader (v1.5 FR-3): position always reflects the broadcast groove;
    // sends on release (change), not while dragging (NFR-4).
    const vol = document.createElement("input");
    vol.type = "range";
    vol.min = "0";
    vol.max = "150";
    vol.value = String(Math.round((row.trackGain ?? 1) * 100));
    vol.className = "track-vol";
    vol.title = `${row.label ?? row.drum} volume: ${vol.value}%`;
    vol.dataset.drum = row.drum;
    label.appendChild(vol);
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
        cell.dataset.vel = String(vel);
      }
      cell.className = cls;
      cell.dataset.drum = row.drum;
      cell.dataset.step = String(i);
      rowEl.appendChild(cell);
      phCols[i].push(cell);
    });
    grid.appendChild(rowEl);
  }
}

// ---- grid zoom (v1.5 FR-7 addition): a pure view preference — scales the
// whole grid live via the --zoom CSS variable; never touches the groove.
// Persisted locally so the size survives reloads.
const ZOOM_KEY = "ai-drummer-zoom";
{
  const zoom = el("zoom");
  const saved = Number(localStorage.getItem(ZOOM_KEY));
  if (saved >= 70 && saved <= 220) {
    zoom.value = String(saved);
    el("grid").style.setProperty("--zoom", String(saved / 100));
  }
  zoom.addEventListener("input", () => {
    el("grid").style.setProperty("--zoom", String(Number(zoom.value) / 100));
    localStorage.setItem(ZOOM_KEY, zoom.value);
  });
}

// ---- track faders (v1.5 FR-3): a slider release is a request, like a click —
// the server merges setTrackGain and the next broadcast repositions the slider.
el("grid").addEventListener("change", (event) => {
  const slider = event.target.closest?.(".track-vol");
  if (!slider || !slider.dataset.drum) return;
  if (ws?.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify({ type: "setTrackGain", drum: slider.dataset.drum, gain: Number(slider.value) / 100 }),
  );
});

// ---- grid click-editing (v1.2 FR-5, v1.5 cycle semantics D-36): a click is a
// *request* — the server owns the groove, cycles the cell (off → normal →
// STRESS → ghost → off), and broadcasts the result. The cell shows the
// optimistic next tier instantly; the next broadcast is authoritative.
el("grid").addEventListener("click", (event) => {
  const cell = event.target.closest?.(".grid-cell");
  if (!cell || !cell.dataset.drum) return;
  if (ws?.readyState !== WebSocket.OPEN) return; // no server, no edit
  ws.send(
    JSON.stringify({ type: "cycleStep", drum: cell.dataset.drum, step: Number(cell.dataset.step) }),
  );
  const current = cell.dataset.vel ? Number(cell.dataset.vel) : null;
  const next = cycleNext(current);
  if (next === null) {
    cell.classList.remove("hit");
    cell.style.removeProperty("--vel");
    delete cell.dataset.vel;
  } else {
    cell.classList.add("hit");
    cell.style.setProperty("--vel", String(0.25 + 0.75 * next));
    cell.dataset.vel = String(next);
  }
});

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
window.__ai = { state, getRepl: () => repl, getPlayheadStep: () => phLast, getWs: () => ws };
