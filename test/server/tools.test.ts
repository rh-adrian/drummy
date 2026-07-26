import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createDrummerServer, type SidecarHandle } from "../../src/server/tools.js";
import type { PageStatus, SidecarPush } from "../../src/server/sidecar.js";

// M3 integration tests: real MCP client ↔ server over the SDK's in-memory
// transport, with the sidecar mocked so no ports or browsers are involved.

interface MockSidecar extends SidecarHandle {
  pushes: SidecarPush[];
  connected: boolean;
  replayCode: string | null;
  replayGroove: unknown;
}

function mockSidecar(): MockSidecar {
  const self: MockSidecar = {
    port: 4747,
    url: "http://localhost:4747",
    pushes: [],
    connected: true,
    replayCode: null,
    replayGroove: null,
    push(msg: SidecarPush) {
      self.pushes.push(msg);
      if (msg.type === "evaluate") {
        self.replayCode = msg.code;
        self.replayGroove = msg.groove ?? null;
      }
      if (msg.type === "hush") {
        self.replayCode = null;
        self.replayGroove = null;
      }
    },
    setLastEvaluate(code: string, groove?: unknown) {
      self.replayCode = code;
      self.replayGroove = groove ?? null;
    },
    pageConnected() {
      return self.connected;
    },
    lastStatus(): PageStatus | null {
      return self.connected ? { type: "status", armed: true } : null;
    },
  };
  return self;
}

const FAKE_SAMPLE_MAP: Record<string, unknown> = {
  _base: "https://example.com/",
  RolandTR808_bd: ["a.wav"],
  RolandTR808_sd: ["a.wav"],
  RolandTR808_hh: ["a.wav"],
  LinnDrum_bd: ["a.wav"],
  LinnDrum_sd: ["a.wav"],
};

