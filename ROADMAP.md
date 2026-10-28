# Roadmap and research notes

What exists today, what was investigated, and what is deliberately not built yet.

## Works today
| Where | How |
|---|---|
| **VS Code** | Extension from the Marketplace (panel, side bar, status bar, localised commands). |
| **Cursor, Windsurf, VSCodium, other VS Code forks** | The same extension from [Open VSX](https://open-vsx.org/extension/DoubleGeste/agent-standup), published at each release by `.github/workflows/publish.yml`: search **Agent Standup** in the Extensions panel. The `agent-standup-<version>.vsix` of the GitHub release works too (*Extensions → … → Install from VSIX*). |
| **Any terminal** | `agent-standup` (npm package `@double_geste/agent-standup`): the local page in your browser, plus `status` and `statusline` for status bars (Claude Code status line, tmux, Neovim…). |
| **Inside Claude Code** | A plugin (`plugin/`) with two skills: `/agent-standup:open` opens the call, `/agent-standup:status` says in one line who is working and who needs you; and a second one (`plugin-band/`) that shows a line above the prompt when another session needs you (Claude Code 2.1.294+). |
| **Desktop** | Small app for macOS (Apple Silicon and Intel, unsigned): window + menu bar indicator + notification when a session waits for your answer. Windows and Linux builds are set up in CI but untested. |
| **JetBrains IDEs** | Not native yet. Recipe: *Settings → Tools → External Tools → +*, program `npx`, arguments `-y @double_geste/agent-standup@latest --open`, working directory `$ProjectFileDir$`; the call opens in your browser. |

## Other agent tools
**Codex is read** (`codex.js`): the desktop app and the command line, written and tested against real session files. Its sub-agents and pictures are not shown yet; a session with Codex sub-agents is needed to learn how they are recorded.

**Cowork is read**: the sessions of the Cowork tab of the Claude desktop app, sub-agents and scheduled tasks included. Cowork records them in the format of Claude Code, in the desktop app’s own folder (`local-agent-mode-sessions`).

**Mistral Vibe is read** (`vibe.js`): both of its engines, checked against real sessions of Vibe 2.26.1, with its sub-agents. Pictures are not shown.

The rest is researched, not built. Reading another tool needs one adapter each. A web research pass found that **almost every format is undocumented or reverse-engineered and sources disagree**, and no real log of these tools was available to test against, so no adapter was written blind. Ranking if/when someone wants to take one (sources are third-party; verify against a real install first):

| Tool | Where logs live (per sources) | Fit |
|---|---|---|
| Gemini CLI | `~/.gemini/tmp/<project_hash>/chats/` | Official docs confirm the folder, tool I/O and tokens; file format to confirm on a real install. |
| OpenCode | `~/.local/share/opencode/` | Has explicit parent/child sessions and full token/cost data, but storage changed between versions (SQLite, then JSON, then SQLite again). |
| Amp | `~/.local/share/amp/threads/T-<uuid>.json` (community sources) | One JSON file per thread; small adapter, small user base. |
| Cline / Roo | VS Code `globalStorage/.../tasks/<id>/*.json` | Medium; no sub-agents found. |
| Aider, Cursor, Copilot agent mode | Markdown history / SQLite / undocumented | Poor fit: no structured tool calls, or undocumented databases. |

A good adapter design: one small module per tool turning its log into the common event list the UI already uses (`say`, `tools`, `results`, `order`, `finish`, `usage`…), selected by folder. Contributions are welcome; please attach a few anonymised sample logs.

## Rive characters (researched, not built)
Rive's web runtime is MIT-licensed and supports state machines (inputs like `isTalking`), but it ships WASM (needs `'wasm-unsafe-eval'` in the webview CSP), and, according to Rive's current pricing, **exporting `.riv` files needs a paid plan**, which limits who could author characters. The pixel-art feature (drop PNGs in `~/.agent-standup/characters`) covers the same need at zero cost. A Rive loader could be added later as an opt-in setting that takes a local `.riv` file.

## Other ideas
Voxtral (Mistral) voices with your own API key; a "corporate jargon" style for the little banter lines; cloud sessions; a native JetBrains plugin (needs JDK 17 and the IntelliJ Platform Gradle plugin).
