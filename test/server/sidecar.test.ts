import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { startSidecar, type Sidecar } from "../../src/server/sidecar.js";

// Ports in the ephemeral range, one per concern, so parallel test files can't collide.
const PORT = 4787;

let sidecars: Sidecar[] = [];

async function start(port = PORT): Promise<Sidecar> {
  const s = await startSidecar({ port });
  sidecars.push(s);
  return s;
}

afterEach(async () => {
  for (const s of sidecars) await s.close();
  sidecars = [];
});

interface Client {
  ws: WebSocket;
  /** Resolves with the next message, including any received before this call. */
  next(): Promise<unknown>;
}

// Buffer messages from the moment the socket is created — a replayed frame can
// arrive in the same tick as "open", before a later-attached listener exists.
function connect(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const queue: unknown[] = [];
    const waiters: Array<(msg: unknown) => void> = [];
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      const waiter = waiters.shift();
      waiter ? waiter(msg) : queue.push(msg);
    });
    ws.on("error", reject);
    ws.on("open", () =>
      resolve({
        ws,
        next: () =>
          queue.length
            ? Promise.resolve(queue.shift())
            : new Promise((r) => waiters.push(r)),
      }),
    );
  });
}

describe("startSidecar", () => {
  it("serves the page HTML at /", async () => {
    const s = await start();
    const res = await fetch(`http://127.0.0.1:${PORT}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("AI Drummer");
  });

  it("serves page assets with correct content types", async () => {
    const s = await start();
    const js = await fetch(`http://127.0.0.1:${PORT}/main.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    const quantize = await fetch(`http://127.0.0.1:${PORT}/quantize.js`);
    expect(quantize.status).toBe(200);
  });

  it("404s unknown paths without directory traversal", async () => {
    const s = await start();
    expect((await fetch(`http://127.0.0.1:${PORT}/nope.js`)).status).toBe(404);
    expect(
      (await fetch(`http://127.0.0.1:${PORT}/..%2f..%2fpackage.json`)).status,
    ).toBe(404);
  });

  it("delivers pushed evaluate payloads to connected WS clients", async () => {
    const s = await start();
    const client = await connect(PORT);
    s.push({ type: "evaluate", code: 'setcpm(120/4)\n$: s("bd*4")' });
    expect(await client.next()).toEqual({
      type: "evaluate",
      code: 'setcpm(120/4)\n$: s("bd*4")',
    });
    client.ws.close();
  });

  it("replays the last evaluate to a client that connects late", async () => {
    const s = await start();
    s.push({ type: "evaluate", code: "$: s(\"bd\")" });
    const client = await connect(PORT);
    expect(await client.next()).toEqual({ type: "evaluate", code: "$: s(\"bd\")" });
    client.ws.close();
  });

  it("tracks page connection status from client status messages", async () => {
    const s = await start();
    expect(s.pageConnected()).toBe(false);
    const { ws } = await connect(PORT);
    ws.send(JSON.stringify({ type: "status", playing: false }));
    await new Promise((r) => setTimeout(r, 50));
    expect(s.pageConnected()).toBe(true);
    expect(s.lastStatus()).toMatchObject({ playing: false });
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(s.pageConnected()).toBe(false);
  });

  it("rejects with an actionable error when the port is in use", async () => {
    const s = await start();
    await expect(startSidecar({ port: PORT })).rejects.toThrow(
      new RegExp(`port ${PORT}.*in use`, "i"),
    );
  });

  it("close() frees the port and terminates WS clients", async () => {
    const s = await start();
    const { ws } = await connect(PORT);
    const closed = new Promise((r) => ws.on("close", r));
    await s.close();
    await closed;
    // Port is free again.
    const s2 = await start();
    expect((await fetch(`http://127.0.0.1:${PORT}/`)).status).toBe(200);
  });

  it("respects AI_DRUMMER_PORT via the port option default", async () => {
    const s = await start(4799);
    expect(s.port).toBe(4799);
    expect(s.url).toBe("http://localhost:4799");
    const res = await fetch(`http://127.0.0.1:4799/`);
    expect(res.status).toBe(200);
  });
});