async function setup(opts: { sidecar?: Parameters<typeof createDrummerServer>[0] } = {}) {
  const sidecar = mockSidecar();
  const server = createDrummerServer(opts.sidecar ?? sidecar, {
    fetchSampleMap: async () => FAKE_SAMPLE_MAP,
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, sidecar, server };
}

function text(result: unknown): string {
  const r = result as CallToolResult;
  return r.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("\n");
}

const GROOVE = {
  tempoBpm: 96,
  swing: 0,
  bank: "RolandTR909",
  voices: [
    { drum: "bd", hits: [{ step: 0 }, { step: 4 }, { step: 8 }, { step: 12 }] },
    { drum: "sd", hits: [{ step: 4 }, { step: 12, vel: 0.95 }] },
    { drum: "hh", hits: [{ step: 0, vel: 0.7 }, { step: 2, vel: 0.5 }] },
  ],
};

describe("play_groove", () => {
  it("compiles and pushes the groove, and reports what is playing", async () => {
    const { client, sidecar } = await setup();
    const res = (await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain("96");
    expect(text(res)).toContain("RolandTR909");
    expect(sidecar.pushes).toHaveLength(1);
    const push = sidecar.pushes[0];
    expect(push.type).toBe("evaluate");
    if (push.type === "evaluate") {
      expect(push.code).toContain("setcpm(96/4)");
      expect(push.code).toContain('.bank("RolandTR909")');
    }
  });

  it("pushes the parsed groove JSON alongside the code (v1.1 FR-1)", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    const push = sidecar.pushes[0];
    expect(push.type).toBe("evaluate");
    if (push.type === "evaluate") {
      const g = push.groove as Record<string, unknown>;
      expect(g).toBeTruthy();
      expect(g.tempoBpm).toBe(96);
      expect(g.bank).toBe("RolandTR909");
      // parsed groove, defaults applied — not the raw input
      expect(g.bars).toBe(1);
      expect(g.resolution).toBe(16);
      expect((g.voices as unknown[]).length).toBe(3);
    }
  });

  it("returns isError with the validation message for an invalid groove", async () => {
    const { client, sidecar } = await setup();
    const bad = { ...GROOVE, voices: [{ drum: "kick", hits: [{ step: 0 }] }] };
    const res = (await client.callTool({ name: "play_groove", arguments: { groove: bad } })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("bd"); // lists valid drums
    expect(sidecar.pushes).toHaveLength(0);
  });

  it("routes missing required fields through parseGroove, not protocol validation", async () => {
    const { client } = await setup();
    const noTempo = { bank: "RolandTR808", voices: [{ drum: "bd", hits: [{ step: 0 }] }] };
    const res = (await client.callTool({ name: "play_groove", arguments: { groove: noTempo } })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("Invalid groove"); // curated message, not a zod JSON dump
    expect(text(res)).not.toContain("-32602");
  });

  it("returns isError naming the page URL when no page is connected", async () => {
    const { client, sidecar } = await setup();
    sidecar.connected = false;
    const res = (await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("http://localhost:4747");
    expect(sidecar.pushes).toHaveLength(0);
  });

  it("replaces a playing groove", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    const second = { ...GROOVE, tempoBpm: 120 };
    const res = (await client.callTool({ name: "play_groove", arguments: { groove: second } })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(sidecar.pushes).toHaveLength(2);
    const np = JSON.parse(text(await client.callTool({ name: "now_playing", arguments: {} })));
    expect(np.tempoBpm).toBe(120);
  });
});

describe("update_groove", () => {
  it("errors when nothing is playing", async () => {
    const { client } = await setup();
    const res = (await client.callTool({ name: "update_groove", arguments: { tempoBpm: 110 } })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("play_groove");
  });

  it("replaces a voice by drum and keeps the others", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    const res = (await client.callTool({
      name: "update_groove",
      arguments: { voices: [{ drum: "hh", hits: Array.from({ length: 16 }, (_, i) => ({ step: i, vel: 0.6 })) }] },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    const push = sidecar.pushes[1];
    if (push.type === "evaluate") {
      // 16 hats now; kick voice untouched
      expect(push.code.match(/hh/g)!.length).toBeGreaterThanOrEqual(16);
      expect(push.code).toContain("bd");
      // merged groove rides along for the grid (v1.1 FR-1)
      const g = push.groove as { voices: Array<{ drum: string; hits: unknown[] }> };
      expect(g.voices.find((v) => v.drum === "hh")?.hits).toHaveLength(16);
    }
    const np = JSON.parse(text(await client.callTool({ name: "now_playing", arguments: {} })));
    expect(np.groove.voices.find((v: { drum: string }) => v.drum === "hh").hits).toHaveLength(16);
    expect(np.groove.voices).toHaveLength(3);
  });

  it("adds a new voice, removes named drums, and updates scalars", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    const res = (await client.callTool({
      name: "update_groove",
      arguments: {
        tempoBpm: 104,
        swing: 0.2,
        voices: [{ drum: "oh", hits: [{ step: 14, vel: 0.8 }] }],
        removeDrums: ["sd"],
      },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    const np = JSON.parse(text(await client.callTool({ name: "now_playing", arguments: {} })));
    expect(np.tempoBpm).toBe(104);
    expect(np.groove.swing).toBe(0.2);
    const drums = np.groove.voices.map((v: { drum: string }) => v.drum).sort();
    expect(drums).toEqual(["bd", "hh", "oh"]);
    const push = sidecar.pushes[1];
    if (push.type === "evaluate") expect(push.code).toContain("setcpm(104/4)");
  });

  it("rejects a drum listed in both voices and removeDrums", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    const res = (await client.callTool({
      name: "update_groove",
      arguments: { voices: [{ drum: "hh", hits: [{ step: 0 }] }], removeDrums: ["hh"] },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("hh");
    expect(sidecar.pushes).toHaveLength(1);
  });

  it("rejects an empty update (e.g. args mistakenly nested under groove)", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    const res = (await client.callTool({
      name: "update_groove",
      arguments: { groove: { tempoBpm: 120 } }, // unknown key is stripped → no edits
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("top level");
    expect(sidecar.pushes).toHaveLength(1);
  });

  it("rejects an update that would leave the groove invalid", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    const res = (await client.callTool({
      name: "update_groove",
      arguments: { removeDrums: ["bd", "sd", "hh"] },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(sidecar.pushes).toHaveLength(1); // no push for the bad update
    // state unchanged
    const np = JSON.parse(text(await client.callTool({ name: "now_playing", arguments: {} })));
    expect(np.groove.voices).toHaveLength(3);
  });
});

describe("set_tempo", () => {
  it("pushes setCps and updates state without re-evaluating", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    const res = (await client.callTool({ name: "set_tempo", arguments: { bpm: 120 } })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(sidecar.pushes).toHaveLength(2);
    const push = sidecar.pushes[1];
    expect(push.type).toBe("setCps");
    if (push.type === "setCps") expect(push.cps).toBeCloseTo(0.5, 6); // 120 BPM / 240
    const np = JSON.parse(text(await client.callTool({ name: "now_playing", arguments: {} })));
    expect(np.tempoBpm).toBe(120);
  });

  it("updates the replayed evaluate so a reloading page gets the new tempo", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    await client.callTool({ name: "set_tempo", arguments: { bpm: 120 } });
    expect(sidecar.replayCode).toContain("setcpm(120/4)");
    // …and the replayed groove for the grid stays coherent too (v1.1 FR-1)
    expect((sidecar.replayGroove as { tempoBpm: number }).tempoBpm).toBe(120);
  });

  it("rejects out-of-range tempo and errors when nothing is playing", async () => {
    const { client } = await setup();
    const idle = (await client.callTool({ name: "set_tempo", arguments: { bpm: 120 } })) as CallToolResult;
    expect(idle.isError).toBe(true);
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    const res = (await client.callTool({ name: "set_tempo", arguments: { bpm: 500 } })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("300");
  });
});

describe("set_kit", () => {
  it("recompiles the current groove on the new bank", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    const res = (await client.callTool({ name: "set_kit", arguments: { bank: "LinnDrum" } })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    const push = sidecar.pushes[1];
    expect(push.type).toBe("evaluate");
    if (push.type === "evaluate") {
      expect(push.code).toContain('.bank("LinnDrum")');
      expect((push.groove as { bank: string }).bank).toBe("LinnDrum"); // v1.1 FR-1
    }
    const np = JSON.parse(text(await client.callTool({ name: "now_playing", arguments: {} })));
    expect(np.bank).toBe("LinnDrum");
  });

  it("rejects an unknown bank, listing valid ones", async () => {
    const { client } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    const res = (await client.callTool({ name: "set_kit", arguments: { bank: "Casiotone" } })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("RolandTR808");
  });
});

describe("stop / restart", () => {
  it("pushes hush, reports stopped, and is idempotent", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    const res = (await client.callTool({ name: "stop", arguments: {} })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(sidecar.pushes[1]).toEqual({ type: "hush" });
    const np = JSON.parse(text(await client.callTool({ name: "now_playing", arguments: {} })));
    expect(np.playing).toBe(false);
    const again = (await client.callTool({ name: "stop", arguments: {} })) as CallToolResult;
    expect(again.isError).toBeFalsy();
  });

  it("stop works even when the page is disconnected (clears replay state)", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    sidecar.connected = false; // tab closed mid-jam
    const res = (await client.callTool({ name: "stop", arguments: {} })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(sidecar.pushes[1]).toEqual({ type: "hush" });
    expect(sidecar.replayCode).toBeNull(); // a page opened later stays silent
  });

  it("play_groove after stop starts clean", async () => {
    const { client, sidecar } = await setup();
    await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } });
    await client.callTool({ name: "stop", arguments: {} });
    const res = (await client.callTool({ name: "play_groove", arguments: { groove: GROOVE } })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(sidecar.pushes.map((p) => p.type)).toEqual(["evaluate", "hush", "evaluate"]);
    const np = JSON.parse(text(await client.callTool({ name: "now_playing", arguments: {} })));
    expect(np.playing).toBe(true);
  });
});

describe("now_playing", () => {
  it("reflects idle state and page connectivity", async () => {
    const { client, sidecar } = await setup();
    sidecar.connected = false;
    const np = JSON.parse(text(await client.callTool({ name: "now_playing", arguments: {} })));
    expect(np.playing).toBe(false);
    expect(np.pageConnected).toBe(false);
    expect(np.pageUrl).toBe("http://localhost:4747");
    expect(np.groove).toBeNull();
  });
});

describe("list_kits", () => {
  it("lists banks with descriptions and per-bank drum availability", async () => {
    const { client } = await setup();
    const out = text(await client.callTool({ name: "list_kits", arguments: {} }));
    expect(out).toContain("RolandTR808");
    expect(out).toContain("hip-hop");
    // availability from the (fake) sample map: 808 has bd/sd/hh, Linn only bd/sd
    expect(out).toMatch(/RolandTR808.*\bbd, sd, hh\b/s);
    expect(out).not.toMatch(/LinnDrum[^\n]*\bhh\b/);
  });

  it("still lists banks when the sample map fetch fails", async () => {
    const sidecar = mockSidecar();
    const server = createDrummerServer(sidecar, {
      fetchSampleMap: async () => {
        throw new Error("offline");
      },
    });
    const client = new Client({ name: "t", version: "0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    const out = text(await client.callTool({ name: "list_kits", arguments: {} }));
    expect(out).toContain("RolandTR808");
    expect(out).toContain("LinnDrum");
  });
});

describe("tool metadata (FR-10, D-14)", () => {
  it("marks list_kits and now_playing read-only and teaches groove authoring", async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([
      "list_kits",
      "now_playing",
      "play_groove",
      "set_kit",
      "set_tempo",
      "stop",
      "update_groove",
    ]);
    expect(byName.list_kits.annotations?.readOnlyHint).toBe(true);
    expect(byName.now_playing.annotations?.readOnlyHint).toBe(true);
    const desc = byName.play_groove.description ?? "";
    expect(desc).toContain("ghost"); // velocity conventions
    expect(desc).toMatch(/resolution.*16|16.*resolution/is); // D-14 swing guidance
    expect(desc).toContain("swing");
  });
});

describe("sidecar unavailable (port collision)", () => {
  it("fails tools with the actionable port message", async () => {
    const message =
      "AI drummer sidecar port 4747 is already in use — likely another ai-drummer session. " +
      "Stop it, or set AI_DRUMMER_PORT to a free port.";
    const server = createDrummerServer({ unavailableError: message });
    const client = new Client({ name: "t", version: "0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    const calls: Array<[string, Record<string, unknown>]> = [
      ["play_groove", { groove: GROOVE }],
      ["set_tempo", { bpm: 100 }],
      ["stop", {}],
      ["now_playing", {}],
      ["list_kits", {}],
    ];
    for (const [name, args] of calls) {
      const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
      expect(res.isError).toBe(true);
      expect(text(res)).toContain("4747");
    }
  });
});

describe("stdio hygiene (NFR-2)", () => {
  it("no src file writes to stdout via console.log", async () => {
    const srcDir = path.resolve(__dirname, "../../src");
    const files: string[] = [];
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    }
    await walk(srcDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = await readFile(file, "utf8");
      expect(content, `${file} must not write to stdout (it carries JSON-RPC)`).not.toMatch(
        /console\.(log|info|debug)\(|process\.stdout\.write/,
      );
    }
  });
});
