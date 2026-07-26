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

  it("returns 400 for malformed percent-encoding instead of crashing", async () => {
    const s = await start();
    const res = await fetch(`http://127.0.0.1:${PORT}/%`);
    expect(res.status).toBe(400);
    // server must still be alive
    expect((await fetch(`http://127.0.0.1:${PORT}/`)).status).toBe(200);
  });

  it("replays hush (not the stale groove) to a page that reconnects after stop", async () => {
    const s = await start();
    s.push({ type: "evaluate", code: '$: s("bd")' });
    s.push({ type: "hush" });
    const client = await connect(PORT);
    expect(await client.next()).toEqual({ type: "hush" });
    client.ws.close();
  });

  it("replays the last setCps after the evaluate to a late-joining page", async () => {
    const s = await start();
    s.push({ type: "evaluate", code: '$: s("bd")' });
    s.push({ type: "setCps", cps: 0.4 });
    const client = await connect(PORT);
    expect(await client.next()).toEqual({ type: "evaluate", code: '$: s("bd")' });
    expect(await client.next()).toEqual({ type: "setCps", cps: 0.4 });
    client.ws.close();
  });

  it("setLastEvaluate updates the replay without broadcasting and clears a stale setCps", async () => {
    const s = await start();
    const live = await connect(PORT);
    s.push({ type: "evaluate", code: 'setcpm(96/4)\n$: s("bd")' });
    s.push({ type: "setCps", cps: 0.5 });
    expect(await live.next()).toMatchObject({ type: "evaluate" });
    expect(await live.next()).toEqual({ type: "setCps", cps: 0.5 });
    s.setLastEvaluate('setcpm(120/4)\n$: s("bd")');
    // No broadcast to the live page…
    const race = await Promise.race([
      live.next(),
      new Promise((r) => setTimeout(() => r("nothing"), 150)),
    ]);
    expect(race).toBe("nothing");
    // …but a reconnecting page replays the fresh code with no stale setCps.
    const rejoiner = await connect(PORT);
    expect(await rejoiner.next()).toEqual({ type: "evaluate", code: 'setcpm(120/4)\n$: s("bd")' });
    const race2 = await Promise.race([
      rejoiner.next(),
      new Promise((r) => setTimeout(() => r("nothing"), 150)),
    ]);
    expect(race2).toBe("nothing");
    live.ws.close();
    rejoiner.ws.close();
  });

  it("delivers and replays the groove payload alongside the code (v1.1 FR-1)", async () => {
    const s = await start();
    const groove = {
      tempoBpm: 96,
      swing: 0,
      bank: "RolandTR808",
      bars: 1,
      resolution: 16,
      voices: [{ drum: "bd", hits: [{ step: 0, vel: 1, micro: 0 }] }],
    };
    const live = await connect(PORT);
    s.push({ type: "evaluate", code: '$: s("bd")', groove });
    expect(await live.next()).toEqual({ type: "evaluate", code: '$: s("bd")', groove });
    // late joiner gets the groove in the replay too
    const rejoiner = await connect(PORT);
    expect(await rejoiner.next()).toEqual({ type: "evaluate", code: '$: s("bd")', groove });
    live.ws.close();
    rejoiner.ws.close();
  });

  it("setLastEvaluate updates the replayed groove alongside the code (v1.1 FR-1)", async () => {
    const s = await start();
    const groove = { tempoBpm: 120, bank: "LinnDrum", voices: [] };
    s.push({ type: "evaluate", code: 'setcpm(96/4)\n$: s("bd")' });
    s.setLastEvaluate('setcpm(120/4)\n$: s("bd")', groove);
    const client = await connect(PORT);
    expect(await client.next()).toEqual({
      type: "evaluate",
      code: 'setcpm(120/4)\n$: s("bd")',
      groove,
    });
    client.ws.close();
  });

  it("a new evaluate clears any superseded setCps from the replay", async () => {
    const s = await start();
    s.push({ type: "setCps", cps: 0.4 });
    s.push({ type: "evaluate", code: '$: s("sd")' });
    const client = await connect(PORT);
    expect(await client.next()).toEqual({ type: "evaluate", code: '$: s("sd")' });
    // no trailing setCps — the evaluate's own setcpm is authoritative
    const race = await Promise.race([
      client.next(),
      new Promise((r) => setTimeout(() => r("nothing"), 150)),
    ]);
    expect(race).toBe("nothing");
    client.ws.close();
  });

  it("clears lastStatus when the last page disconnects", async () => {
    const s = await start();
    const { ws } = await connect(PORT);
    ws.send(JSON.stringify({ type: "status", playing: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(s.lastStatus()).toMatchObject({ playing: true });
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(s.lastStatus()).toBeNull();
  });

  it("treats a page as disconnected once its heartbeats go stale (half-open socket)", async () => {
    const s = await startSidecar({ port: PORT, heartbeatFreshMs: 120 });
    sidecars.push(s);
    const { ws } = await connect(PORT);
    ws.send(JSON.stringify({ type: "status", playing: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(s.pageConnected()).toBe(true);
    // Socket stays open but heartbeats stop — e.g. a sleeping laptop's half-open TCP.
    await new Promise((r) => setTimeout(r, 250));
    expect(s.pageConnected()).toBe(false);
    // A fresh heartbeat revives it.
    ws.send(JSON.stringify({ type: "status", playing: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(s.pageConnected()).toBe(true);
    ws.close();
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
