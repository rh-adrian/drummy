import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { Groove } from "../core/groove.js";

// HTTP + WebSocket sidecar: serves the Strudel page and pushes pattern code to
// it. Lives in the same process as the MCP server (M3) — all logging must go
// to stderr, never stdout (NFR-2: stdout carries JSON-RPC).

export const DEFAULT_PORT = 4747;

/** Server → page messages. `groove` (the parsed groove JSON) drives the page's
 * step grid; old pages ignore it (v1.1 FR-1, additive). */
export type SidecarPush =
  | { type: "evaluate"; code: string; groove?: Groove; origin?: "page" | "llm" }
  | { type: "hush" }
  | { type: "setCps"; cps: number };
// evaluate.origin (v1.6 FR-6): "page" = a human edit bounced back — a paused
// page applies it silently. Absent/"llm" = the model changed the music, which
// un-pauses (v1.1 D-18).

/** Page → server heartbeat. */
export interface PageStatus {
  type: "status";
  [key: string]: unknown;
}

/** Page → server edit requests: cell cycle (v1.2/v1.5), track fader (v1.5),
 * mute/clear/tempo/undo (v1.6). */
export type PageEdit =
  | { kind: "cycleStep"; drum: string; step: number }
  | { kind: "setTrackGain"; drum: string; gain: number }
  | { kind: "muteTrack"; drum: string }
  | { kind: "clearTrack"; drum: string }
  | { kind: "setTempo"; bpm: number }
  | { kind: "setFillsEnabled"; enabled: boolean }
  | { kind: "undo" };

export interface Sidecar {
  port: number;
  url: string;
  /** Broadcast to all connected pages; the last evaluate is replayed to late joiners. */
  push(msg: SidecarPush): void;
  /**
   * Update the replayed evaluate WITHOUT broadcasting — for changes already
   * delivered live another way (set_tempo pushes setCps to running pages, but
   * a reloading page must replay code with the new setcpm, not the stale one).
   */
  setLastEvaluate(code: string, groove?: Groove): void;
  /** True while at least one page has sent a status heartbeat recently (guards against half-open sockets). */
  pageConnected(): boolean;
  lastStatus(): PageStatus | null;
  /** Register the handler for page grid-edit requests (last registration wins). */
  onEdit(handler: (edit: PageEdit) => void): void;
  close(): Promise<void>;
}

// Pages heartbeat every 2s; three missed beats + slack means the socket is
// half-open (sleeping laptop, killed tab) even if TCP hasn't noticed yet.
export const HEARTBEAT_FRESH_MS = 7000;

export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AI_DRUMMER_PORT;
  if (!raw) return DEFAULT_PORT;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`AI_DRUMMER_PORT must be a port number, got "${raw}"`);
  }
  return port;
}

const PAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../page");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let urlPath: string;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    // malformed percent-encoding (e.g. GET /%) — must not escape the handler
    res.writeHead(400, { connection: "close" }).end("bad request");
    return;
  }
  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const file = path.resolve(PAGE_DIR, rel);
  const ext = path.extname(file);
  // "connection: close" keeps client pools (and tests) from reusing sockets
  // across sidecar restarts; this is a one-viewer local page, not a web server.
  if (!file.startsWith(PAGE_DIR + path.sep) || !MIME[ext]) {
    res.writeHead(404, { connection: "close" }).end("not found");
    return;
  }
  try {
    const body = await readFile(file);
    res
      .writeHead(200, {
        "content-type": MIME[ext],
        "cache-control": "no-store",
        connection: "close",
      })
      .end(body);
  } catch {
    res.writeHead(404, { connection: "close" }).end("not found");
  }
}

