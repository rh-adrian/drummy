#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startSidecar, type Sidecar } from "./server/sidecar.js";
import { createDrummerServer, type SidecarUnavailable } from "./server/tools.js";

// Entry point: stdio MCP server + HTTP/WS sidecar in one process.
// stdout carries JSON-RPC (NFR-2) — all logging goes to stderr.

async function main(): Promise<void> {
  let sidecar: Sidecar | SidecarUnavailable;
  try {
    sidecar = await startSidecar();
  } catch (e) {
    // Port collision (second session) must not kill the MCP server — the tools
    // surface the error so the LLM can relay it (NFR-3).
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[ai-drummer] ${message}`);
    sidecar = { unavailableError: message };
  }

  const server = createDrummerServer(sidecar);

  const shutdown = (code: number) => {
    const closing = "unavailableError" in sidecar ? Promise.resolve() : sidecar.close();
    void closing.finally(() => process.exit(code));
  };

  // NFR-3: transport closed (MCP client exited) → tear down the sidecar; no
  // orphaned ports or processes.
  server.server.onclose = () => shutdown(0);
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  await server.connect(new StdioServerTransport());
  if (!("unavailableError" in sidecar)) {
    console.error(`[ai-drummer] ready — open ${sidecar.url} and click Start to enable audio`);
  }
}

main().catch((err) => {
  console.error("[ai-drummer] fatal:", err);
  process.exit(1);
});
