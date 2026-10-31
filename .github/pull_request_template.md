## What the user now sees or gets

<!-- One or two sentences. Link the issue if there is one. -->

## How you tested it

<!-- Which tool (Claude Code, Codex, Vibe, Cowork), its version, your OS. -->

## Checks

- [ ] `node --check` on every changed `.js` file, and the page-script check in CONTRIBUTING.md
- [ ] `npm run i18n` passes (new texts have an English key; say here if the other nine languages are missing)
- [ ] `npm test` passes
- [ ] For a visible change: opened the page and saw no console errors
- [ ] No new network request, or it is opt-in and asked once
