// PROTOTYPE (issue #7) — throwaway. Prints the tool list exactly as a calling AI
// sees it (descriptions + input schemas), so the blind transcription agents get
// drummy's real manual and nothing else.
//
//   npx tsx prototypes/song-tabs/dump-manual.ts > manual.md
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDrummerServer } from "../../src/server/tools.js";

const server = createDrummerServer({ unavailableError: "prototype: no sidecar" });
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const client = new Client({ name: "proto", version: "0" });
await client.connect(b);

console.log(`# drummy server instructions\n\n${client.getInstructions()}\n`);
for (const t of (await client.listTools()).tools) {
  console.log(`## ${t.name}\n\n${t.description}\n\nInput schema:\n\n\`\`\`json\n${JSON.stringify(t.inputSchema, null, 1)}\n\`\`\`\n`);
}
await client.close();
