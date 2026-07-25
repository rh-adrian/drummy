import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";

// HTTP + WebSocket sidecar: serves the Strudel page and pushes pattern code to
// it. Lives in the same process as the MCP server (M3) — all logging must go
// to stderr, never stdout (NFR-2: stdout carries JSON-RPC).

export const DEFAULT_PORT = 4747;

/** Server → page messages. */
export type SidecarPush =
  | { type: "evaluate"; code: string }
  | { type: "hush" }
  | { type: "setCps"; cps: number };

/** Page → server heartbeat. */
export interface PageStatus {
  type: "status";
  [key: string]: unknown;
}

export interface Sidecar {
  port: number;
  url: string;
  /** Broadcast to all connected pages; the last evaluate is replayed to late joiners. */
  push(msg: SidecarPush): void;
  /** True while at least one page that has sent a status heartbeat is connected. */
  pageConnected(): boolean;
  lastStatus(): PageStatus | null;
  close(): Promise<void>;
}

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
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
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

export async function startSidecar(opts: { port?: number } = {}): Promise<Sidecar> {
  const port = opts.port ?? resolvePort();

  const server = createServer((req, res) => {
    void serveStatic(req, res);
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

  let lastEvaluate: SidecarPush | null = null;
  let lastStatus: PageStatus | null = null;
  const pageSockets = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    if (lastEvaluate) ws.send(JSON.stringify(lastEvaluate));
    ws.on("message", (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return; // ignore malformed frames
      }
      if (msg && typeof msg === "object" && (msg as PageStatus).type === "status") {
        lastStatus = msg as PageStatus;
        pageSockets.add(ws);
      }
    });
    ws.on("close", () => pageSockets.delete(ws));
  });

  return {
    port,
    url: `http://localhost:${port}`,
    push(msg) {
      if (msg.type === "evaluate") lastEvaluate = msg;
      if (msg.type === "hush") lastEvaluate = null;
      const data = JSON.stringify(msg);
      for (const ws of wss.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    },
    pageConnected() {
      for (const ws of pageSockets) {
        if (ws.readyState === WebSocket.OPEN) return true;
      }
      return false;
    },
    lastStatus() {
      return lastStatus;
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
