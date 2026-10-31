# Contributing to Agent Standup

Thanks for helping. Issues, ideas and pull requests are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first (or a draft pull request) and say what you plan. It saves you work if the idea needs a different shape.
- Agent Standup only reads the session files that Claude Code, Codex, Mistral Vibe and Cowork already write, and it sends nothing by default. A change that adds a network request must be opt-in and asked once; say so in the pull request.
- The app has no runtime dependencies. Please keep it that way.

## Run it

```sh
npm install          # dev tools only: the tests and the builds
node server.js       # http://localhost:4747
```

To run against chosen data instead of your own, set `AGENT_STANDUP_PROJECTS` (a sessions folder) and `AGENT_STANDUP_PREFS` (a throwaway settings file). The README lists the other variables.

## Where things are

- `server.js`: the backend. It reads the transcripts and serves `/api/*` and `public/`.
- `codex.js`, `vibe.js`: the Codex and Mistral Vibe readers.
- `public/index.html`: the whole page, one inline script.
- `extension.js`: the VS Code extension.
- `test/`: `node:test` suites. The `live-*` files drive the real page in Chrome through puppeteer-core.

## Checks before you open a pull request

CI runs the same ones.

1. `node --check` on every `.js` file you changed.
2. The page script still parses:
   ```sh
   node -e "new Function('return async function(){' + require('fs').readFileSync('public/index.html','utf8').split('<script>')[1].split('</script>')[0] + '}')"
   ```
3. `npm run i18n` passes.
4. `npm test` passes (about 2.5 minutes, needs Chrome). While you work, run one file: `node --test test/server.test.js`.
5. For a visible change, open the page in a browser and check the console for errors. The unit tests pass on a broken page.

## Things that catch people out

- **Long lines.** `server.js`, `public/index.html`, `codex.js` and `vibe.js` put many statements on one line. A `//` comment added in the middle of a line silently comments out the rest of it. Put comments at the end of a line, on their own line, or use `/* */`.
- **Ten languages.** Every text a user sees exists in 10 languages (`public/locales/`, `l10n/` and `package.nls.*.json` for the extension). Add the English key. Translations of the other nine are welcome; if you can't do them, say so in the pull request and they will be added.
- **Old transcripts.** People run old versions of Claude Code. Code that reads transcripts must cope with missing fields.
- **New files.** A new runtime file must also be listed in `scripts/build-cli.js` and `scripts/build-desktop.js`. A new file that is not runtime must be added to `.vscodeignore`.

## Pull requests

- One topic per pull request.
- Title: one plain sentence about what the user now sees or gets, for example "Codex sub-agents join their lead's call". No `feat:` or `fix:` prefixes.
- Say how you tested it: which tool (Claude Code, Codex, Vibe, Cowork), which version, and on which OS.
- Never include real transcripts, tokens or `.env` files. The repository is public.

By contributing, you agree that your work is released under the MIT license of this repository.
