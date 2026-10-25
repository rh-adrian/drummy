# Slow MCP tools in Claude Code and Claude Desktop

Research for issue #5 on the song-tab map (#3). Done 2026-10-25.

The question: `find_song_tab` may take up to about 90 seconds. What happens when an
MCP tool is that slow? This area changes fast, so every claim below names a version
or a date.

**Versions checked**

| Thing | Version | Date |
| - | - | - |
| MCP spec | 2026-07-28 (newest); 2025-11-25 (newest that drummy's SDK speaks) | released 2026-07-28 |
| `@modelcontextprotocol/sdk` in drummy's lockfile | 1.29.0 | published 2026-03-30 |
| Newest 1.x SDK (what `^1.29` can pull in) | 1.32.2 | published 2026-10-23 |
| Claude Code | 2.1.310 (docs and changelog read the same day) | 2026-10-25 |
| Claude Desktop | no version tested; docs read 2026-10-25 | |

## Short answer

| Question | Claude Code 2.1.310 | Claude Desktop |
| - | - | - |
| Default timeout for one tool call | No real limit. The default is about 28 hours, plus an idle limit of 30 minutes for stdio servers. | Official docs: 240 seconds. Users report 60 seconds in October 2026. |
| Can the user change it? | Yes: `MCP_TOOL_TIMEOUT`, or a per-server `timeout` | No. Users report that settings and env vars have no effect. |
| Does progress reset the timer? | It resets the idle timer. It does not extend the hard limit. | Not documented. Users report it does not. |
| Progress shown to the user? | Yes. The newest progress message shows under the running call (tested). | Not documented. Could not test. |
| Log messages (`notifications/message`) shown? | No (tested) | Not documented |
| Image in a tool result reaches the model? | Yes (tested) | Yes, per official connector docs. Not tested. |
| Background work (MCP tasks)? | Yes, in beta, but only on spec 2026-07-28. Drummy's SDK cannot speak that spec. | No, per Claude Code docs. |

In plain words: Claude Code handles a 90-second tool well. It shows our progress
text, and the model sees our screenshot. Claude Desktop is the risk. Its official
limit is 240 seconds, but recent user reports say 60 seconds. If 60 seconds is
right, a 90-second call fails in Desktop even when the server finishes the work.

## 1. Timeouts

### 1.1 What the MCP spec says

The spec says senders **SHOULD** set a timeout on every request. They **MAY** reset
the clock when a progress notification arrives, but **SHOULD** still enforce a
maximum. When a timeout fires, the sender **SHOULD** send `notifications/cancelled`.
The spec sets no number.
Source: spec 2025-11-25, `basic/lifecycle`, "Timeouts".

### 1.2 The TypeScript SDK client (1.29.0, unchanged in 1.32.2)

- The default request timeout is `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000` (60 seconds).
  Source: `dist/esm/shared/protocol.js`, line 8, in both 1.29.0 and 1.32.2.
- The caller can pass `timeout`, `resetTimeoutOnProgress` (default `false`) and
  `maxTotalTimeout` in `RequestOptions`. Progress resets the timer only when
  `resetTimeoutOnProgress` is `true`. Source: `protocol.js` `_onprogress`,
  `_resetTimeout`, and `protocol.d.ts` `RequestOptions`.
- The client puts a `progressToken` on a request only when the caller passes an
  `onprogress` callback. A progress token is the ID that progress messages point
  back to. Without it, the server has no token, so it cannot send progress.
  Source: `protocol.js` `request()`.

So any client built on this SDK with default options stops waiting at 60 seconds,
and progress does not help. Claude Code does not use these defaults (see 1.3).

### 1.3 Claude Code (2.1.310)

From the official docs (code.claude.com/docs/en/mcp, "Time limits on MCP tool calls",
and the env-vars page):

- **Hard limit:** `MCP_TOOL_TIMEOUT`. The default is 100,000,000 ms, which is about
  28 hours. A per-server `timeout` field (in ms) in `.mcp.json` overrides it. "The
  per-server `timeout` is a hard wall-clock limit per tool call, and progress
  notifications from the server don't extend it."
- **Idle limit:** a call aborts if the server sends "no response and no progress
  notification" for the idle window. That window is 30 minutes for stdio servers and
  5 minutes for network servers. You can change it with
  `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`. So progress does keep a call alive against the
  idle limit. (Changelog 2.1.187 first added an idle abort, for remote servers.)
- **Startup limit:** `MCP_TIMEOUT`, default 30 seconds. This is for connecting, not
  for tool calls.
- **Network servers only:** HTTP and SSE servers also get a 60-second "first byte"
  timer per request. Stdio servers like drummy don't.
- **Automatic backgrounding:** a main-conversation MCP call still running after
  **2 minutes** moves to a background task. Claude gets a task ID and keeps working.
  The result arrives later as a task notification. You can change this with
  `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (added in 2.1.212). This never happens in
  subagents, and never in `claude -p` unless `CLAUDE_AUTO_BACKGROUND_TASKS=1`.

A 90-second `find_song_tab` stays under the 2-minute threshold. In Claude Code it
blocks the turn like a normal call, and nothing times out.

### 1.4 Claude Desktop

Claude Desktop now has three places that run tools: Chat, Cowork, and the Code tab.
The Code tab runs an embedded Claude Code. Servers in `claude_desktop_config.json`
load into both Chat and Code tab sessions (Claude Code docs, desktop page, "MCP
servers from the Claude Desktop chat app").

**Official docs.** The connector-building guide (claude.com/docs/connectors/building,
"Design within the size and timeout limits") gives one number:

| Limit | claude.ai and Desktop | Claude Code |
| - | - | - |
| Tool call timeout | 240 seconds per tool call | Configurable with `MCP_TOOL_TIMEOUT` |

That page is about remote servers, but the table names Desktop. The Desktop help
article on local MCP servers (support article 10949351) and the Claude release notes
(newest entry 2026-10-21) say nothing about timeouts or progress.

**User reports** (issues on the `anthropics/claude-code` tracker; not official, and
no Anthropic staff replied on any of them):

| Issue | Date | Desktop build | Where | Reported limit |
| - | - | - | - | - |
| #63379 | 2026-05 | 1.9659.1 (macOS) | Code tab, stdio server | ~60 s; `MCP_TOOL_TIMEOUT` ignored |
| #65643 | 2026-06 | 1.11187.1 (Windows) | Chat, stdio server | ~240 s |
| #73955, #58687 | 2026-05 to 2026-07 | not stated | Cowork | ~60 s; a July comment says Cowork sends no `progressToken` |
| #91898 | 2026-09 | 1.40609.1.0 (Windows) | Chat | ~240 s ("waiting 4 minutes") |
| #102940 | 2026-10-17 | 2.42304.0 (macOS) | Chat | 60 s ("did not respond within 60s"). A 2026-10-19 comment says it "went from being 4 minutes to 60 seconds" and also happens on Windows |

The reports agree on two points. First, users cannot change the limit. Second,
progress does not extend it. They disagree on the number, and the newest reports
say 60 seconds. The bot closed the older issues as "not planned" for inactivity, so
none of them was fixed or confirmed.

## 2. Is progress or log output shown to the user?

### 2.1 Progress (`notifications/progress`)

**Claude Code: yes.** Tested on 2.1.310 (see the experiment log below).

- Claude Code sends a `progressToken` on every `tools/call`. Observed:
  `"_meta":{"progressToken":2,"claudecode/toolUseId":"toolu_…"}`.
- In the interactive terminal, the newest progress message shows under the running
  call. A percentage appears when `total` is set:

  ```
  ● Calling slowprobe · 4s…
    ⎿  PROBE step 2 of 15: searching engine 2 (13%)
  ```

- Only the latest message shows, and each new one replaces the last.
- After a call moves to the background, its `/tasks` entry shows the latest progress
  (changelog 2.1.283, and the docs).
- In `claude -p --output-format stream-json`, no progress events appeared in the
  output. Headless users see nothing.

**Claude Desktop: unknown.** No official source says whether Chat or Cowork shows
progress. One user comment (on #58687, July 2026) says Cowork does not even send a
`progressToken`. If that is true, the server cannot send progress there at all.
Could not test.

### 2.2 Log messages (`notifications/message`)

**Claude Code: not shown.** In our test, the server sent 15 log messages during
a call. None appeared in the terminal, and none appeared in Claude Code's per-server
MCP log files. Claude Code never sent `logging/setLevel`. The docs say nothing.

**Claude Desktop:** no source found.

**The spec is moving away from this.** Spec 2026-07-28 deprecates the Logging
feature (SEP-2577). It says servers should "log to `stderr` (stdio) or use
OpenTelemetry instead". It also removes `logging/setLevel`. Servers may now send log
messages only when a request asks for them in `_meta`. So log messages are the wrong
channel for user-facing progress. Drummy already logs to stderr (NFR-2).

## 3. Does image content reach the model?

**Claude Code: yes.** Docs ("Images in tool results"): PNG, JPEG, GIF and WebP
images are shown to Claude inline, and may be scaled down. Since 2.1.283 they are
also saved to a file. Image results still count against `MAX_MCP_OUTPUT_TOKENS`
(default 25,000 tokens).

Tested on 2.1.310. A tool returned a 200×100 PNG (left half red, right half blue).
- Normal call: Claude answered "red on the left half and blue on the right."
- Call moved to the background: the result arrived as a saved PNG file. Claude used
  one extra file read to open it, then described it correctly. So images survive
  backgrounding, but they cost an extra step.

**Claude Desktop: yes, per docs.** The connector-building guide lists "Text and
image-based tool results" as supported for "claude.ai and Desktop". Its size limit
there is about 150,000 characters per tool result. Not tested. Note that a
base64-encoded screenshot gets big fast.

## 4. Sending progress with drummy's SDK (1.29)

The tool handler's second argument (`extra`, type `RequestHandlerExtra`) has
everything needed:

- `extra._meta?.progressToken`: present only if the client asked for progress.
- `extra.sendNotification(...)`: sends a notification tied to this request. It does
  nothing once the request has been cancelled.
- `extra.signal`: an `AbortSignal` that fires when the client sends
  `notifications/cancelled` (for example, the user stops the call). Use it to close
  the browser early.

Spec rules for progress (2026-07-28, `basic/patterns/progress`): `progress` **MUST**
go up with every message, even when `total` is unknown. `message` **SHOULD** be
human-readable. Both sides **SHOULD** rate-limit, and progress **MUST** stop once the
result is sent.

This sketch type-checks against SDK 1.29.0 with drummy's TypeScript settings
(`tsc --strict`, Node16 modules):

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export function registerFindSongTab(server: McpServer): void {
  server.registerTool(
    "find_song_tab",
    {
      description: "Search the web for a drum tab. Takes up to about 90 seconds.",
      inputSchema: { artist: z.string(), title: z.string() },
    },
    async ({ artist, title }, extra): Promise<CallToolResult> => {
      const token = extra._meta?.progressToken; // undefined if the client didn't ask
      let step = 0;
      const report = async (message: string): Promise<void> => {
        step += 1; // progress must increase every time
        if (token === undefined) return; // no token: nothing to send (still update the page)
        await extra.sendNotification({
          method: "notifications/progress",
          params: { progressToken: token, progress: step, message },
        });
      };

      await report(`Searching for a drum tab of "${title}" by ${artist}`); // first update fast
      const found = await searchForTab(artist, title, report, extra.signal); // checks signal between steps
      if (extra.signal.aborted) {
        return { content: [{ type: "text", text: "Search cancelled." }], isError: true };
      }
      if (!found) return { content: [{ type: "text", text: "No tab found." }] };

      const content: CallToolResult["content"] = [{ type: "text", text: found.text }];
      if (found.screenshotPng) {
        content.push({ type: "image", data: found.screenshotPng, mimeType: "image/png" });
      }
      return { content };
    },
  );
}
```

To test it with the in-memory transport (as `test/` does today), the test client
must pass `onprogress`. Otherwise no token is sent, and the handler sends nothing:

```ts
const seen: string[] = [];
await client.callTool(
  { name: "find_song_tab", arguments: { artist: "Lorem", title: "Ipsum" } },
  undefined,
  { onprogress: (p) => seen.push(p.message ?? ""), timeout: 120_000, resetTimeoutOnProgress: true },
);
```

Note that the test client's own 60-second default would fail a slow fake. Pass
`timeout`, or keep fakes fast.

Leave out `total` when the number of steps is unknown. With `total` set, Claude Code
shows a percentage, which looks wrong if the total changes partway through.

## 5. Long-running or background work: the tasks feature

**Spec history.**
- 2025-11-25 added **tasks** as an *experimental* core feature. A task-augmented
  `tools/call` returns a task handle at once, and the client polls `tasks/get` and
  `tasks/result`. Tools opt in with `execution.taskSupport`
  (`forbidden` / `optional` / `required`). Source: spec 2025-11-25, `basic/utilities/tasks`.
- 2026-07-28 moved tasks out of the core into an official extension,
  `io.modelcontextprotocol/tasks` (SEP-2663). It polls with `tasks/get`, adds
  `tasks/update`, removes `tasks/list` and the blocking `tasks/result`, and lets the
  server decide per request whether to return a task. Source: spec 2026-07-28
  changelog, "Major changes" item 6, and the extension docs (repo
  `modelcontextprotocol/ext-tasks`).

**SDK support.**
- SDK 1.29.0 (and 1.32.2) has the *old* experimental tasks:
  `server.experimental.tasks.registerToolTask(...)`, marked "may change without
  notice". Its `LATEST_PROTOCOL_VERSION` is `2025-11-25`. The 1.x line never speaks 2026-07-28.
- SDK v2 (split packages such as `@modelcontextprotocol/server`, v2.0.0 released
  2026-07-27, now 2.4.0) speaks 2026-07-28. It drops the old experimental tasks
  (SDK `ROADMAP.md`). The new tasks extension is not in the SDK yet (SDK issue #2189,
  open). It lives in a separate package, `@modelcontextprotocol/ext-tasks` 0.2.2
  (pre-1.0).

**Client support.**
- **Claude Code:** supports the tasks *extension* in public beta from v2.1.304. Only
  on connections using spec 2026-07-28, only in the terminal CLI, Agent SDK and
  GitHub Actions, and only for main-conversation calls. A task gets no time limit
  from Claude Code once the server answers with it. Source: Claude Code docs, "MCP
  tasks that run on the server". Since 2.1.292, stdio connections try 2026-07-28 by
  default (changelog). We observed that 2.1.310 first sends a
  `server/discover` probe with protocol 2026-07-28, then falls back to `initialize`
  with 2025-11-25 when the server (SDK 1.29) doesn't know that method. It declares
  `extensions: {"io.modelcontextprotocol/tasks": {}}` either way.
- **Claude Desktop:** the same Claude Code docs say "the desktop app" doesn't have MCP
  tasks. No other source found. The extension support matrix on modelcontextprotocol.io
  (updated 2026-09-28) does not list tasks at all.
- **Neither client** supports the old 2025-11-25 experimental tasks that SDK 1.29 offers.

**Bottom line for drummy:** real MCP tasks would mean moving to SDK v2 plus a pre-1.0
extension package. Even then, only Claude Code would use them, not Claude Desktop.
Claude Code's automatic backgrounding (section 1.3) already gives background behavior
for plain calls, with no server changes, but only after 2 minutes.

## What this means for the wait-or-background decision

These are facts for that ticket. They are not a decision.

- **Claude Code:** a blocking 90-second call is fine as-is. Progress shows inline,
  the screenshot reaches the model, and nothing times out.
- **Claude Desktop:** if the October 2026 reports of a 60-second cap are right, a
  blocking 90-second call fails there, and progress will not save it. Ways to stay
  under such a cap without MCP tasks:
  - Keep each call well under 60 seconds. For example, return the best result found
    so far when a time budget runs out.
  - Split the work into "start" and "check" calls joined by a server-made job ID.
    This is the pattern spec 2026-07-28 itself suggests for state that spans calls
    ("explicit, server-minted handles passed as ordinary tool arguments", SEP-2567).
    The search keeps running in the drummy process between calls.
- **The page status line is the one progress channel that works in every client**,
  because drummy owns it. Chat progress is a bonus in Claude Code, and unknown in
  Desktop.
- **Cancellation:** handle `extra.signal`. Claude Code cancels the call when the user
  stops it (docs), and the SDK aborts the signal on `notifications/cancelled`.

## Experiment log (2026-10-25, Claude Code 2.1.310, Linux)

A throwaway stdio server was built outside the repo with `@modelcontextprotocol/sdk`
1.29.0 and then deleted. It had one tool, `slow_search({seconds})`. Every 2 seconds it
sent `notifications/progress` (with `total` and a `message`) and
`notifications/message` (level `info`). At the end it returned a text block plus a
200×100 PNG (left half red, right half blue). It wrapped the transport to log every
message the client sent.

| Run | Setup | Result |
| - | - | - |
| 1 | `claude -p … --output-format stream-json --verbose`, 8 s call | `progressToken` sent; 4 progress messages sent; no progress or log events in the output; Claude described the image correctly |
| 2 | Interactive terminal, 30 s call | Newest progress message plus percentage shown under "Calling slowprobe · Ns…"; 0 of 15 log messages shown; image described correctly |
| 3 | Interactive, `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=8000`, 24 s call | Moved to background at about 8 s; footer showed "1 MCP task"; Claude replied "still running in the background (task …)"; then "MCP task … (slowprobe/slow_search) completed."; the image arrived as a saved file; Claude read it and described it correctly |

Handshake seen in every run: `server/discover` (protocol 2026-07-28), then
`initialize` (protocol 2025-11-25). Client capabilities: `roots`, `elicitation`
(form and URL), and `extensions.io.modelcontextprotocol/tasks`.

## Could not verify

- **Claude Desktop, any of it, first-hand.** There is no Desktop install to test with.
  The real timeout today (240 s per docs vs 60 s per October reports), whether Chat
  sends a `progressToken`, whether it shows progress, and whether Chat and Cowork
  differ are all unconfirmed.
- Whether the Desktop **Code tab** still ignores `MCP_TOOL_TIMEOUT`. The only report
  (#63379) is from May 2026.
- Whether Claude Code shows `notifications/message` anywhere in `--debug` mode. Only
  normal mode was checked.
- How Claude Code shows a progress message that has no `total`. Every test set `total`.

## Sources

Spec and SDK
- MCP spec 2026-07-28 changelog: https://modelcontextprotocol.io/specification/2026-07-28/changelog
  (repo file `docs/specification/2026-07-28/changelog.mdx`)
- MCP spec 2026-07-28 progress: https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress
- MCP spec 2025-11-25 lifecycle (Timeouts): https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#timeouts
- MCP spec 2025-11-25 tasks: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks
- MCP tasks extension: https://modelcontextprotocol.io/extensions/tasks/overview and https://github.com/modelcontextprotocol/ext-tasks
- Extension support matrix: https://modelcontextprotocol.io/extensions/client-matrix
- MCP debugging guide (logging deprecation): https://modelcontextprotocol.io/docs/tools/debugging
- Spec release post, 2026-07-28: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- TypeScript SDK 1.29.0 source: `node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js`,
  `server/index.js`, `server/mcp.js`, `experimental/tasks/mcp-server.d.ts`, `types.js`
- TypeScript SDK releases and roadmap: https://github.com/modelcontextprotocol/typescript-sdk/releases,
  https://github.com/modelcontextprotocol/typescript-sdk/blob/main/ROADMAP.md, issue #2189

Claude Code
- MCP docs: https://code.claude.com/docs/en/mcp (sections "Time limits on MCP tool calls",
  "Automatic backgrounding of long tool calls", "MCP tasks that run on the server",
  "MCP client runtimes", "MCP output limits and warnings", "Images in tool results")
- Env vars: https://code.claude.com/docs/en/env-vars (`MCP_TOOL_TIMEOUT`, `MCP_TIMEOUT`,
  `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`)
- Desktop page: https://code.claude.com/docs/en/desktop ("MCP servers from the Claude Desktop chat app")
- Changelog: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
  (entries for 2.1.153, 2.1.187, 2.1.212, 2.1.283, 2.1.292)

Claude Desktop and connectors
- Build an MCP server for Claude (limits table, supported features):
  https://claude.com/docs/connectors/building
- Local MCP servers on Claude Desktop:
  https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
- Release notes: https://support.claude.com/en/articles/12138966-release-notes
- User reports: https://github.com/anthropics/claude-code/issues/63379,
  https://github.com/anthropics/claude-code/issues/65643,
  https://github.com/anthropics/claude-code/issues/58687,
  https://github.com/anthropics/claude-code/issues/73955,
  https://github.com/anthropics/claude-code/issues/91898,
  https://github.com/anthropics/claude-code/issues/102940