export async function startSidecar(
  opts: { port?: number; heartbeatFreshMs?: number } = {},
): Promise<Sidecar> {
  const port = opts.port ?? resolvePort();
  const heartbeatFreshMs = opts.heartbeatFreshMs ?? HEARTBEAT_FRESH_MS;

  const server = createServer((req, res) => {
    serveStatic(req, res).catch((err) => {
      console.error("[sidecar] static handler error:", err);
      try {
        res.writeHead(500, { connection: "close" }).end();
      } catch {
        /* headers already sent */
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `AI drummer sidecar port ${port} is already in use — likely another ` +
              `ai-drummer session. Stop it, or set AI_DRUMMER_PORT to a free port.`,
          ),
        );
      } else {
        reject(err);
      }
    });
    server.listen(port, () => resolve());
  });

  // Attach WS only after listen succeeds: ws re-emits the HTTP server's errors
  // on the WebSocketServer, which would turn a handled EADDRINUSE into an
  // uncaught exception.
  const wss = new WebSocketServer({ server, path: "/ws" });

  // Post-listen errors must not become uncaught 'error' event crashes.
  server.on("error", (err) => console.error("[sidecar] server error:", err));
  wss.on("error", (err) => console.error("[sidecar] ws error:", err));

  // Transport state replayed to (re)connecting pages, so a page that drops and
  // reconnects converges instead of playing a stale groove or missing a stop.
  let lastEvaluate: SidecarPush | null = null;
  let lastCps: SidecarPush | null = null; // a setCps issued after lastEvaluate
  let hushed = false;
  let lastStatus: PageStatus | null = null;
  let editHandler: ((edit: PageEdit) => void) | null = null;
  const pageSockets = new Map<WebSocket, number>(); // socket → last heartbeat time

  wss.on("connection", (ws) => {
    if (hushed) ws.send(JSON.stringify({ type: "hush" }));
    if (lastEvaluate) ws.send(JSON.stringify(lastEvaluate));
    if (lastCps) ws.send(JSON.stringify(lastCps));
    ws.on("message", (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return; // ignore malformed frames
      }
      if (msg && typeof msg === "object" && (msg as PageStatus).type === "status") {
        lastStatus = msg as PageStatus;
        pageSockets.set(ws, Date.now());
      } else if (msg && typeof msg === "object") {
        const { type, drum, step, gain } = msg as { type?: unknown; drum?: unknown; step?: unknown; gain?: unknown };
        // "toggleStep" is the pre-v1.5 page's name for a cell click; it gets
        // cycle semantics now (D-36) so stale tabs keep working.
        if ((type === "cycleStep" || type === "toggleStep") && typeof drum === "string" && typeof step === "number") {
          editHandler?.({ kind: "cycleStep", drum, step });
        } else if (type === "setTrackGain" && typeof drum === "string" && typeof gain === "number") {
          editHandler?.({ kind: "setTrackGain", drum, gain });
        } else if ((type === "muteTrack" || type === "clearTrack") && typeof drum === "string") {
          editHandler?.({ kind: type, drum });
        } else if (type === "setTempo" && typeof (msg as { bpm?: unknown }).bpm === "number") {
          editHandler?.({ kind: "setTempo", bpm: (msg as { bpm: number }).bpm });
        } else if (type === "setFills" && typeof (msg as { enabled?: unknown }).enabled === "boolean") {
          editHandler?.({ kind: "setFillsEnabled", enabled: (msg as { enabled: boolean }).enabled });
        } else if (type === "undo") {
          editHandler?.({ kind: "undo" });
        }
      }
    });
    ws.on("close", () => {
      pageSockets.delete(ws);
      if (pageSockets.size === 0) lastStatus = null;
    });
  });

  return {
    port,
    url: `http://localhost:${port}`,
    push(msg) {
      if (msg.type === "evaluate") {
        lastEvaluate = msg;
        lastCps = null; // the evaluate's own setcpm is authoritative again
        hushed = false;
      } else if (msg.type === "setCps") {
        lastCps = msg;
      } else if (msg.type === "hush") {
        lastEvaluate = null;
        lastCps = null;
        hushed = true;
      }
      const data = JSON.stringify(msg);
      for (const ws of wss.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    },
    setLastEvaluate(code, groove) {
      lastEvaluate = { type: "evaluate", code, ...(groove ? { groove } : {}) };
      lastCps = null;
      hushed = false;
    },
    pageConnected() {
      const now = Date.now();
      for (const [ws, lastBeat] of pageSockets) {
        if (ws.readyState === WebSocket.OPEN && now - lastBeat <= heartbeatFreshMs) return true;
      }
      return false;
    },
    lastStatus() {
      return lastStatus;
    },
    onEdit(handler) {
      editHandler = handler;
    },
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
