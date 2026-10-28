![Agent Standup: your AI agents, in a stand-up call](https://atoll92.github.io/agent-standup/media/banner.png)

# Agent Standup

**See which of your agents is working, stuck, waiting on another one, or burning tokens — across all your Claude Code, Codex, Mistral Vibe and Cowork sessions, at zero token cost.** Agent Standup turns the session files Claude Code, Codex and Mistral Vibe already write into a live team call (and a board of every session): it only reads local files and never calls Claude unless the call is held in French, Spanish or Brazilian Portuguese, or you turn on the jokes.

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=DoubleGeste.agent-standup"><img src="https://atoll92.github.io/agent-standup/media/install-vscode.png" width="380" alt="Install in VS Code: free and open source"></a>
  <br>
  <a href="https://open-vsx.org/extension/DoubleGeste/agent-standup"><img src="https://atoll92.github.io/agent-standup/media/install-openvsx.png" width="260" alt="Cursor, Windsurf and VSCodium: install from Open VSX"></a>
  <a href="https://github.com/Atoll92/agent-standup/releases/latest"><img src="https://atoll92.github.io/agent-standup/media/install-macos.png" width="260" alt="macOS app: free download, no editor needed"></a>
</p>

**No editor? Try it in 30 seconds from any terminal** (Node 18+), then ⚙ → Source → Demo if you have no session yet:

```sh
npx @double_geste/agent-standup@latest --open
```

**Your Claude Code, Codex or Mistral Vibe session as a live team call.** The lead gives orders, sub-agents join the call, work at their desks, share their screen and report back — with voices, expressions and a view of the real work as it happens.

**Works with:** Claude Code · Codex · Mistral Vibe · Cowork — in VS Code, Cursor, Windsurf, any terminal, or as a desktop app.

**Just installed the extension?** Click the Agent Standup icon in the Activity Bar (or run **Agent Standup: Open live call**): the call starts at once, silent, and your first click in it turns the sound on. No session yet: press **▶ Watch the demo**.

**→ Website & download: https://agent-standup.com**

🌐 [Français](https://agent-standup.com/fr/) · [繁體中文](https://agent-standup.com/zh-tw/) · [简体中文](https://agent-standup.com/zh-cn/) · [Español](https://agent-standup.com/es/) · [Deutsch](https://agent-standup.com/de/) · [Dansk](https://agent-standup.com/da/) · [Português](https://agent-standup.com/pt-br/) · [日本語](https://agent-standup.com/ja/) · [한국어](https://agent-standup.com/ko/)

![Agent Standup: a team of AI agents in a call](https://atoll92.github.io/agent-standup/media/hero.gif)

_A fictional team fixing a slow login page — the built-in demo (⚙ → Source → Demo). [Watch the full 1-minute video](https://atoll92.github.io/agent-standup/media/demo.mp4)._

**New: Agent Standup is on YouTube.** The first video is the very session that made it, replayed in the app with its own voices (2 min 51). [Subscribe to the channel](https://www.youtube.com/@Agent_Standup?sub_confirmation=1).

<a href="https://www.youtube.com/watch?v=EI5tMlxN4wI"><img src="https://atoll92.github.io/agent-standup/media/youtube-first-video-play.jpg" width="640" alt="Watch on YouTube: This video was made by the Claude Code agents you see in it"></a>

## Halloween pack (optional)

<a href="https://agent-standup.com/shop/?ref=readme"><img src="https://agent-standup.com/thanks/cast.jpg" width="640" alt="The Halloween pack: eight characters drawn by hand, each in its own room"></a>

Eight characters drawn by hand by [Fabien Coupas](https://www.instagram.com/fabien_coupas/), each in its own room: a pumpkin leads the call, you are a vampire, and a ghost, a cat, a bat, a wolf, a witch and a crowd of skeletons do the work.

**It is entirely optional.** Agent Standup is and stays free and MIT licensed, and nothing in it is locked behind the pack: every feature and the default characters stay as they are, and the vampire is free for everyone. Buying the pack (2 €, or more if you like) is simply a way to support the artist who drew it and the developer who makes the app; the money is shared between them.

[See the pack](https://agent-standup.com/shop/?ref=readme), or in the app: ⚙ → Characters → Halloween pack. The pack's pictures are not part of the open-source code: they remain the artist's work.

[![Buy me a coffee](https://img.shields.io/badge/-Buy%20the%20dev%20a%20coffee-ffdd00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/bored_dev_and_his_robots)

> Unofficial community project, not affiliated with or endorsed by Anthropic, OpenAI or Mistral AI. "Claude" is a trademark of Anthropic; "Codex" is a trademark of OpenAI; "Mistral" is a trademark of Mistral AI.

## What you get

- **Token usage per agent** — a ⚡ counter in the header, on each tile, on each line of the agents list and in the camera of the agent who shares its screen shows how many tokens each agent used (input + output + cache writes; cache reads shown separately in the tooltip), counted once per message as recorded by Claude Code. Handy to see which sub-agent is the expensive one. When a session mixes models, each count says which model spent it (“⚡ 391 · Haiku”). It is read from the session files, not an estimate of your bill.
- **Stuck or quiet agents** — in the live call, a tile pulses amber with ⏳ when a command has been running for over a minute, shows 💤 when a working agent has gone quiet for 3 minutes, a red ✗ counter for failed tool calls, and a ♻ count of repeated work (a file read again with no change, the same search twice, a failing command run again). Hover any of these badges (or tap it) to see the calls behind it. The browser tab title shows how many agents are working.
- **Built-in demo** — no session yet? ⚙ → Source → **Demo** plays a fictional team (no data of yours).
- **Live call** — follows your newest session (Claude Code, Codex or Mistral Vibe) in real time. Each agent is a small character at its desk; the one who speaks gets the spotlight and keeps it until someone else talks. Agents never talk over each other: when several have something to say at once, they take turns, so every line is heard.
- **Real voices, lip-sync** — lines are spoken aloud by a small speech model on your machine (a one-time install); mouths follow the actual volume of the voice. Until then, and if you prefer it, the agents babble (see [Voices](#voices)).
- **Live screen sharing with the real output** — when an agent works, its screen fills the stage (presenter's camera in the corner, "sharing" badge): a **terminal** with the command history and the actual output of each command, search results and tool calls; or an **editor** with the file it reads (real content and line numbers) or the exact diff it applies. See *What you see for each agent* below.
- **Agents come and go** — a sub-agent joins when it is given a task and leaves the call 2 minutes (playback time) after its report, with a dissolve animation. It comes back if it gets a new task.
- **Sub-agent tree** — the full hierarchy (you → the lead → sub-agents → their sub-agents) with status, tool counts and the current action.
- **Click any agent** — its prompt, tool usage and reports.
- **Replay** — pick any past session, scrub through it, see a timeline of who worked when, and get a **recap** (agents, tool calls, commands, files changed, busiest agents).
- **Video export** — ⚙ → Tools → 🎞 Export video records the call at 1280×720 with voices and subtitles, as an MP4 (H.264 + AAC) when the browser can record it, and as a `.webm` when it cannot. X, phones and most chat apps refuse `.webm`.
- **Clip to share** — ⚙ → Tools → 🎬 Clip to share (25 s) records about 25 seconds, saved as `agent-standup-clip.mp4` (`.webm` when the browser cannot record MP4). In the middle of a replay it starts at the current position; otherwise one spoken line before the first error or loop of the session, and failing that at the moment the lead first hands out work. The line being said when time is up is finished rather than cut, so the length varies by a few seconds. The clip carries the site address (atoll92.github.io/agent-standup) in the top right corner and ends with a short end card; the full export has neither.
- **Hide code & file names in videos** — ⚙ → Tools, off by default, for the full export and the clip. Commands, their output, file contents, diffs and search results on the shared screen are drawn as grey bars of the same length; file names are removed from the window title and from the activity tags on tiles (the tool's name, e.g. `Bash` or `Read`, stays); the session title is replaced by "Agent Standup"; pictures (screenshots, images) become an empty frame. **What the agents say is not masked**: speech bubbles, subtitles and voices are kept as they are, so check the clip before posting if agents quote code or names aloud.
- **In French, Spanish or Portuguese too** — the call can be held in French, Spanish or Brazilian Portuguese: agent text is translated on the fly and read by voices of that language (see below).
- **Office music** — optional live web radio (FIP and its themed stations) that fades down smoothly while an agent talks and fades back up when the room goes quiet.
- Office ambience, optional (off by default) and fully synthesised: keyboards that type when agents run commands, clicks when they read, a coffee machine, a phone buzzing, a far-away door… (⚙ → All settings → Office ambience). Plus small reactions and jokes between agents ("episode mode").

## Claude Code plugin

You can also open the call from inside Claude Code. The [plugin](plugin/) adds two skills: `/agent-standup:open` starts the app and opens the call in your browser, and `/agent-standup:status` says in one line who is working and who needs you.

    /plugin install agent-standup --marketplace Atoll92/agent-standup

On Claude Code before 2.1.275: `/plugin marketplace add Atoll92/agent-standup`, then `/plugin install agent-standup@double-geste`. The plugin runs the same npm package as the command line, pinned to an exact version.

**A line above your prompt.** A second plugin, [agent-standup-band](plugin-band/), shows above the Claude Code prompt which other session waits on a question or an approval, and a short toast when one starts waiting or finishes its turn, in the terminal and in the Claude desktop app's Code tab (Claude Code 2.1.294 or later). It reads only `~/.claude/sessions`, needs no Node.js and sends nothing:

    /plugin install agent-standup-band --marketplace Atoll92/agent-standup

## Codex sessions too

Sessions of OpenAI’s Codex (the desktop app and the `codex` command) appear next to your Claude Code sessions: in the session list (project “Codex”), on the board, and in the live call when one of them is the session you last typed in. Nothing to set up: the app reads the files Codex already writes in `~/.codex/sessions` (or `$CODEX_HOME`), and never writes there.

- **What is shown:** what you typed, what the agent says, each command with its real output and whether it failed, files it created or changed, web searches, MCP calls, the questions it asks you, its reasoning summaries as inner thoughts, token counts, and the end of each turn.
- **Compressed sessions too.** Recent versions of Codex compress the sessions you are no longer in (`rollout-….jsonl.zst`). They are listed and replayed like the others, but reading them needs Node 22.15 or later: from the command line that is your own `node`; the desktop app has it; in VS Code, Cursor or Windsurf it is the editor's own runtime, so an older editor lists only the sessions Codex has not compressed.
- **Codex sub-agents** join their lead's call, with their own names, commands, results, token counts and final reports, and their own sub-agents too. They are not listed as sessions of their own. The short reviews Codex runs on its own before a command are not shown as sessions.
- **In VS Code** the call follows the Codex sessions started in the folder you have open, like it does for Claude Code.
- **Turn it off or point it elsewhere:** in VS Code, the setting `agentStandup.codex`; anywhere else `AGENT_STANDUP_CODEX=off`, or `AGENT_STANDUP_CODEX=/path/to/codex-home` (command line: `--codex off` or `--codex DIR`). With `--projects DIR`, Codex sessions are only read if you also pass `--codex`.

## Mistral Vibe sessions too

Sessions of [Mistral Vibe](https://github.com/mistralai/mistral-vibe) (Mistral's coding agent, the `vibe` command) appear next to your Claude Code sessions: in the session list (project “Mistral Vibe”), on the board, and in the live call when one of them is the session you last typed in. Nothing to set up: the app reads the folders Vibe already writes in `~/.vibe/logs/session` (or `$VIBE_HOME`), and never writes there.

- **What is shown:** what you typed, what the agent says, each command and tool call with its real output and whether it failed, files it created or changed, its todo list, its reasoning as inner thoughts, token totals, the end of each turn, and **its sub-agents**: each one joins the call under the name the lead gave it, with its orders and its answers.
- **Two engines, both read.** Vibe 2.26 starts a new engine by default, which keeps the time of every event: the call is exact. With it a sub-agent leaves no record of its own, so you see what the lead asked it and what it answered, not each of its commands. The earlier engine (`vibe --legacy-harness`, and older versions) does record a sub-agent's own commands, but writes no times and saves at the end of each step: followed live the times are right to within a step, and a session opened afterwards is spread between its start and its end.
- **On the board** a session of Vibe's current engine that waits for your approval or your answer shows as “needs you”, because Vibe says so itself, for as long as the Vibe that has it open still runs (up to four hours). Once that Vibe is closed it no longer needs you, and where the app cannot tell (a Vibe that keeps no lock on the sessions it has open) “needs you” lasts half an hour. The earlier engine (`vibe --legacy-harness`) does not write that it waits, so its sessions never show “needs you”.
- **Not shown:** pictures, and sessions kept somewhere else through `session_logging.save_dir` in Vibe's own settings (point `AGENT_STANDUP_VIBE` at a home folder that has `logs/session` in it).
- **Turn it off or point it elsewhere:** in VS Code, the setting `agentStandup.vibe`; anywhere else `AGENT_STANDUP_VIBE=off`, or `AGENT_STANDUP_VIBE=/path/to/vibe-home` (command line: `--vibe off` or `--vibe DIR`). With `--projects DIR`, Vibe sessions are only read if you also pass `--vibe`.

Checked against real sessions of Vibe 2.26.1, in both formats. [Watch the 45-second video](https://atoll92.github.io/agent-standup/media/promo-vibe.mp4) ([en français](https://atoll92.github.io/agent-standup/media/promo-vibe-fr.mp4)).

## Cowork sessions too

Sessions of Cowork (a tab of the Claude desktop app) appear next to your Claude Code sessions: in the session list (project “Cowork”), on the board, and in the live call when one of them is the most recent. Nothing to set up: Cowork records its sessions in the format of Claude Code, in the desktop app's own folder (`local-agent-mode-sessions`). Agent Standup reads them there and never writes there.

- **What is shown:** all that a Claude Code session shows, sub-agents included. A session has the name the desktop app gave it, its tab has a small “Cowork” mark, and in its call the lead reads “Lead · Cowork”.
- **Scheduled tasks are sessions too.** A task Cowork runs on a schedule appears when it runs. Nobody typed it, so it does not take the call from a session you are working in: the live call goes to it when nothing you typed in is still at work.
- **Not the Chat tab.** A conversation in the Chat tab of the desktop app is kept on Anthropic's servers, not on your computer: there is nothing for Agent Standup to read. The Code tab is Claude Code, and has always been shown.
- **A window that follows one folder** (VS Code open on a project) leaves Cowork sessions out of its call: a Cowork session is in no folder of yours. The Sessions view lists them everywhere.
- **Where it looks:** `~/Library/Application Support/Claude` on macOS, `%APPDATA%\Claude` on Windows (and the app's own folder under `%LOCALAPPDATA%\Packages` when it is installed as a Windows package), `~/.config/Claude` on Linux. Checked against real sessions on macOS; the Windows and Linux places are not tested yet.
- **Turn it off or point it elsewhere:** `AGENT_STANDUP_COWORK=off`, or `AGENT_STANDUP_COWORK=/path/to/local-agent-mode-sessions` (command line: `--cowork off` or `--cowork DIR`). With `--projects DIR`, Cowork sessions are only read if you also pass `--cowork`. There is no VS Code setting for it yet.

## What you see for each agent

**On its tile**
- **Activity tag** (top right) — what the agent is doing right now: `Reading App.jsx`, `Editing foo.ts`, `Writing …`, `Running npm test` (or the command's own description), `Searching “pattern”`, `Listing **/*.js`, `Fetching host`, `Updating todo list`; then `✓ done` when it reports.
- **Ticker** (bottom) — the current tool call and target, with a spinner and a running counter while it executes, then `✓` / `✗` and its **real duration**.
- Status border: orange while working, spotlight while speaking, the tile fades and dissolves 2 minutes after its report.

**On the shared screen** (appears when an agent uses a tool, stays while a command is still running, then ~4 s after the last action)
- **Terminal** — `❯ command` (with its description), then its **real output** (first lines, errors in red, “… +N lines”), `● Grep(…)` / `● Glob(…)` with matches, a spinner for what is still running. Footer: `✓ Bash · 1.2 s` or `⠋ Bash · running 3.4 s`. The command is typed and its output scrolls in, in under a second (not while catching up, above 2× or with reduced motion). `git diff` and `git show` are in colour.
- **Live output of a background command** — a command an agent runs in the background (or a Monitor) streams its lines as Claude Code writes them, with a red ● LIVE, until “exited with code N”. Read from the file Claude Code writes in its temporary folder, on this computer, while the command is on screen; a command still writing when you open the call, or after the turn ended, is shared once.
- **Test runs** — a test command (node, vitest, jest, pytest, mocha, go, cargo) shows its passed / failed / skipped counts in large, a green or red bar and the names of the tests that failed.
- **Editor** — for `Read`: the file with its real content and line numbers (read-only); for `Edit` and `Write`: the diff Claude Code recorded, with real line numbers and context; a Bash command that edited files (`sed -i`, a script) shows its diff too.
- **Pictures** — when a tool gives the agent a picture (a screenshot it takes, an image file it reads: PNG, JPEG, GIF, WebP), the picture is shown on the shared screen, in a taller window, and stays up for several seconds (8 in a live call) whatever the agent does next. It is also in the agent's **Recent activity** and in exported videos. Pictures are read from the session file itself, never from your disk.
- **The browser an agent drives** — when an agent drives Chrome (Claude in Chrome) or the Claude desktop app's own browser, the shared screen becomes a browser window: the page's title and address, its last screenshot, a pointer that glides to each click, what it types, and the agent's own words for each step. All of it is read from the session file.
- **Artifacts** — when a Claude Code session publishes an artifact (a page on claude.ai), its author shares it in a browser window on the shared screen: the real page, shown whole. When the turn ends it is in the line of files (🌐); click it there, or click the window, to pin it: full size, usable, until you close it (✕ or Esc). A pinned page follows the next versions the session publishes, ‹ › step through the other artifacts of the session, and ↗ opens the page on claude.ai. The page is put together from the session file (the Write and Edit calls that made it), never from your disk and never from claude.ai, and runs in a frame that can reach neither the app nor the network. A page that uses libraries kept on a CDN shows **Load its libraries** (also ⚙ → All settings → Display → **Artifacts: load their libraries**), off by default. An artifact made from a claude.ai template (a Claude Design booklet, for instance) shows the page each publish sent; one of several pages is also shown whole, every page at once when the lead says it is done, and laid out as on the claude.ai canvas when you pin it. One that was sent no page (a deck or a document filled with data), or whose page a command wrote, has no preview: the window shows its title and its link.
- **Task list** — if the agent keeps a todo list (TodoWrite, or Claude Code's and Cowork's task tools), a side panel shows it live (☐ pending, ◐ in progress, ☑ done); when the agent updates it, the list itself is shared, large, with a short flash on each task done.
- **Claude Preview** — the preview of a dev server (Claude desktop app) is a browser window too: `localhost:<port>`, its screenshots, the shape of its last resize, and its last console lines under the page.
- **Web search and fetch** — a search is a page of results (titles and sites); a fetched page shows its address, its HTTP status and size, and what the agent read from it.
- **A plan to approve** — the plan is shown as a document while the lead presents it.
- **Your screenshots** — the pictures you paste in your prompt are shared from your own camera for a few seconds.
- **Codex pictures** — the screenshots Codex takes, the images it views and the ones it generates.
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
In a live call, an agent that has been at work for a while thinks to itself in a lighter bubble that is not said out loud: its own reasoning when the session keeps it, otherwise what it is on (the command it waits for, the files it goes between, its to-do item); about one in five is mumbled, low. In a live call, when the lead starts on its tools without a word after your order, it says what it is starting with ("Got it. Let me look at server.js."). Sub-agents answer when they get an order ("Running the tests, as usual.", "Grepping like there's no tomorrow."), say goodbye when they leave, and now and then have a little thought; a failing tool call makes the tile shake; confetti when the lead finishes a long job. Whoever receives a report sometimes says thanks ("Got it, thanks."), and an agent that has been thinking for a long time says so ("Hmm, let me think."). When the call has been silent for a while, someone fills the gap the way people do in video calls ("Can you hear me?", "You guys still here?", "Can everyone see my screen?"): after 45 seconds in a live call, about 10 seconds in a replay, at most three times per silence and further and further apart. It is all local (no API), absent from the transcript, and can be turned off in ⚙ → All settings → Little lines & animations.

Sub-agents also talk to each other, from what really happened: a new agent asks a question and the lead answers, a report gets a reaction that fits (all good, errors along the way, it took long) and sometimes a word from a third agent, an agent that fails three times in a row gets a “you okay?”, and every few minutes the lead calls a quick round. ⚙ → All settings → **Chatter between agents**: Quiet (only the real exchanges) / Normal (default) / Lively. When the lead finishes, it reads the part of its last message that the live reading had cut short, so you know what was done.

## Glance without the panel (VS Code)
The status bar shows live counts for your workspace (needs you, working, your turn) and turns red when a session waits for your answer (a question or a permission is open); hover for the sessions (one stopped by Claude's usage limit says “⏳ usage limit · resets 7:20pm”, one that is logged out “⚠ logged out”), click to open the call on the most urgent one (`agentStandup.statusBar`). When nothing is at work or waiting for you and every session whose turn it is was stopped that way, the bar itself says so instead of “your turn” (⏳ usage limit · resets 7:20pm, logged out).

## Context gauge, highlights, loop watch
The header shows how full the lead's context is (`ctx 62%`, orange then red, with a warning before auto-compaction); tiles and list rows show it from 50%. In Replay, the **Highlights** bar jumps to the first error, the longest wait, compactions and possible loops. A 🔁 badge marks an agent repeating the exact same call or failing repeatedly. The context window (200k or 1M) is inferred, because transcripts do not state it.

## Works with your tools
| Where | How |
|---|---|
| **VS Code** | Install **Agent Standup** from the Extensions view (Marketplace). |
| **Cursor, Windsurf, VSCodium…** | Search **Agent Standup** in the Extensions panel of your editor: the same extension is on [Open VSX](https://open-vsx.org/extension/DoubleGeste/agent-standup). If the search finds nothing, download `agent-standup-<version>.vsix` from the [latest release](https://github.com/Atoll92/agent-standup/releases/latest) and use *Extensions → … → Install from VSIX*. |
| **Any terminal, no editor** | `npx @double_geste/agent-standup@latest --open` (Node 18+; the package is on [npm](https://www.npmjs.com/package/@double_geste/agent-standup)). Without the npm registry: `npx https://github.com/Atoll92/agent-standup/releases/latest/download/agent-standup-cli.tgz --open`. |
| **A small desktop app (macOS 13 or later)** | Download `Agent-Standup-<version>-mac-apple-silicon.zip` (or `-mac-intel.zip`) from the release, unzip, move *Agent Standup* to Applications. The app is **not signed with an Apple developer ID**, so the first time: open it, close the warning, then *System Settings → Privacy & Security → Open Anyway* (on macOS 14 and earlier: right-click the app → *Open* → *Open*). Or run `xattr -dr com.apple.quarantine "/Applications/Agent Standup.app"`. It has a window and an indicator in the menu bar, and notifies you when a session is waiting for your answer, with what it asks. Windows and Linux builds (`-windows-x64.zip`, `-linux-x64.zip`) are on the same release page but **experimental and not tested by hand**. |
| **Claude Code status line** | `npm i -g @double_geste/agent-standup`, then in `~/.claude/settings.json`: `{ "statusLine": { "type": "command", "command": "agent-standup statusline" } }` → shows `✋1 ⚙2` under your prompt. |
| **tmux** *(not tested here)* | `set -g status-right '#(agent-standup status --here)'` |
| **Neovim** *(not tested here)* | call `vim.fn.system('agent-standup status --here')` from a timer and show the result in your statusline plugin; `agent-standup status --json` gives machine-readable output: each session's state and, when they apply, since when it waits (`since`), how long it worked before (`ran`), and whether its turn ended on the usage limit (`limit`, with when it resets) or because it is logged out (`auth`); add `--titles` for each session's title, what it asks (`ask`, and `about`: what a waiting command is for) and why it stopped (`gave`: an error, or the agent saying it could not do it). |
| **JetBrains IDEs** *(not native yet)* | *Settings → Tools → External Tools → +*: program `npx`, arguments `-y @double_geste/agent-standup@latest --open`, working directory `$ProjectFileDir$`. |

Codex and Mistral Vibe sessions are read as well (see [Codex sessions too](#codex-sessions-too) and [Mistral Vibe sessions too](#mistral-vibe-sessions-too)), and so are the Cowork sessions of the Claude desktop app (see [Cowork sessions too](#cowork-sessions-too)). Other agent tools (Gemini CLI, OpenCode…) are researched in [ROADMAP.md](ROADMAP.md): their log formats are mostly undocumented, so no adapter is shipped for them yet.

## Languages
Pick one in ⚙ → Language: **English, Français, 繁體中文, 简体中文, Español, Deutsch, Dansk, Português (Brasil), 日本語, 한국어**. The interface (menus, chips, tooltips, recap) is translated; VS Code's command titles, setting descriptions and status bar follow VS Code's own display language. English and French are written by hand; the other languages are **AI-drafted and not yet reviewed by native speakers**, so corrections are very welcome: each language is one small JSON file (`public/locales/<code>.json`), see [public/locales/README.md](public/locales/README.md) to fix or add one (`npm run i18n` checks the files). The [website](https://agent-standup.com) and the landing page exist in the same ten languages, with the same caveat; their files are in `website/locales/` and `landing/locales/`. The words the agents say stay in the language of your session, unless the call is held in French, Spanish or Brazilian Portuguese (see [Translation](#translation-french-spanish-brazilian-portuguese)); the little banter lines exist in these three languages and in English, the demo in English and French.

## Your own characters
**Your lead’s name.** In ⚙ → All settings → Characters, **Lead agent name** is the default for every project. **Name for this project** overrides it for the project of the current live call or replay; clear it to use the default again (Margot if both fields are empty). The project folder is shown below the field. Sessions in the same folder share the name, including Claude Code, Codex and Mistral Vibe sessions. The editor’s `agentStandup.leadName` setting still wins over both fields. Forks follow the chosen name. Reset to defaults clears the global name and the current project’s override, leaving other projects’ names alone.

**Your own agent names.** A sub-agent you defined yourself (`.claude/agents/code-reviewer.md`) or named when it was launched keeps that name on its tile, in the transcript and in the voices: "Code Reviewer" rather than a first name drawn from the list. Two of the same type become "Code Reviewer" and "Code Reviewer 2". The agent types Claude Code ships (general-purpose, Explore, Plan…) still get a first name. ⚙ → All settings → **Keep my agents’ own names** turns it off.

A cat pack ships with the app: ⚙ → Characters → **Cat pack** (11 cats by a contributor) puts them on the call at once, and **Drawn characters** goes back to the default. **My folder** uses your own images below (picked by itself the first time if your folder already has images).

Replace the drawn characters with your own pixel art. Drop PNG (or GIF, WebP, JPEG) files, 300 KB at most each, into `~/.agent-standup/characters` (⚙ → Characters shows the folder, and in VS Code *Open folder* opens it; the `agentStandup.charactersPath` setting changes it):
- `lead.png` (or `claude.png`) is the lead, `you.png` is you, any other image becomes a sub-agent (one per agent: two sub-agents only share an image once every image is taken);
- `name-talk.png` next to `name.png` is an optional open-mouth frame that shows while the character speaks;
- optional layers, as in the Halloween pack: `name-bg.png` (its room), `name-head.png` (a head that nods while it speaks; `name-talk.png` is then the head with its mouth open), `name-hands.png` (hands that type), `name-desk.png` / `name-desk-dark.png` (a laptop it pulls out now and then), `name+hat-1.png`, `name+glasses-1.png`… (extras it may wear, one of each kind or none);
- 32×32 or 64×64 px, transparent background, facing front, feet at the bottom looks best. Pixel art keeps its hard pixels and large pictures are drawn smooth, on top of the usual scene and desk, and every status, hand and badge still works.
Your characters sit at the desk without the laptop (it would cover the bottom of the sprite); ⚙ → All settings → **Laptop in front of your own characters** puts a darker one back while they work. Press **Reload** in ⚙ → Characters to see changes. Three example images to start from are in [examples/characters](examples/characters) (in the repository, not shipped with the app), and the cat pack is in [examples/cats](examples/cats).

## Agents list
On wide windows (900 px+), a fixed list sits left of the call: every agent with its role and one status line, **most urgent first** (needs you, stalled, working, waiting, done) and the lead pinned on top. It stays readable with dozens of agents, which a grid of tiles does not. Click a name to put that agent in the spotlight (kept for 25 s even when someone else speaks), double-click for details. Each line carries what the agent has used so far (⚡). An agent whose tile has left the stage keeps its line at the bottom, under “done”, with its count: click it for its details. Toggle it in ⚙ → All settings → Agents list (left). A status that does not fit takes two lines, and the whole text is in the tooltip.

**Focus layout.** ⚙ → All settings → **Focus layout** turns the characters into small cameras, with no big spotlight tile, and gives their room to the shared screen: the terminal, the page or the picture an agent works on. Off by default.

## All your sessions (Sessions view)
The **Sessions** tab lists every session active in the last 12 hours, across all projects, in sections by state, what waits for you first: needs you, your turn, working, waiting on sub-agents, and idle, folded into one line until you open it (a card also says how many sub-agents are active). When sessions of two tools or more are listed, buttons at the top show one tool only (Claude Code, Codex, Mistral Vibe, Cowork). A session that waits for you says for how long, apart from how long it worked before (“worked 25 min · waiting on you for 12 min”), and one at work how long it has been at it. It refreshes every few seconds and reads only the end of each transcript, so thirty parallel sessions stay cheap. Click a card to follow that session in the call.

- **The question on the card.** A session that stopped on a question shows the question itself, so you can tell what it wants without opening it. One that waits for your go-ahead on a command shows the command and what it is for.
- **Claude Code open, but saving no history.** When Claude Code is open but saves no history because `CLAUDE_CODE_SKIP_PROMPT_HISTORY` is set, the Sessions view and the empty call say so, with the folder it runs in and what to do. It is the only such case the app can see; for the others, see [Troubleshooting](#troubleshooting).
- **Done.** ✓ on a card whose turn is over, or that is idle, puts it away in a **Done** section at the bottom, closed until you open it. It comes back by itself when the session moves again; ↩ brings it back at once. Its tab leaves the row of tabs of the call too, unless the call is in that session. This is kept in a small file beside your settings, so every window agrees within a few seconds. The indicators (menu bar, status bar) still count the session.
- **Its pull request.** When Claude Code noted a pull request for a session, the card has a **PR #n** button that opens it on GitHub. Only pull requests on github.com are offered.

**Several sessions at once.** When a second session is active, a row of tabs appears under the header of the live call: it names the session the call is in and the others, each with its state. With a single session there is no row. The call is in the session you last touched: start a session or type in one, and the call goes there. The end of the row says why the call is in that session (where you last typed, where the work is, you went there, pinned by you…). Click a tab to pin the call there (📌): it stays while you go through the Claude Code tabs of your editor and while you type in it, until you ask something in another session, which takes the call there, or until you click that tab again. What the agents write does not move the call, so two sessions at work do not pull it back and forth. One case moves it without you: when the session you last typed in has finished and been quiet for a minute and a half while another one is still at work, the call goes to that one (a session you went to by a click is not left that way). When another session stops for you (a question, an edit that waits for your go-ahead, or its turn is over), a visitor leans in at the edge of the call, says which one, and takes you there on a click (⚙ → All settings → Display to turn it off). In VS Code the call also goes to the Claude Code tab you switch to, so a conversation and its call can sit side by side; a tab is matched by its title, so a conversation that has no title yet, the sidebar chat and a terminal do not move the call. Switching tab counts as going there by hand: the call stays with that conversation until you type somewhere else.

**What needs you, in one line.** In the live call, when another session waits for you, a red line under the header says which, what it asks and for how long, in the Call, Tree and Sessions views alike; “+2” counts the others (an agent of the call’s own session says it on the status line). Only a question or a permission menu that is really open counts, as Claude Code or Mistral Vibe reports it (in Cowork and Claude Code before 2.1.269, which do not report it, a question or a plan open in the transcript). **Click it to answer:** the call goes to that session, and the session opens where you can answer it: its Claude Code tab, in the VS Code, Cursor or Windsurf window that runs it (from the extension, the browser or the desktop app alike), or, on macOS, Terminal, iTerm2 or the Claude app it runs in, brought to the front (with several windows of an editor that does not have the Agent Standup extension, that editor comes to the front and you pick the tab). **G** goes there without opening it, one after the other. So does a click on the status line, the visitor, the question card or a notification.

**Files made for you.** When a turn ends, the files the session created for you show in one line under the call: those the lead names, else the documents (a report, a picture, a spreadsheet), not every source file it wrote. A document made by a command (an export, a report written by a script) shows too when the lead names it. Click one to see it in its folder; nothing is read and nothing is run. The whole list is behind “+N” (⚙ → All settings → Display to turn the line off).

## At a glance
Every tile carries one status: **working** (with what it is doing), **waiting on another agent** (who), **needs you** (a permission or a question is open in the session, as Claude Code reports it; with a question mark, **needs you?**, when it is a guess: a file edit or write pending for 15 s+ in a session whose status Claude Code does not write; a guess stays on the tile, with no red line, sound or notification), with how long it has waited and, in the header, the question or the command it waits on, **stalled** (waiting on an agent that has been silent for 2 min+), or **done**. A summary sits in the header, and the browser tab's title and icon count every session that needs you, not only the one in the call. A session whose turn ended on Claude's usage limit shows **⏳ usage limit · resets 7:20pm** (the time Claude Code gave), and one that is logged out shows **⚠ logged out: run /login**, instead of **gave up?**, on the board and in the call. `agent-standup status` says the same, and the VS Code status bar says it in its tooltip. Recent Claude Code notes in `~/.claude/sessions` when a menu waits for your answer (a permission, a question), and the app reads it: a Bash command waiting for your go-ahead shows “needs you” as soon as the menu opens, with the command (`Bash(npm run build)`), where the transcript alone makes it look like a command that runs. With ⚙ → All settings → **A card with what the session asks you** on (it is off by default), while such a menu is open in the session the call follows, the lead shows what it is, word for word, in a card beside the call until you answer it in Claude Code: each question with its number, its short label and “pick one” or “one or more”, each option on its own row with what it means under it, the command and what it is for, the file, or the plan to approve (a question Claude Code has not written down yet shows as "a menu is open" until it is). Where Claude Code does not note it, the signal is a heuristic: commands are not flagged because they can legitimately run for minutes (they get a ⏳ badge after 1 min instead), and edits that stay pending for 15 s+ are rare on real sessions, so it is mostly right.

## Voices
With the real voices, each line is read with a voice of its own language (English, French, Spanish or Portuguese), whatever language the interface is in. A line in a language the model does not speak (German, Danish, Japanese, Korean, Chinese) is read by a system voice of that language when your computer has one.

Two choices in ⚙ → Voice style (default: **Natural voices**):
- **Animal Crossing** — every agent "talks" in gibberish, one blip per letter, with a sentence melody (up for questions, down for statements) and a register of its own.
- **Natural voices** — [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), a small open speech model that runs on your machine. The real words, and the default: click Install in ⚙ (about 750 MB, one folder in your user cache, installed with npm; the model is fetched on first use, and one download covers every language). Until it is ready the agents babble, Animal Crossing style, and a line at the bottom of the call offers the install in one click (close it and it does not come back). It speaks English, French, Spanish and Brazilian Portuguese with eight voices each. The model has few voices outside English (one French, three Spanish, three Portuguese): the lead takes one as it is, and the other characters get one of them mixed with their English voice, so each agent sounds like itself in every language. These three languages need a phonemizer the install adds ([eSpeak NG](https://github.com/espeak-ng/espeak-ng), 18 MB, GPL-3.0, fetched by npm like the rest and not shipped with the app); if you installed the voices before 1.32.0, ⚙ → Voice style offers to add them when the interface is in one of these languages, and until then their lines are read by your system voices.

**Our tip:** install the natural voices once you are set up. The agents then sound like real people, which is the nicest way to follow a call.

Up to 1.31.0 there were five styles, and the natural voices were called *Very natural voices*. The *Cartoon voices* (your system voices with an effect, the default then), the plain system voices and *Simlish* are gone. If you had Simlish you are now on Animal Crossing; if you had the cartoon or the plain system voices you are on the natural voices, which babble until they are installed.

**Voice volume.** ⚙ → Sound: a slider under **Agent voices** sets how loud the agents speak, apart from the music and the ambience.

Long lines are subtitled one sentence at a time, in step with the voice.

## Handy extras
- **Copy as Markdown** in the recap: a ready-to-paste standup report (who did what, files, tokens, final report of each agent).
- **Notify me when agents finish** (⚙ → All settings): a soft chime, the tab title and, in VS Code, a notification once the team has worked for a while and gone quiet.
- **Search** the transcript, **ambience volume**, and a compact layout when the panel is narrow (side bar): under 480 px wide (when the agents list is not shown), one row per agent instead of tiles. In replay, speed presets (1×, 2×, 4×, 8×) and each session remembers where you stopped.

## Install
Four ways in — pick one (details in [Works with your tools](#works-with-your-tools)): the **VS Code extension** (below), the **`agent-standup` command** (`npx @double_geste/agent-standup@latest --open`), the **desktop app** (macOS, from the release page), or the **[Claude Code plugin](#claude-code-plugin)**. Cursor, Windsurf and VSCodium get the same extension from Open VSX: search **Agent Standup** in their Extensions panel.

### VS Code

### Option 0 — from the Marketplace (easiest)
In VS Code: Extensions view → search **Agent Standup** → Install. Or: https://marketplace.visualstudio.com/items?itemName=DoubleGeste.agent-standup

Then click the Agent Standup icon in the Activity Bar (or run **Agent Standup: Open live call**): the call starts by itself.

### Option A — from a GitHub Release
1. Open the repository's **Releases** page and download `agent-standup-<version>.vsix` (don't send it by email: Gmail and others block `.vsix` files).
2. In VS Code: Extensions view → `…` menu (top right) → **Install from VSIX…** → pick the file.
   Or from a terminal: `code --install-extension agent-standup-<version>.vsix` (macOS: run *Shell Command: Install 'code' command in PATH* first if `code` isn't found).
3. **Developer: Reload Window**, then click the Agent Standup icon in the Activity Bar (or run **Agent Standup: Open live call**): the call starts by itself.

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
After cloning the repository (Option B): `node server.js` and open http://localhost:4747 (see *Standalone* below). Without cloning: `npx @double_geste/agent-standup@latest --open`.

Browsers allow sound only after a click: the call plays from the start, silent, and your first click or key in it (or **🔊 Turn on sound** at the top) turns the sound on.

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
| `agentStandup.notifyNeedsYou` | `true` | A notification when a session of this workspace starts to wait for you, with its name and what it asks, and **Go to session** / **Open call**; once per wait, with no reminder. Not while the call is in view, nor while you are on that session's Claude Code tab; with several windows on one folder, one of them tells it |
| `agentStandup.shareUsage` | `false` | Opt-in, anonymous: one empty request a day (when the editor starts) and at most one a week (when you open the call) to 1-pixel files on GitHub, to count how many people use it. Asked once, the first time you open the call; ignored when VS Code telemetry is off |
| `agentStandup.charactersPath` | _(empty)_ | Folder with your own character images (default `~/.agent-standup/characters`) |
| `agentStandup.leadName` | _(empty)_ | Name of the lead agent in the call, 24 characters at most; its forks are named after it (Name 2, Name 3…). Empty uses the name chosen in ⚙ → All settings, or Margot |
| `agentStandup.codex` | `true` | Also show Codex sessions (read from `~/.codex/sessions`, or `$CODEX_HOME`). Turn off to show Claude Code sessions only |
| `agentStandup.vibe` | `true` | Also show Mistral Vibe sessions (read from `~/.vibe/logs/session`, or `$VIBE_HOME`). Turn off to leave them out |
| `agentStandup.claudePath` | _(auto)_ | Full path to the Claude Code executable if it isn't found automatically (needed only for translation) |
| `agentStandup.autoOpen` | `false` | Open the call when VS Code starts |
| `agentStandup.onlyThisWorkspace` | `true` | Follow only sessions started in the open folder (falls back to the newest session if there is none) |

## Controls

| | |
|---|---|
| **Call · Tree · Sessions** (Appel · Arbre · Sessions in French) | tiles, hierarchy, or one card per recent session |
| **⏸ / ▶** (Space) | pause / resume |
| **☰** | transcript |
| **🔊 / 🔇** (M) | mute everything |
| **⚙** | language · voices · characters · **Live / Replay / Demo** (and project / session picker) · tools: recap, export video, clip to share (25 s), hide code & file names in videos, report a problem · **All settings**: ambience, **office music (station + volume)**, notifications, agents list, reactions bar, little lines & animations, chatter, remove finished agents |
| **T** · **R** · **L** | tree/call · recap · transcript |
| Esc | close recap / menu |

In Replay and in the demo, a slider and a speed control appear at the bottom, and clicking a transcript line jumps there.

## Office music

Turn on **Office music** in ⚙ → All settings and pick a station (FIP, Groove, Jazz, Electro, Reggae, Rock, Nouveautés, Pop) and a volume. The stream is played live from Radio France's public Icecast servers directly in the page; it starts with your first click in the call (browsers require one). When any agent speaks, the music drops to ~15 % within a fraction of a second and returns slowly after the last line. Muting (🔊 / M) stops the stream. Music is for your ears only: it is **never included in video exports**. Stations are for personal listening; nothing is stored or redistributed.

## One window talks at a time

If several Agent Standup windows are open on the same machine (sidebar, editor panel, browser tab), only the last one where you turned the sound on (a first click, Play or 🔊) plays sound; the others stay silent and show 🔈 (click it to take the sound back). This avoids hearing the same call twice, possibly in two languages. A window that stops answering releases the sound after a few seconds.

## System voices (per OS)

The system voices are only a fallback for the natural voices: for a line in a language the model does not speak, and for a line it could not make. They are generated on your machine:

| OS | Engine | Notes |
|---|---|---|
| macOS | `say` | For nicer voices: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices → download a *Premium* / *Enhanced* voice |
| Windows | installed system voices (SAPI, via PowerShell) | Settings → Time & language → Speech (or Language) → add the language |
| Linux | `espeak-ng` | Must be installed |

If no voice of that language is available the line goes to an English voice.

## Translation (French, Spanish, Brazilian Portuguese)

Agent messages are in the language of the session. With French selected, each line is translated as it arrives using your local `claude` CLI (`claude -p`, Haiku) through two warm background workers: about 3–4 s per line once warm (the very first line takes ~10 s), then spoken. If a translation is not ready in time (7 s live), that line is read in the original language. The menu shows a hint if translation or the French voice is unavailable.

Spanish and Brazilian Portuguese work the same way: with one of them as the interface language, the call is held in it. The first time, a line at the bottom of the call says that it is translated with your Claude Code, with **Turn off** next to it, because translating sends the lines to Anthropic through your Claude Code login and counts on your plan. The switch stays in ⚙ → Language (**Call in this language**). Off, the call is the session as it is; a session that is already in Spanish or Portuguese is read by voices of that language either way.

Optional speed-up: set `ANTHROPIC_API_KEY` in the environment of VS Code / the server and translation calls the Anthropic API directly (~1–2 s).

**Privacy & security:** everything runs locally. The server listens on `127.0.0.1` only and rejects requests that do not come from `localhost` (other websites and DNS-rebinding attempts get a 403), so no web page can read your sessions. Translation and jokes send the shortened agent lines to Claude through your own Claude Code login (or your API key if you set one). With translation, jokes and music off, which is the default, nothing leaves your machine. (Office music connects your browser to `icecast.radiofrance.fr` while it is on.)

## Standalone (no VS Code)

```bash
node server.js            # http://localhost:4747   (PORT=… to change)
```

- `http://localhost:4747/` → live, newest session
- `http://localhost:4747/?live=0` → replay picker
- `?proj=-Users-me-code-myapp` → the live call follows only that project (the name of its folder in Claude Code's projects folder)

Requires Node 18+.

## How it works

Claude Code writes every session to `~/.claude/projects/<project>/<session>.jsonl`, and each sub-agent to `<session>/subagents/agent-*.jsonl` (with a `.meta.json` linking it to the tool call that created it). Agent Standup merges these into one timeline: orders (the prompt a lead sends to a sub-agent), spoken text, tool calls (with their inputs), the **results** of those calls (matched by tool-call id, with real durations) and final reports. Each file is parsed once and then only the new lines are read, so even a very large session refreshes in a few milliseconds; responses are compressed. The page asks the server every 0.4 s (every 2.5 s when the call is hidden and nobody hears it) and plays new events.

The website at agent-standup.com counts its visits, and the clicks on its buttons, with Vercel Web Analytics, the counter of its host: no cookie, nothing loaded from another service, and no count for a browser that sends Do Not Track. The earlier landing page on GitHub Pages counts visits anonymously (a 1-pixel file hosted on GitHub per channel: no cookies, no third-party tracker) and asks GitHub which release is the latest. The app sends nothing by default. Every form of it can count usage if you say yes (the VS Code extension through `agentStandup.shareUsage`; the desktop app, the command line and the Claude Code plugin through a question asked once), and the last three can also tell you when a new version is out, if you say yes (see below). Details in the [privacy policy](PRIVACY.md).

## Troubleshooting

- **Nothing happens / "Waiting for a session"** — start Claude Code in the open folder; with `onlyThisWorkspace` the call follows that folder.
- **Claude Code is open but saves no history** — Agent Standup reads the session files Claude Code writes, and Claude Code writes none when `CLAUDE_CODE_SKIP_PROMPT_HISTORY` is set (it then says “Transcript saving is off”). The Sessions view and the empty call say so, with its folder: remove the variable from your shell profile, then start Claude Code again. The app tells this from the status Claude Code keeps for each open session in `~/.claude/sessions`; nothing is sent.
- **Claude Code started from inside another Claude Code session does not show at all** — for example in a terminal or an editor that a Claude Code command opened. It says “Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker” and writes neither a session file nor the status the app reads, so there is no notice either. Start it from a new terminal.
- **Claude Code with another `CLAUDE_CONFIG_DIR` does not show at all** — its sessions and its status go to that folder, which the app does not read, so there is no notice either. Give the app the same one: export it in your shell profile and restart the editor, or pass `--config DIR` to the `agent-standup` command.
- **Panel is blank** — use **Open in browser**; if you set a fixed `agentStandup.port` it may be taken (use `0`).
- **Two voices at once (e.g. French and English)** — update to ≥ 1.8.1: only one window plays sound now. A line that could not be translated in time is read by an English voice, not by a French voice reading English.
- **No sound** — click once in the call (or press **🔊 Turn on sound**); check 🔊 isn't muted and *Agent voices* is on in ⚙.
- **French is read in English / hint about translation** — Agent Standup looks for Claude Code in your `PATH`, the usual install folders (Homebrew, npm, nvm, `~/.local/bin`, Windows `%APPDATA%\npm`) and the copy bundled with the official VS Code *Claude Code* extension. If none is found the app quietly stays in English; set `agentStandup.claudePath`, or run `claude` once in a terminal to sign in. If VS Code itself was started from inside a Claude Code session, restart it normally.
- **Characters or backgrounds look empty** — update to ≥ 1.2.1 (fixed a duplicate SVG id bug).
- **Terminal output missing for a command** — the call is still running (spinner), or it is an internal call (sub-agent launch / message); outputs are only recorded once a call finishes.
- **Pill says OFFLINE** — the local server stopped answering: in VS Code the extension starts it again within a few seconds; otherwise restart `node server.js`.
- **Delay behind the real session** — expected ≈ 5–7 s when the call is translated (French, Spanish, Portuguese), ≈ 2 s otherwise; the call skips ahead when it falls too far behind.
- **Something else broke** — ⚙ → **Report a problem** shows what the app logged on your computer and opens a pre-filled issue for you to send.

## Limits

- Tool outputs are trimmed (about 1–2 KB each); the shared screen shows the beginning of long outputs.
- Output only exists once a tool call has finished: a running command shows a spinner and its live timer, not partial output.
- The natural voices need about 750 MB and npm; without them the agents babble.
- Very large sessions (10 MB+ of transcript) take a second or two to load the first time (about 1.9 s for a 12 MB, 168-sub-agent session on a recent Mac); after that updates take milliseconds.
- Video export and the clip record in real time and need a Chromium-based browser/VS Code. MP4 recording was checked in Chrome; it has not been tested inside VS Code's own panel, which may still produce a `.webm`.
- "Hide code & file names in videos" does not mask what the agents say (speech bubbles, subtitles, voices).

## Credits
Several ideas in 1.23 (settings kept in a file, session stickiness, subtitles that follow the voice, Kokoro voices) started in [neondragon's fork](https://github.com/neondragon/agent-standup) of this project. Thank you!  Their code was read and rewritten for this codebase. [rqwj](https://github.com/rqwj) made each sub-agent get its own character image (#1) and [KajetanCiunelis](https://github.com/KajetanCiunelis) drew the cat pack in `examples/cats` and suggested the laptop option (#2). The Traditional Chinese wording was polished with suggestions from a Taiwanese reader on Reddit. [jainefer](https://github.com/jainefer) added the Korean interface (#5). Unofficial: not affiliated with Anthropic, OpenAI or Mistral AI.

## License

MIT

## Support the project / work with me
Agent Standup is free and made by one person. If it made your sessions more fun, you can [buy him a coffee](https://www.buymeacoffee.com/bored_dev_and_his_robots) ☕ — there is also a ☕ line in the ⚙ menu and at the end of each recap. The app asks for something (a star, a coffee, a look at the Halloween pack) at most once a day, and never on the first day you use it.

Agent Standup is free and MIT licensed. I'm also available for work around AI agents and developer tooling: reach me through my GitHub profile, [Atoll92](https://github.com/Atoll92).

## Settings menu and shortcuts
⚙ has sections that fold (and remember it), a search box, and **All settings** for the rest (display, alerts, ambience and music). “Notify me when agents finish” is on by default (change it in ⚙ → All settings → Sound and alerts). The **?** help also explains what each status means.

Press **?** in the app for the full list. Highlights: **Space** pause, **M** mute, **T** tree view, **G** go to what needs you (here or in another session), **J / K** next agent that needs you, **Cmd/Ctrl+K** go to a session, and in replay **← / →** step, **N** next highlight.

## Name and logo
The code is MIT licensed: use it, change it, fork it. The name, the logo and the characters are how people recognise this project, and they are not there to brand something else. [TRADEMARKS.md](TRADEMARKS.md) says what is fine (writing about it, building on it, shipping it unmodified) and what needs asking first (releasing a fork under this name, using the logo or the characters for another product). The artwork and its colours are in [brand/](brand/).

## Security and what it reads
The full [privacy policy](PRIVACY.md) says what is read, what is kept on your computer and what can leave it.

- **It reads local files and sends nothing by default.** Agent Standup reads the output Claude Code writes for a command running in the background (in its temporary folder, while the shared screen shows that command), and the session files Claude Code already writes (`~/.claude/projects`, or `CLAUDE_CONFIG_DIR`; the status it keeps for each open session in `~/.claude/sessions`, and the plan files a session names in `~/.claude/plans`) and the ones Codex, Mistral Vibe and Cowork write (`~/.codex/sessions`, or `CODEX_HOME`; `~/.vibe/logs/session`, or `VIBE_HOME`; the `local-agent-mode-sessions` folder of the Claude desktop app; each can be turned off) and draws them in a page. It never writes to your sessions; a click on a session that needs you opens it in the app it runs in (a local link, or that app brought to the front, found in the list of running programs); it starts Claude Code only for translation and the optional jokes, described below.
- **Local only.** The server listens on `127.0.0.1` (never on the network), refuses requests whose Host or Origin is not local, and refuses cross-site requests on every endpoint that does something (translation, jokes, sound, settings).
- **What calls out:** translation, which is on when the interface is in French, Spanish or Brazilian Portuguese (for the last two it can be switched off), and three things that are optional and off by default: jokes, the FIP radio stream, and the usage counter (only if you say yes: in VS Code, one empty request a day and at most one a week; in the desktop app, the command line and the Claude Code plugin, at most one a week; each to a 1-pixel file on GitHub), and, in those three, the new-version notice (only if you say yes: at most one request a day to the npm registry for the latest version number). Installing the natural voices, buying a character pack and loading an artifact's libraries also reach the network, only when you ask; [PRIVACY.md](PRIVACY.md) lists each one. Translation and jokes go through your own Claude login (the small Haiku model, with all tools disabled); when one of them is on, the lines of a Codex, Mistral Vibe or Cowork session are sent the same way, to Anthropic.
- **No dependencies**: the code is plain Node.js and one HTML file, so there is nothing hidden in `node_modules`. The optional Kokoro voices install a third-party package only when you click Install.
- **Many sessions at once?** The **Sessions** view shows every session across your projects on one board (working, waiting, needs you, done); click one to open its call. **Live** follows one session at a time, the most recent or the project you pick.
- **Found a problem?** ⚙ → **Report a problem** opens the draft of an issue on GitHub, filled with the app's version, your system and the last errors the app wrote to its local log (`errors.log`, beside your settings). You see the text first, and nothing is sent until you send the issue yourself.

## Privacy and usage counting
Agent Standup reads local session files. With the interface in French, Spanish or Brazilian Portuguese it translates the call through your own Claude login (for the last two this can be switched off); in any other language it sends nothing anywhere by default. The other network uses are optional: jokes (your own Claude login, off unless you turn them on), the FIP radio stream (if you turn it on), and the **optional usage counter**: if you set `agentStandup.shareUsage` to `true` (off by default, and ignored when VS Code telemetry is off), the extension makes one empty request a day (when the editor starts) and at most one a week (when you open the call) to 1-pixel files in this repository's releases. There is no identifier and no content; GitHub sees your IP like for any download. The desktop app, the command line and the Claude Code plugin ask once, in the page, and then make at most one such request a week (when you open the call), each to a file of its own; never when the `DO_NOT_TRACK` environment variable is set, and ⚙ › All settings turns it off. They also ask once whether to tell you when a new version is out; with a yes they ask the npm registry for the latest version number at most once a day (nothing about you or your sessions; never with `DO_NOT_TRACK` or `NO_UPDATE_NOTIFIER` set). The usage counter lets the maintainer count active installs and weekly users (`npm run stats`).
