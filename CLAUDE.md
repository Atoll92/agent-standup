# Agent Standup

Turns Claude Code / Codex session transcripts into a live "team call" (a web page served locally),
shown in a VS Code panel, a desktop app (Electron) and a command line. Zero runtime dependencies.

## Layout
- `core/`: reads sessions → timelines, board, live feed. No web, no UI, reads no environment:
  everything goes through `createCore({ root, codexHome })`.
  - `core/sources/<tool>/`: one source per agent tool, built the same way (`index`, `files`, `board`, `record`,
    plus what the tool needs of its own). A new tool is a new source implementing `core/sources/source.js`;
    the rest of the core never names a tool.
  - `core/models/`: the core's objects (Event and its kinds, Agent, Timeline, SessionStatus…), with readable attributes.
  - `core/serializers/web.js`: the ONLY place that knows the page's short wire names (`ts`, `k`, `th`, `to`…).
- `server.js`: puts the server together and keeps its exports (`bin/`, `extension.js`, `desktop/main.js` use them).
- `server/`: `routes.js` (every address → `controller#action`), `controllers/`, `services/`, `http/`.
- `public/index.html`: the page (one file, browser JS). `extension.js`: VS Code. `desktop/`: Electron. `bin/`: CLI.

## Commands
- `npm test`: all tests (node:test). One file: `node --test test/core.test.js`. `test/live.test.js` needs puppeteer and is skipped without it.
- `node server.js` → http://localhost:4747 (`PORT=…` to change).
- `node scripts/build-cli.js`, `node scripts/build-desktop.js`: packaged builds.

## Code style
- Vanilla JavaScript, Node built-ins only. No TypeScript, no dependencies, no build step.
- CommonJS, not ES modules: the root `package.json` is also the VS Code extension's manifest (`engines.vscode` ^1.80),
  and `"type": "module"` there would make `extension.js` an ES module.
- Classes (with `#private` fields) for things that hold state or play a role; plain functions for pure steps.
- One concern per file. A file starts with a comment saying what it is and how it fits.
- Names say what things are: `fileDescriptor`, `toolResult`, `startedAt`; never `f`, `fd`, `e`, `n`, `r`.
  Constants carry their unit: `VANISH_MS`, `MAX_BODY_BYTES`.
- Comments are plain sentences explaining why, or what a value means; no JSDoc. Match the density around them.
- Display formats live in serializers, never in models or sources.
- `public/index.html` keeps its own compact style: don't restyle it unless asked.

## Changing behavior
- A refactor changes no behavior: same wire output, same HTTP answers. Say so in the commit, and name any exception.
- The wire format is read by the page, the VS Code extension and the CLI: change it only on purpose, in the serializer.
- Tests read like specs: the test name is a sentence about the behavior. Each test builds its own core over
  its own temp folder, writing transcripts the way the tool writes them.

## Traps
- The build scripts copy explicit lists: a new top-level file or folder must be added to
  `scripts/build-cli.js` and `scripts/build-desktop.js` (and checked with a build), or it ships missing.
- `server.js` reads the environment once, when it is loaded: tests set `AGENT_STANDUP_*` before requiring it.
- A session's timeline is not rebuilt within 250 ms of its last build: tests that append and read again wait ~300 ms.
- The demo is stamped with the current time: two loads of it differ in `ts`.
- Three platforms (macOS, Windows, Linux): speech, paths and spawning processes have a branch for each.

## Commits
- Subject: one plain sentence saying what changed (no `feat:` prefixes), as in `git log`.
- Body: why, and what was checked.
