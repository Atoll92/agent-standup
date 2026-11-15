# Translating Agent Standup

The interface is translated with one small JSON file per language. French and English are written in the code; **every other language is a file in this folder**.

## How it works
- `en.json` lists every English string of the interface (generated, do not edit by hand).
- `xx.json` (for example `zh-TW.json`) maps each **English string** to its translation. A string that is missing falls back to English, so a half-finished translation already works.
- Languages are listed in `public/index.html` (the `LANGS` array: code, name in its own language, HTML `lang`).

## Add or improve a language
1. `npm run i18n:extract` regenerates `en.json` from the code.
2. New language: `node scripts/i18n.js stub fr-CA` creates `public/locales/fr-CA.json` with every key empty. Improving an existing one: just edit its file.
3. Translate the values. Rules:
   - Keep emojis and symbols where they are.
   - Some keys are **fragments** glued to other text at runtime (`"Reading "` + a file name, `"context "` + a number + `" full — compaction soon"`). Keep the same leading and trailing spaces and make the glued result read naturally.
   - Do not translate product names: Agent Standup, Claude, Claude Code, Codex, Mistral Vibe, VS Code, FIP, Markdown.
   - Keep labels about as short as the English: they sit in small chips.
4. Add the language to `LANGS` in `public/index.html`.
5. `npm run i18n` checks every file: missing or empty strings, unused keys, lost emojis, changed leading/trailing spaces. It must pass.
6. Set `"reviewed": true` in the file's `_meta` once a native speaker has read it.

## The VS Code side
Command titles and setting descriptions use VS Code's own mechanism: `package.nls.<lang>.json` at the repository root (keys like `command.open.title`). The status bar texts are in `l10n/bundle.l10n.<lang>.json` (the English text is the key; keep `{0}`). The language codes are lowercase there (`zh-tw`, `pt-br`).

## The website and the landing page
They work the same way, with their own files: `website/locales/<code>.json` (agent-standup.com, one page per language, written by `npm run website`) and `landing/locales/<code>.json` (the landing page, which fetches the file of the chosen language). English and French are in the pages themselves (`data-en` / `data-fr` in `website/src/home.html` and `landing/template.html`). `node scripts/site-locales.js extract` regenerates the two `en.json`, and `npm run i18n` checks these files too. Keep the HTML tags of a text exactly as in the English.

## What is *not* translated
The words agents say come from your session (their own language), unless the call is held in French, Spanish, Brazilian Portuguese, German, Danish, Japanese, Korean or Chinese: these eight are in the code (Chinese twice, Simplified `zh` and Traditional `zt`) (`CALL_LANG` in `public/index.html`), each with its own little banter lines (answers to orders, goodbyes) next to the English and French ones, its voices and its translation. Another language needs all of these, not only a catalogue. The built-in demo exists in English and French only.
