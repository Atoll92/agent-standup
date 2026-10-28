# Agent Standup: notes for coding agents

Agent Standup shows the Claude Code, Codex, Mistral Vibe and Cowork sessions of a computer as a live video call: drawn characters, voices, a board, a sessions list. Its local Node server only reads the session files those tools already write. It has no runtime dependencies, and it calls Claude only to translate the call and, when turned on, for the jokes: the user's own `claude`, or the Anthropic API when `ANTHROPIC_API_KEY` is set. It ships as a VS Code extension (Marketplace and Open VSX), an npm CLI (`@double_geste/agent-standup`), a Claude Code plugin, and a macOS app. The repository is public (MIT).

## Map
| Path | What |
|---|---|
| `server.js` | The whole backend: reads `~/.claude/projects/**/*.jsonl` incrementally, merges sub-agents, serves `/api/*` and `public/`. For the shared screen it also reads the live output of background commands from Claude Code's temp folder (`/tmp/claude-<uid>/<project>/<session>/tasks/<id>.output`, `/api/taskout`). Also handles translation, prefs, characters, packs and the shop client. |
| `codex.js`, `vibe.js` | Readers for Codex and Mistral Vibe. Each lists its sessions under one made-up project (`SOURCES` in server.js). Cowork is read like Claude Code, from the desktop app's folder (`coworkHomes`). |
| `demo.js` | The built-in demo: a made-up session (English and French) that `server.js` serves. |
| `kokoro.js`, `kokoro-worker.js` | Natural voices (Kokoro TTS), installed on demand. |
| `public/index.html` | The whole page: one inline `<script>`, about 3000 lines. `public/locales/*.json` holds the page's other eight languages and the generated `en.json`; French and English are written in the page itself (`L(fr, en)`). |
| `extension.js` | The VS Code extension. It forks `server.js` into a process of its own (the editor's runtime with `ELECTRON_RUN_AS_NODE`), and falls back to running it in the extension host if that fails. The process starts when the call is opened; the status bar reads the ends of the transcripts in the extension host itself (`boardRows()`), so a window whose call is never opened runs no server. It also handles the webview, commands and tab following (via `/api/board` and `/api/sessions`). `l10n/` and `package.nls.*.json` hold its texts. |
| `bin/agent-standup.js` | The CLI (`status`, `statusline`, `--open`). `scripts/build-cli.js` builds it into `dist-cli/`. |
| `desktop/` | Electron app (`main.js`). `scripts/build-desktop.js` builds it. |
| `plugin/` | The Claude Code plugin (skills `open`, `status`). `scripts/sync-plugin.js` keeps its version in step. |
| `plugin-band/` | A second plugin, a Claude Code mod (function hooks, `hooks/register.tsx`): a line above the prompt when another session waits for you. Reads only `~/.claude/sessions/*.json`. Check it with `claude plugin validate plugin-band` and `claude plugin test plugin-band`, with the newest `claude` and an old one (2.1.59 is at `/opt/homebrew/bin/claude`): no `$.state`, no `types` key, which old versions refuse. |
| `api/` | Vercel functions of agent-standup.com: Stripe checkout, pack download, the sales page (`sales.js`) and the growth dashboard (`stats.js` with `_growth.js`, at `/api/stats/?k=<STATS_KEY>`). They have no dependencies. |
| `website/` | agent-standup.com (Vercel; a push to main deploys it). `npm run website` builds `website/dist`. |
| `landing/` → `docs/` | The GitHub Pages landing (`npm run landing`). Do not redesign it without asking. |
| `test/` | `node:test` suites. `live-*.test.js` drive the real page in Chrome through puppeteer-core, each with its own server and browser; their shared setup is `live-helpers.js`, which must be required before `server.js`. |
| `examples/` | Character packs. `cats/` and `vampire/` ship with the app. |

## Run and test
- `node server.js` → http://localhost:4747 (`PORT=…`). `?live=0` opens the replay picker, `?proj=<dir>` limits the call to one project.
- To run against chosen data, set `AGENT_STANDUP_PROJECTS` (sessions folder), `AGENT_STANDUP_PREFS` (settings file), `AGENT_STANDUP_CC_SESSIONS` (Claude Code's per-session status folder, `~/.claude/sessions`), `AGENT_STANDUP_CHARACTERS`, `AGENT_STANDUP_PACKS`, `AGENT_STANDUP_KOKORO_DIR`, `AGENT_STANDUP_COWORK=off`, `AGENT_STANDUP_CODEX=0`, `AGENT_STANDUP_VIBE=0`, `AGENT_STANDUP_CLAUDE` (a stand-in `claude` for translation) and `AGENT_STANDUP_STORE` (the shop; `scripts/shop-dev.js` is a pretend one). Never point a test server at the user's real prefs.
- The live tests get their own empty packs and characters folders and treat the Halloween line as done; a change that depends on the date or on installed packs can pass here and fail in CI.
- `npm test` takes about 2.5 minutes: the four browser files run side by side. While iterating, run one file: `node --test test/server.test.js`.
- `npm run i18n` checks that every language has every key, and rebuilds the website and landing locale files.
- The app leaves out sessions in temporary folders. Put throwaway sessions and test copies under `reports/` (git-ignored), not `/tmp`.
- A live `claude` that an agent starts to probe Claude Code (a question, a permission menu) runs in its scratchpad or another temporary folder, with `CLAUDE_CODE_ENTRYPOINT` and `CLAUDECODE` unset (it then says `sdk-cli`). Under `reports/` its menus reach Arthur as "needs you" in his own call and editor.

## Checks after every edit (CI runs the same ones)
- `node --check` on each `.js` you touched.
- The page script: `node -e "new Function('return async function(){' + require('fs').readFileSync('public/index.html','utf8').split('<script>')[1].split('</script>')[0] + '}')"`
- For any visible change, load the page in a browser and look for page errors. Unit tests pass on a broken page.

## Traps
- **Long lines.** `server.js`, `public/index.html`, `vibe.js` and `codex.js` put many statements on one line. A `//` comment inserted mid-line silently comments out the rest of the line. Put comments at the end of a line or on their own line, or use `/* */`.
- **Other tools' readers go through `guard()`.** A session of Codex, Vibe or Cowork that cannot be read must cost that session only, never `/api/sessions` for everyone.
- **The landing copies the "cast" section of `public/index.html`.** There, `prefs`, `S` and the server do not exist. After `npm run landing`, if `docs/index.html` changed by more than the version, open it in a browser.
- **The four builds pick their files differently.** The vsix takes everything that `.vscodeignore` does not leave out, so a new non-runtime file at the root (notes, exports, this file) must be added there. The CLI and the desktop app take only what they list, so a new runtime file must be added to `scripts/build-cli.js` (the copy list and the package's `files`) and `scripts/build-desktop.js`. After a change, check the result with `unzip -l` on the vsix.
- **Every user-facing text is in 10 languages:** page `public/locales/`, extension `l10n/` + `package.nls.*.json`, website `website/locales/`, landing `landing/locales/`. Add the English key, translate it into the other nine, then run `npm run i18n`.
- **Privacy promises are written in several places.** If you change what the app, the site or the landing sends or counts, update `PRIVACY.md`, the website footer (10 languages) and `plugin/README.md`.
- **Never commit `4 persos/` or `halloween-src/`.** They hold the paid Halloween pack's art; the repository is public and a commit cannot be taken back. Only `examples/vampire/` and `public/pack-halloween.jpg` are public. Never commit `.env*`.
- **Several agent sessions often edit the same working tree.** Before committing, check `git status` and `git diff` for work that is not yours, and commit only your own hunks.
- **Old transcript formats.** The `claude` on the PATH here can be far older than the VS Code one. Code that reads transcripts must tolerate missing fields (`stop_reason`, `~/.claude/sessions/<pid>.json`, sub-agent meta files).

## Commits
- Commits go straight to `main` (no PRs from the author). External contributions come as PRs.
- A commit message is one plain-English sentence about what the user now sees or gets, not about the code ("A folder's sessions stay in the list however many sessions are written elsewhere"). No `feat:`/`fix:` prefixes.
- A release is two commits: `x.y.z: <summary>; changelog`, then `Landing x.y.z`.

## Release (only when asked: "publie", "new release")
1. Bump the version in `package.json`, `desktop/package.json` and both `version` fields of `desktop/package-lock.json`. Add a `## x.y.z` entry to `CHANGELOG.md`. Run `node scripts/sync-plugin.js`. Run CI's "One version everywhere" step by hand.
2. `npm run landing`, then commit `Landing x.y.z`.
3. Push the exact commit and wait for CI to pass.
4. Build from `git archive <release commit>`, never from the working tree, which may hold other work. Build the vsix (`npm run package`) in an archive copy of its own: it takes every file not in `.vscodeignore`, so logs or the CLI tgz built beside it end up inside (compare `unzip -Z1` with the previous release's list). Then the CLI tgz (`build-cli.js` + `npm pack ./dist-cli`) and the two macOS zips (`build-desktop.js --arch arm64|x64`, zipped with `ditto -c -k --keepParent`).
5. `gh release create vx.y.z --target <full sha> …`. The tag publishes npm and Open VSX and attaches the Windows/Linux zips. The VS Code Marketplace upload is done by hand by Arthur.
6. Before a release that touches `server.js`, a reader or `extension.js`, also compare the old and new servers on real sessions, activate the packaged vsix with a stand-in `vscode`, and have a reviewer try to prove the release breaks existing users. Fixes made after the review get a review of their own: in 1.39.0 they overreached.
7. After publishing, check that what people download runs: `npx -y @double_geste/agent-standup@x.y.z` (as the plugin starts it, `AGENT_STANDUP_FROM=plugin`), the macOS zip from the release (`--user-data-dir` of its own, and unset the `AGENT_STANDUP_*` variables a shell started from VS Code inherits), and the vsix in a real VS Code with its own `--user-data-dir`/`--extensions-dir` (the extension's `agentStandup.charactersPath` setting replaces `AGENT_STANDUP_CHARACTERS`). Each with throwaway settings, never Arthur's.
8. Then delete the build and test copies: everything in `reports/prerelease/` except `scripts/`, and the release-check copies (~700 MB per build; the disk runs short). Keep `dist-release-<version>/` of this release. Arthur asked for this at the end of every release.
