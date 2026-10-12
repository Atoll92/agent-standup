![Agent Standup: your AI agents, in a stand-up call](https://atoll92.github.io/agent-standup/media/banner.png)

# Agent Standup

**See who is waiting on whom, and who is blocked — across all your Claude Code, Codex and Mistral Vibe sessions — at zero token cost.** Agent Standup turns the session files Claude Code, Codex and Mistral Vibe already write into a live team call (and a board of every session): it only reads local files and never calls Claude unless you turn on French translation or the jokes.

**Your Claude Code, Codex or Mistral Vibe session as a live team call.** The lead gives orders, sub-agents join the call, work at their desks, share their screen and report back — with voices, expressions and a view of the real work as it happens.

**Runs as a VS Code extension, a terminal command, or a desktop app.** Try it in 30 seconds, no install and no editor (Node 18+): `npx @double_geste/agent-standup --open`, then ⚙ → Source → Demo.

**Works with:** Claude Code · Codex · Mistral Vibe — in VS Code, Cursor, Windsurf, any terminal, or as a desktop app.

**→ Website & download: https://agent-standup.com**

![Agent Standup: a team of AI agents in a call](https://atoll92.github.io/agent-standup/media/hero.gif)

_A fictional team fixing a slow login page — the built-in demo (⚙ → Source → Demo). [Watch the full 1-minute video](https://atoll92.github.io/agent-standup/media/demo.mp4)._

[![Buy me a coffee](https://img.shields.io/badge/-Buy%20the%20(replaced)%20dev%20a%20coffee-ffdd00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/bored_dev_and_his_robots)

> Unofficial community project, not affiliated with or endorsed by Anthropic, OpenAI or Mistral AI. "Claude" is a trademark of Anthropic; "Codex" is a trademark of OpenAI; "Mistral" is a trademark of Mistral AI.

## What you get

- **Token usage per agent** — a ⚡ counter in the header and on each tile shows how many tokens each agent used (input + output + cache writes; cache reads shown separately in the tooltip), counted once per message as recorded by Claude Code. Handy to see which sub-agent is the expensive one. It is read from the session files, not an estimate of your bill.
- **Stuck or quiet agents** — in the live call, a tile pulses amber with ⏳ when a command has been running for over a minute, shows 💤 when a working agent has gone quiet for 3 minutes, and a red ✗ counter for failed tool calls. The browser tab title shows how many agents are working.
- **Built-in demo** — no session yet? ⚙ → Source → **Demo** plays a fictional team (no data of yours).
- **Live call** — follows your newest Claude Code session in real time. Each agent is a small character at its desk; the one who speaks gets the spotlight and keeps it until someone else talks. Agents that talk back-to-back talk over each other, like a real meeting.
- **Real voices, lip-sync** — lines are spoken aloud; mouths follow the actual volume of the voice. For the best experience, switch to the very natural voices (see [Voices](#voices)).
- **Live screen sharing with the real output** — when an agent works, its screen fills the stage (presenter's camera in the corner, "sharing" badge): a **terminal** with the command history and the actual output of each command, search results and tool calls; or an **editor** with the file it reads (real content and line numbers) or the exact diff it applies. See *What you see for each agent* below.
- **Agents come and go** — a sub-agent joins when it is given a task and leaves the call 2 minutes (playback time) after its report, with a dissolve animation. It comes back if it gets a new task.
- **Sub-agent tree** — the full hierarchy (you → the lead → sub-agents → their sub-agents) with status, tool counts and the current action.
- **Click any agent** — its prompt, tool usage and reports.
- **Replay** — pick any past session, scrub through it, see a timeline of who worked when, and get a **recap** (agents, tool calls, commands, files changed, busiest agents).
- **Video export** — ⚙ → Tools → 🎞 Export video records the call at 1280×720 with voices and subtitles, as an MP4 (H.264 + AAC) when the browser can record it, and as a `.webm` when it cannot. X, phones and most chat apps refuse `.webm`.
- **Clip to share** — ⚙ → Tools → 🎬 Clip to share (25 s) records about 25 seconds, saved as `agent-standup-clip.mp4` (`.webm` when the browser cannot record MP4). In the middle of a replay it starts at the current position; otherwise one spoken line before the first error or loop of the session, and failing that at the moment the lead first hands out work. The line being said when time is up is finished rather than cut, so the length varies by a few seconds. The clip carries the site address (atoll92.github.io/agent-standup) in the top right corner and ends with a short end card; the full export has neither.
- **Hide code & file names in videos** — ⚙ → Tools, off by default, for the full export and the clip. Commands, their output, file contents, diffs and search results on the shared screen are drawn as grey bars of the same length; file names are removed from the window title and from the activity tags on tiles (the tool's name, e.g. `Bash` or `Read`, stays); the session title is replaced by "Agent Standup"; pictures (screenshots, images) become an empty frame. **What the agents say is not masked**: speech bubbles, subtitles and voices are kept as they are, so check the clip before posting if agents quote code or names aloud.
- **French or English** — agent text is translated on the fly (see below).
- **Office music** — optional live web radio (FIP and its themed stations) that fades down smoothly while an agent talks and fades back up when the room goes quiet.
- Office ambience, optional (off by default) and fully synthesised: keyboards that type when agents run commands, clicks when they read, a coffee machine, a phone buzzing, a far-away door… (⚙ → Office ambience). Plus small reactions and jokes between agents ("episode mode").

## Claude Code plugin

You can also open the call from inside Claude Code. The [plugin](plugin/) adds two skills: `/agent-standup:open` starts the app and opens the call in your browser, and `/agent-standup:status` says in one line who is working and who needs you.

    /plugin install agent-standup --marketplace Atoll92/agent-standup

On Claude Code before 2.1.275: `/plugin marketplace add Atoll92/agent-standup`, then `/plugin install agent-standup@double-geste`. The plugin runs the same npm package as the command line, pinned to an exact version.

## Codex sessions too

Sessions of OpenAI’s Codex (the desktop app and the `codex` command) appear next to your Claude Code sessions: in the session list (project “Codex”), on the board, and in the live call when one of them is the most recent. Nothing to set up: the app reads the files Codex already writes in `~/.codex/sessions` (or `$CODEX_HOME`), and never writes there.

- **What is shown:** what you typed, what the agent says, each command with its real output and whether it failed, files it created or changed, web searches, MCP calls, the questions it asks you, its reasoning summaries as inner thoughts, token counts, and the end of each turn.
- **Not yet:** Codex sub-agents (a Codex session is the lead and you), and pictures. The short reviews Codex runs on its own before a command are not shown as sessions.
- **In VS Code** the call follows the Codex sessions started in the folder you have open, like it does for Claude Code.
- **Turn it off or point it elsewhere:** in VS Code, the setting `agentStandup.codex`; anywhere else `AGENT_STANDUP_CODEX=off`, or `AGENT_STANDUP_CODEX=/path/to/codex-home` (command line: `--codex off` or `--codex DIR`). With `--projects DIR`, Codex sessions are only read if you also pass `--codex`.

## Mistral Vibe sessions too

Sessions of [Mistral Vibe](https://github.com/mistralai/mistral-vibe) (Mistral's coding agent, the `vibe` command) appear next to your Claude Code sessions: in the session list (project “Mistral Vibe”), on the board, and in the live call when one of them is the most recent. Nothing to set up: the app reads the folders Vibe already writes in `~/.vibe/logs/session` (or `$VIBE_HOME`), and never writes there.

- **What is shown:** what you typed, what the agent says, each command and tool call with its real output and whether it failed, files it created or changed, its todo list, its reasoning as inner thoughts, token totals, the end of each turn, and **its sub-agents**: each one joins the call under the name the lead gave it, with its orders and its answers.
- **Two engines, both read.** Vibe 2.26 starts a new engine by default, which keeps the time of every event: the call is exact. With it a sub-agent leaves no record of its own, so you see what the lead asked it and what it answered, not each of its commands. The earlier engine (`vibe --legacy-harness`, and older versions) does record a sub-agent's own commands, but writes no times and saves at the end of each step: followed live the times are right to within a step, and a session opened afterwards is spread between its start and its end.
- **On the board** a Vibe session that waits for your approval or your answer shows as “needs you”, because Vibe says so itself.
- **Not shown:** pictures, and sessions kept somewhere else through `session_logging.save_dir` in Vibe's own settings (point `AGENT_STANDUP_VIBE` at a home folder that has `logs/session` in it).
- **Turn it off or point it elsewhere:** in VS Code, the setting `agentStandup.vibe`; anywhere else `AGENT_STANDUP_VIBE=off`, or `AGENT_STANDUP_VIBE=/path/to/vibe-home` (command line: `--vibe off` or `--vibe DIR`). With `--projects DIR`, Vibe sessions are only read if you also pass `--vibe`.

Checked against real sessions of Vibe 2.26.1, in both formats. [Watch the 45-second video](https://atoll92.github.io/agent-standup/media/promo-vibe.mp4) ([en français](https://atoll92.github.io/agent-standup/media/promo-vibe-fr.mp4)).

## What you see for each agent

**On its tile**
- **Activity tag** (top right) — what the agent is doing right now: `Reading App.jsx`, `Editing foo.ts`, `Writing …`, `Running npm test` (or the command's own description), `Searching “pattern”`, `Listing **/*.js`, `Fetching host`, `Updating todo list`; then `✓ done` when it reports.
- **Ticker** (bottom) — the current tool call and target, with a spinner and a running counter while it executes, then `✓` / `✗` and its **real duration**.
- Status border: orange while working, spotlight while speaking, the tile fades and dissolves 2 minutes after its report.

**On the shared screen** (appears when an agent uses a tool, stays while a command is still running, then ~4 s after the last action)
- **Terminal** — `❯ command` (with its description), then its **real output** (first lines, errors in red, “… +N lines”), `● Grep(…)` / `● Glob(…)` with matches, a spinner for what is still running. Footer: `✓ Bash · 1.2 s` or `⠋ Bash · running 3.4 s`.
- **Editor** — for `Read`: the file with its real content and line numbers (read-only); for `Edit`: the removed/added lines; for `Write`: the new content, with the tool's result line.
- **Pictures** — when a tool gives the agent a picture (a screenshot it takes, an image file it reads: PNG, JPEG, GIF, WebP), the picture is shown on the shared screen, in a taller window, and stays up for several seconds (8 in a live call) whatever the agent does next. It is also in the agent's **Recent activity** and in exported videos. Pictures are read from the session file itself, never from your disk.
- **Task list** — if the agent keeps a todo list, a side panel shows it live (☐ pending, ◐ in progress, ☑ done).
- The presenter's camera lip-syncs when they speak; the subtitle bar shows what they say.

**Click an agent** — its prompt, tool counts and a **Recent activity** list (last 30 calls with status, duration, and expandable command + output).

Outputs are trimmed (about 1–2 KB each) to keep the call fast. Results of internal calls (sub-agent launches, messages) are not shown.

## Screenshots

| Real commands, real output | The exact change | Who asked whom |
|---|---|---|
| ![terminal](https://atoll92.github.io/agent-standup/media/terminal-output.jpg) | ![editor](https://atoll92.github.io/agent-standup/media/editor-diff.jpg) | ![tree](https://atoll92.github.io/agent-standup/media/tree.jpg) |

| Task list of an agent | End-of-episode recap | In French |
|---|---|---|
| ![todo](https://atoll92.github.io/agent-standup/media/todo.jpg) | ![recap](https://atoll92.github.io/agent-standup/media/recap.jpg) | ![fr](https://atoll92.github.io/agent-standup/media/hero-fr.jpg) |

## Personality, without noise
In a live call, an agent that has been at work for a while thinks to itself in a lighter bubble that is not said out loud: its own reasoning when the session keeps it, otherwise what it is on (the command it waits for, the files it goes between, its to-do item); about one in five is mumbled, low. In a live call, when the lead starts on its tools without a word after your order, it says what it is starting with ("Got it. Let me look at server.js."). Sub-agents answer when they get an order ("Running the tests, as usual.", "Grepping like there's no tomorrow."), say goodbye when they leave, and now and then have a little thought; a failing tool call makes the tile shake; confetti when the lead finishes a long job. Whoever receives a report sometimes says thanks ("Got it, thanks."), and an agent that has been thinking for a long time says so ("Hmm, let me think."). When the call has been silent for a while, someone fills the gap the way people do in video calls ("Can you hear me?", "You guys still here?", "Can everyone see my screen?"): after 45 seconds in a live call, about 10 seconds in a replay, at most three times per silence and further and further apart. It is all local (no API), absent from the transcript, and can be turned off in ⚙ → Little lines & animations.

Sub-agents also talk to each other, from what really happened: a new agent asks a question and the lead answers, a report gets a reaction that fits (all good, errors along the way, it took long) and sometimes a word from a third agent, an agent that fails three times in a row gets a “you okay?”, and every few minutes the lead calls a quick round. ⚙ → Display → **Chatter between agents**: Quiet (only the real exchanges) / Normal (default) / Lively. When the lead finishes, it reads the part of its last message that the live reading had cut short, so you know what was done.

## Glance without the panel (VS Code)
The status bar shows live counts for your workspace (needs you, working, your turn) and turns red when an agent may be waiting for you; hover for the sessions, click to open the call on the most urgent one (`agentStandup.statusBar`).

## Context gauge, highlights, loop watch
The header shows how full the lead's context is (`ctx 62%`, orange then red, with a warning before auto-compaction); tiles and list rows show it from 50%. In Replay, the **Highlights** bar jumps to the first error, the longest wait, compactions and possible loops. A 🔁 badge marks an agent repeating the exact same call or failing repeatedly. The context window (200k or 1M) is inferred, because transcripts do not state it.

## Works with your tools
| Where | How |
|---|---|
| **VS Code** | Install **Agent Standup** from the Extensions view (Marketplace). |
| **Cursor, Windsurf, VSCodium…** | Download `agent-standup-<version>.vsix` from the [latest release](https://github.com/Atoll92/agent-standup/releases/latest) and use *Extensions → … → Install from VSIX*. |
| **Any terminal, no editor** | `npx @double_geste/agent-standup --open` (Node 18+; the package is on [npm](https://www.npmjs.com/package/@double_geste/agent-standup)). Offline alternative: `npx https://github.com/Atoll92/agent-standup/releases/latest/download/agent-standup-cli.tgz --open`. |
| **A small desktop app (macOS)** | Download `Agent-Standup-<version>-mac-apple-silicon.zip` (or `-mac-intel.zip`) from the release, unzip, move *Agent Standup* to Applications. The app is **not signed with an Apple developer ID**, so the first time: right-click the app → *Open* → *Open* (or run `xattr -dr com.apple.quarantine "/Applications/Agent Standup.app"`). It has a window and an indicator in the menu bar, and notifies you when an agent may need you. Windows and Linux builds (`-windows-x64.zip`, `-linux-x64.zip`) are on the same release page but **experimental and not tested by hand**. |
| **Claude Code status line** | `npm i -g @double_geste/agent-standup`, then in `~/.claude/settings.json`: `{ "statusLine": { "type": "command", "command": "agent-standup statusline" } }` → shows `⚙2 ✋1` under your prompt. |
| **tmux** *(not tested here)* | `set -g status-right '#(agent-standup status --here)'` |
| **Neovim** *(not tested here)* | call `vim.fn.system('agent-standup status --here')` from a timer and show the result in your statusline plugin; `agent-standup status --json` gives machine-readable output. |
| **JetBrains IDEs** *(not native yet)* | *Settings → Tools → External Tools → +*: program `npx`, arguments `-y @double_geste/agent-standup --open`, working directory `$ProjectFileDir$`. |

Codex and Mistral Vibe sessions are read as well (see [Codex sessions too](#codex-sessions-too) and [Mistral Vibe sessions too](#mistral-vibe-sessions-too)). Other agent tools (Gemini CLI, OpenCode…) are researched in [ROADMAP.md](ROADMAP.md): their log formats are mostly undocumented, so no adapter is shipped for them yet.

## Languages
Pick one in ⚙ → Language: **English, Français, 繁體中文, 简体中文, Español, Deutsch, Dansk, Português (Brasil), 日本語, 한국어**. The interface (menus, chips, tooltips, recap) is translated; VS Code's command titles, setting descriptions and status bar follow VS Code's own display language. English and French are written by hand; the other languages are **AI-drafted and not yet reviewed by native speakers**, so corrections are very welcome: each language is one small JSON file (`public/locales/<code>.json`), see [public/locales/README.md](public/locales/README.md) to fix or add one (`npm run i18n` checks the files). The words the agents say stay in the language of your session (French translation of their lines is optional); the little banter lines and the demo exist in English and French.

## Your own characters
**Your own agent names.** A sub-agent you defined yourself (`.claude/agents/code-reviewer.md`) or named when it was launched keeps that name on its tile, in the transcript and in the voices: "Code Reviewer" rather than a first name drawn from the list. Two of the same type become "Code Reviewer" and "Code Reviewer 2". The agent types Claude Code ships (general-purpose, Explore, Plan…) still get a first name. ⚙ → Characters → **Keep my agents’ own names** turns it off.

A cat pack ships with the app: ⚙ → Characters → **Cat pack** (11 cats by a contributor) puts them on the call at once, and **Drawn characters** goes back to the default. **My folder** uses your own images below (picked by itself the first time if your folder already has images).

Replace the drawn characters with your own pixel art. Drop PNG (or GIF/WebP) files, 300 KB at most each, into `~/.agent-standup/characters` (⚙ → Characters shows the folder, and in VS Code *Open folder* opens it; the `agentStandup.charactersPath` setting changes it):
- `lead.png` (or `claude.png`) is the lead, `you.png` is you, any other image becomes a sub-agent (one per agent: two sub-agents only share an image once every image is taken);
- `name-talk.png` next to `name.png` is an optional open-mouth frame that shows while the character speaks;
- 32×32 or 64×64 px, transparent background, facing front, feet at the bottom looks best. The art is shown crisp (no smoothing) on top of the usual scene and desk, and every status, hand and badge still works.
Your characters sit at the desk without the laptop (it would cover the bottom of the sprite); ⚙ → Characters → **Laptop in front of your own characters** puts a darker one back while they work. Press **Reload** in the menu to see changes. Three example images to start from are in [examples/characters](examples/characters) (in the repository, not shipped with the app), and the cat pack is in [examples/cats](examples/cats).

## Agents list
On wide windows (900 px+), a fixed list sits left of the call: every agent with its role and one status line, **most urgent first** (needs you, stalled, working, waiting, done) and the lead pinned on top. It stays readable with dozens of agents, which a grid of tiles does not. Click a name to put that agent in the spotlight (kept for 25 s even when someone else speaks), double-click for details. Toggle it in ⚙ → Agents list.

## All your sessions (Sessions view)
The **Sessions** tab lists every session active in the last 12 hours, across all projects, with one state each: working, needs you?, waiting on sub-agents, your turn, or idle (and how many sub-agents are active). It refreshes every few seconds and reads only the end of each transcript, so thirty parallel sessions stay cheap. Click a card to follow that session in the call.

## At a glance
Every tile carries one status: **working** (with what it is doing), **waiting on another agent** (who), **needs you?** (a file edit or write, or a question, has been pending for 15 s+), **stalled** (waiting on an agent that has been silent for 2 min+), or **done**. A summary sits in the header, and the tab title shows how many agents need you. The "needs you?" signal is a heuristic: Claude Code does not record permission prompts, so commands (Bash) are not flagged because they can legitimately run for minutes (they get a ⏳ badge after 1 min instead). Measured on real sessions, edits that stay pending for 15 s+ are rare, so the signal is mostly right.

## Voices
Each line is read with a voice of its own language (French or English), whatever language the interface is in.

Five styles in ⚙ (default: **Cartoon voices**, so everything stays understandable):
- **Animal Crossing** — every agent "talks" in gibberish, one blip per letter, with a sentence melody (up for questions, down for statements) and a register of its own.
- **Simlish** — the same idea with flowing syllables, vowels and little consonant noises.
- **Cartoon voices** — the real words read by your system voice, with a character per agent (chipmunk, deep, robot, wobbly, radio, monster, squeaky).
- **Natural voices** — plain system voices.
- **Very natural voices** — [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), a small open speech model that runs on your machine. Optional: pick it in ⚙ and click Install (about 730 MB, one folder in your user cache, installed with npm; the model is fetched on first use). Until it is ready the system voices keep talking. Its voices are English: French lines are read by your system voices, each character keeping one of its own (see [Voice engines](#voice-engines-per-os) to install a better French voice).

**Our tip:** once you are set up, switch to *Very natural voices*. It is a one-time install and the agents then sound like real people, which is the nicest way to follow a call.

Long lines are subtitled one sentence at a time, in step with the voice.

## Handy extras
- **Copy as Markdown** in the recap: a ready-to-paste standup report (who did what, files, tokens, final report of each agent).
- **Notify me when agents finish** (⚙): a soft chime, the tab title and, in VS Code, a notification once the team has worked for a while and gone quiet.
- **Search** the transcript, **ambience volume**, and a compact layout when the panel is narrow (side bar): under about 300 px wide, one row per agent instead of tiles. In replay, speed presets (1×, 2×, 4×, 8×) and each session remembers where you stopped.

## Install
Four ways in — pick one (details in [Works with your tools](#works-with-your-tools)): the **VS Code extension** (below), the **`agent-standup` command** (`npx @double_geste/agent-standup --open`), the **desktop app** (macOS, from the release page), or the **[Claude Code plugin](#claude-code-plugin)**. Cursor, Windsurf and VSCodium install the same `.vsix`.

### VS Code

### Option 0 — from the Marketplace (easiest)
In VS Code: Extensions view → search **Agent Standup** → Install. Or: https://marketplace.visualstudio.com/items?itemName=DoubleGeste.agent-standup

### Option A — from a GitHub Release
1. Open the repository's **Releases** page and download `agent-standup-<version>.vsix` (don't send it by email: Gmail and others block `.vsix` files).
2. In VS Code: Extensions view → `…` menu (top right) → **Install from VSIX…** → pick the file.
   Or from a terminal: `code --install-extension agent-standup-<version>.vsix` (macOS: run *Shell Command: Install 'code' command in PATH* first if `code` isn't found).
3. **Developer: Reload Window**, then click the camera icon in the Activity Bar (or run **Agent Standup: Open live call**) and press **Join**.

Direct download of the latest version: https://github.com/Atoll92/agent-standup/releases/latest/download/agent-standup.vsix  
Or with the GitHub CLI: `gh release download --repo Atoll92/agent-standup --pattern "*.vsix"`, then the `code --install-extension` line above.

### Option B — build it yourself
```bash
git clone https://github.com/Atoll92/agent-standup.git
cd agent-standup
npm run package                       # needs Node 18+; produces agent-standup-<version>.vsix
code --install-extension agent-standup-*.vsix
```
To hack on it instead: open the folder in VS Code and press **F5** (launches an Extension Development Host).

### Option C — no extension
After cloning the repository (Option B): `node server.js` and open http://localhost:4747 (see *Standalone* below). Without cloning: `npx @double_geste/agent-standup --open`.

The first click on **Join** is required by browsers to allow sound.

### Commands

| Command | What it does |
|---|---|
| **Agent Standup: Open live call** | Opens the call in a panel beside the editor |
| **Agent Standup: Show sidebar** | Opens the call in the Activity Bar view |
| **Agent Standup: Open characters folder (your own pixel art)** | Creates and opens the folder for your own characters |
| **Agent Standup: Open in browser (voice + sound)** | Opens the same call in your default browser |

### Settings

| Setting | Default | |
|---|---|---|
| `agentStandup.port` | `0` | Local port of the server. `0` = a free port is picked automatically for each VS Code window (recommended) |
| `agentStandup.statusBar` | `true` | Live counts in the VS Code status bar (needs you / working / your turn) for this workspace |
| `agentStandup.shareUsage` | `false` | Opt-in, anonymous: at most one empty request per day to a 1-pixel file on GitHub, to count active installs (ignored when VS Code telemetry is off) |
| `agentStandup.charactersPath` | _(empty)_ | Folder with your own character images (default `~/.agent-standup/characters`) |
| `agentStandup.codex` | `true` | Also show Codex sessions (read from `~/.codex/sessions`, or `$CODEX_HOME`). Turn off to show Claude Code sessions only |
| `agentStandup.vibe` | `true` | Also show Mistral Vibe sessions (read from `~/.vibe/logs/session`, or `$VIBE_HOME`). Turn off to leave them out |
| `agentStandup.claudePath` | _(auto)_ | Full path to the Claude Code executable if it isn't found automatically (needed only for French translation) |
| `agentStandup.autoOpen` | `false` | Open the call when VS Code starts |
| `agentStandup.onlyThisWorkspace` | `true` | Follow only sessions started in the open folder (falls back to the newest session if there is none) |

## Controls

| | |
|---|---|
| **Call · Tree · Sessions** (Appel · Arbre · Sessions in French) | tiles, hierarchy, or one card per recent session |
| **⏸ / ▶** (Space) | pause / resume |
| **☰** | transcript |
| **🔊 / 🔇** (M) | mute everything |
| **⚙** | language · voices · ambience · **office music (station + volume)** · agents list · little lines & animations · reactions bar · remove finished agents · **Live / Replay / Demo** (and project / session picker) · recap · export video · clip to share (25 s) · hide code & file names in videos |
| **T** · **R** · **L** | tree/call · recap · transcript |
| Esc | close recap / menu |

In Replay and in the demo, a slider and a speed control appear at the bottom, and clicking a transcript line jumps there.

## Office music

Turn on **Office music** in ⚙ and pick a station (FIP, Groove, Jazz, Electro, Reggae, Rock, Nouveautés, Pop) and a volume. The stream is played live from Radio France's public Icecast servers directly in the page; it starts when you press **Join** (browsers require a click). When any agent speaks, the music drops to ~15 % within a fraction of a second and returns slowly after the last line. Muting (🔊 / M) stops the stream. Music is for your ears only: it is **never included in video exports**. Stations are for personal listening; nothing is stored or redistributed.

## One window talks at a time

If several Agent Standup windows are open on the same machine (sidebar, editor panel, browser tab), only the last one where you pressed **Join / Play / 🔊** plays sound; the others stay silent and show 🔈 (click it to take the sound back). This avoids hearing the same call twice, possibly in two languages. A window that stops answering releases the sound after a few seconds.

## Voice engines (per OS)

Voices are generated on your machine and played identically in the editor and in the browser:

| OS | Engine | Notes |
|---|---|---|
| macOS | `say` | For nicer voices: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices → download a *Premium* / *Enhanced* voice. French is always read by these voices, also in the *Very natural* style: an Enhanced French voice (Thomas, Audrey, Aurélie) is worth the download |
| Windows | installed system voices (SAPI, via PowerShell) | For French: Settings → Time & language → Speech (or Language) → add French |
| Linux | `espeak-ng` | Must be installed |

If no voice is available the agents "mumble" instead. Each agent gets a stable voice from the best ones installed.

## Translation (French ↔ English)

Agent messages are in the language of the session. With French selected, each line is translated as it arrives using your local `claude` CLI (`claude -p`, Haiku) through two warm background workers: about 3–4 s per line once warm (the very first line takes ~10 s), then spoken. If a translation is not ready in time (7 s live), that line is read in the original language. The menu shows a hint if translation or the French voice is unavailable.

Optional speed-up: set `ANTHROPIC_API_KEY` in the environment of VS Code / the server and translation calls the Anthropic API directly (~1–2 s).

**Privacy & security:** everything runs locally. The server listens on `127.0.0.1` only and rejects requests that do not come from `localhost` (other websites and DNS-rebinding attempts get a 403), so no web page can read your sessions. Translation and jokes send the shortened agent lines to Claude through your own Claude Code login (or your API key if you set one). With translation, jokes and music off, which is the default, nothing leaves your machine. (Office music connects your browser to `icecast.radiofrance.fr` while it is on.)

## Standalone (no VS Code)

```bash
node server.js            # http://localhost:4747   (PORT=… to change)
```

- `http://localhost:4747/` → live, newest session
- `http://localhost:4747/?live=0` → replay picker
- `?proj=<project-dir>` → limit live to one project folder under `~/.claude/projects`

Requires Node 18+.

## How it works

Claude Code writes every session to `~/.claude/projects/<project>/<session>.jsonl`, and each sub-agent to `<session>/subagents/agent-*.jsonl` (with a `.meta.json` linking it to the tool call that created it). Agent Standup merges these into one timeline: orders (the prompt a lead sends to a sub-agent), spoken text, tool calls (with their inputs), the **results** of those calls (matched by tool-call id, with real durations) and final reports. Each file is parsed once and then only the new lines are read, so even a very large session refreshes in a few milliseconds; responses are compressed. The page polls the server every 0.7 s and plays new events.

The website at agent-standup.com counts nothing. The earlier landing page on GitHub Pages counts visits anonymously (a 1-pixel file hosted on GitHub per channel: no cookies, no third-party tracker) and asks GitHub which release is the latest. The app itself has no telemetry. Details in the [privacy policy](PRIVACY.md).

## Troubleshooting

- **Nothing happens / "Waiting for a session"** — start Claude Code in the open folder; with `onlyThisWorkspace` the call follows that folder.
- **Panel is blank** — use **Open in browser**; if you set a fixed `agentStandup.port` it may be taken (use `0`).
- **Two voices at once (e.g. French and English)** — update to ≥ 1.8.1: only one window plays sound now. A line that could not be translated in time is read by an English voice, not by a French voice reading English.
- **No sound** — press **Join** (or Play) once; check 🔊 isn't muted and *Agent voices* is on in ⚙.
- **French is read in English / hint about translation** — Agent Standup looks for Claude Code in your `PATH`, the usual install folders (Homebrew, npm, nvm, `~/.local/bin`, Windows `%APPDATA%\npm`) and the copy bundled with the official VS Code *Claude Code* extension. If none is found the app quietly stays in English; set `agentStandup.claudePath`, or run `claude` once in a terminal to sign in. If VS Code itself was started from inside a Claude Code session, restart it normally.
- **Characters or backgrounds look empty** — update to ≥ 1.2.1 (fixed a duplicate SVG id bug).
- **Terminal output missing for a command** — the call is still running (spinner), or it is an internal call (sub-agent launch / message); outputs are only recorded once a call finishes.
- **Pill says OFFLINE** — the local server stopped answering (another VS Code window that was serving the port was closed: the extension takes over within a few seconds), or restart `node server.js`.
- **Delay behind the real session** — expected ≈ 5–7 s in French (translation), ≈ 2 s in English; the call skips ahead when it falls too far behind.

## Limits

- Tool outputs are trimmed (about 1–2 KB each); the shared screen shows the beginning of long outputs.
- Output only exists once a tool call has finished: a running command shows a spinner and its live timer, not partial output.
- Voices on macOS/Windows/Linux differ in quality; Windows needs a French voice installed for French.
- Very large sessions (10 MB+ of transcript) take a second or two to load the first time (about 1.9 s for a 12 MB, 168-sub-agent session on a recent Mac); after that updates take milliseconds.
- Video export and the clip record in real time and need a Chromium-based browser/VS Code. MP4 recording was checked in Chrome; it has not been tested inside VS Code's own panel, which may still produce a `.webm`.
- "Hide code & file names in videos" does not mask what the agents say (speech bubbles, subtitles, voices).

## Credits
Several ideas in 1.23 (settings kept in a file, session stickiness, subtitles that follow the voice, Kokoro voices) started in [neondragon's fork](https://github.com/neondragon/agent-standup) of this project. Thank you!  Their code was read and rewritten for this codebase. [rqwj](https://github.com/rqwj) made each sub-agent get its own character image (#1) and [KajetanCiunelis](https://github.com/KajetanCiunelis) drew the cat pack in `examples/cats` and suggested the laptop option (#2). The Traditional Chinese wording was polished with suggestions from a Taiwanese reader on Reddit. [jainefer](https://github.com/jainefer) added the Korean interface (#5). Unofficial: not affiliated with Anthropic, OpenAI or Mistral AI.

## License

MIT

## Support the project / work with me
This dev was replaced by his own agents. If Agent Standup made your sessions more fun, you can [buy him a coffee](https://www.buymeacoffee.com/bored_dev_and_his_robots) ☕ — there is also a ☕ line in the ⚙ menu and at the end of each recap.

Agent Standup is free and MIT licensed. I'm also available for work around AI agents and developer tooling: reach me through my GitHub profile, [Atoll92](https://github.com/Atoll92).

## Settings menu and shortcuts
⚙ has sections that fold (and remember it), a search box, and a Display section. “Notify me when the agents finish” is on by default (change it in ⚙ → Sound). The **?** help also explains what each status means.

Press **?** in the app for the full list. Highlights: **Space** pause, **M** mute, **T** tree view, **J / K** next agent that needs you, **Cmd/Ctrl+K** go to a session, and in replay **← / →** step, **N** next highlight.

## Name and logo
The code is MIT licensed: use it, change it, fork it. The name, the logo and the characters are how people recognise this project, and they are not there to brand something else. [TRADEMARKS.md](TRADEMARKS.md) says what is fine (writing about it, building on it, shipping it unmodified) and what needs asking first (releasing a fork under this name, using the logo or the characters for another product). The artwork and its colours are in [brand/](brand/).

## Security and what it reads
The full [privacy policy](PRIVACY.md) says what is read, what is kept on your computer and what can leave it.

- **It reads local files and sends nothing by default.** Agent Standup reads the session files Claude Code already writes (`~/.claude/projects`, or `CLAUDE_CONFIG_DIR`) and the ones Codex and Mistral Vibe write (`~/.codex/sessions`, or `CODEX_HOME`; `~/.vibe/logs/session`, or `VIBE_HOME`; each can be turned off) and draws them in a page. It never writes to your sessions; the only time it starts Claude Code is the optional translation helper described below.
- **Local only.** The server listens on `127.0.0.1` (never on the network), refuses requests whose Host or Origin is not local, and refuses cross-site requests on every endpoint that does something (translation, jokes, sound, settings).
- **The only things that call out** are optional and off by default: French translation and jokes (your own Claude login, the small Haiku model, with all tools disabled; when one of them is on, the lines of a Codex session are sent the same way, to Anthropic), the FIP radio stream, and the usage counter (one empty request a day to a 1-pixel file, only if you turn it on).
- **No dependencies**: the code is plain Node.js and one HTML file, so there is nothing hidden in `node_modules`. The optional Kokoro voices install a third-party package only when you click Install.
- **Many sessions at once?** The **Sessions** view shows every session across your projects on one board (working, waiting, needs you, done); click one to open its call. **Live** follows one session at a time, the most recent or the project you pick.
- Found a problem? Please open an issue.

## Privacy and usage counting
Agent Standup reads local session files and sends nothing anywhere by default. The only optional network uses are: French translation / jokes (your own Claude login, off unless you turn them on), the FIP radio stream (if you turn it on), and the **optional usage counter**: if you set `agentStandup.shareUsage` to `true` (off by default, and ignored when VS Code telemetry is off), the extension makes at most one empty request per day to a 1-pixel file in this repository's releases. There is no identifier and no content; GitHub sees your IP like for any download. It lets the maintainer count active installs (`npm run stats`).
