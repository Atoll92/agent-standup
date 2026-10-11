# Changelog

## Unreleased
- Fix: your own sub-agent characters (`~/.agent-standup/characters`) were picked per agent without looking at the others, so two sub-agents often got the same picture while other pictures went unused. A new sub-agent now gets a picture no other agent on the call holds; pictures repeat only once every one is taken. The pick stays stable, so a replay gives each agent the same picture again, and Reload reassigns everyone the same way.

## 1.24.1
- Fix: the settings menu (⚙) was taller than a small window since 1.24.0 and its last entries could not be reached. It now stops at the bottom of the window and scrolls.
- **A little more talk between agents**: whoever receives a report sometimes says thanks ("Got it, thanks.", "Noted. I'll take it from here.", about one report in four), and an agent that has been thinking for a long time says so ("Hmm, let me think.", "Hang on, I want to get this right."): after 20 seconds without a word in a live call, once per silence, and in a replay before a line that really took 40 seconds or more to come, about every other time. Eight variations of each, never the same twice in a row, in English and French. Part of ⚙ → Little lines & animations.

## 1.24.0
- **Video export records an MP4** (H.264 video + AAC audio, 1280×720) when the browser can record it, and falls back to `.webm` as before when it cannot (⚙ → Tools → 🎞 Export video). X, phones and most chat apps refuse `.webm`. Checked in Chrome; not tested inside VS Code's own panel, which may still produce a `.webm` there.
- **Clip to share** (⚙ → Tools → 🎬 Clip to share (25 s)): a short clip of about 25 seconds, saved as `agent-standup-clip.mp4` (`.webm` when the browser cannot record MP4). In the middle of a replay it starts at the current position; otherwise one spoken line before the first error or loop of the session when there is one, and failing that at the moment the lead first hands out work. The line being said when time is up is finished rather than cut, so the length varies by a few seconds. The clip carries the site address (atoll92.github.io/agent-standup) in the top right corner and ends with a short end card (product name, the tagline "Your Claude Code agents as a live team call", the site address). The full export has neither.
- **Hide code & file names in videos** (⚙ → Tools, off by default), for the full export and the clip: commands, their output, file contents, diffs and search results on the shared screen are drawn as grey bars of the same length; file names are removed from the window title and from the activity tags on tiles (the tool's name, e.g. "Bash" or "Read", stays); the session title is replaced by "Agent Standup". What the agents say is not masked: speech bubbles, subtitles and voices are kept as they are, so check the clip before posting if agents quote code or names aloud.
- **Pictures on the shared screen**: when a tool gives an agent a picture (a screenshot, an image file it reads: PNG, JPEG, GIF, WebP), it is shown on the shared screen instead of an empty terminal, stays up for several seconds (8 in a live call) whatever the agent does next. It also appears in the agent's Recent activity and in exported videos, where "Hide code & file names in videos" replaces it with an empty frame. Pictures are served from the session file itself, to this machine only; nothing else on your disk is read. Pictures you paste into your own messages are not shown.
- **Small talk during long silences**: when nobody has said anything for a while, an agent fills the gap with a typical video-call line ("Can you hear me?", "You guys still here?", "Sorry, I was on mute."). Whoever shares their screen says the screen ones ("Can everyone see my screen?"). After 45 seconds in a live call and about 10 seconds in a replay, at most three per silence and further and further apart; nothing is said in a hidden tab or once the session has been untouched for ten minutes. English and French, part of ⚙ → Little lines & animations.
- Fix: in 1.23.1 the "Reactions & jokes" option only prepared its jokes when three agents talked at the same time (a leftover from the removal of meme mode); they are prepared for every line again.

## 1.23.1
- Meme mode removed: it disturbed the layout.
- Natural voices (Kokoro): the default model is now q4 (about 305 MB). The smaller q4f16 returned silence on some lines. A line the model cannot make is now handed to a system voice instead of being dropped; Nicole (Kokoro's whisper voice, hard to hear) is replaced by Sarah. Found by [neondragon](https://github.com/neondragon/agent-standup) in their fork, thank you.

## 1.23.0
Ideas from [neondragon's fork](https://github.com/neondragon/agent-standup), rewritten and merged.
- **Settings are kept in a file** (`~/.config/agent-standup/prefs.json`, or `%APPDATA%` on Windows) shared by every window. Before, each VS Code window and each port started from scratch, because the browser stores settings per port.
- **The call stays with the session you follow** while it is active (90 s), so another session writing elsewhere no longer steals it mid-line. A workspace folder also matches the sessions of its sub-folders.
- **What you typed**: the blocks Claude Code wraps around your message (system reminders, IDE context, command echoes) are no longer shown as if you had said them.
- **Subtitles follow the voice**: a long line is shown one sentence at a time.
- **Very natural voices (Kokoro-82M)**, optional and installed on demand from ⚙ → Sound.
- Traditional Chinese wording polished with a native reader's suggestions. `npm test` runs the new tests.

## 1.22.1
- Security and robustness (found by a pre-release audit): custom-character folders no longer follow symlinks, side-effect endpoints refuse cross-site requests, a request error can no longer crash the server, translation helpers run with no tools, the TTS cache is private to the user, `--port` is validated.
- A lead waiting on a synchronous sub-agent now shows "stalled?" after a long silence; the repeated-command loop badge stays visible; the project picker works when the page was opened with a pinned project.
- Custom characters: stable assignment when you add or remove files, reload refreshes video exports, the mouth alternates in exports, the presenter camera uses the talking frame.

## 1.22.0
- **`agent-standup` command line** (npm package `@double_geste/agent-standup`, also attached to the release as a `.tgz`): `agent-standup --open` starts the local server and opens the call without any editor; `agent-standup status [--here] [--json]` prints what is going on; `agent-standup statusline` is a one-line indicator for the Claude Code status line, tmux and Neovim.
- **Desktop app for macOS** (Apple Silicon and Intel, unsigned): its own window plus a menu bar indicator (`⚙2 ✋1`) and a notification when an agent may need you. Built with Electron from the same server; Windows/Linux builds are set up in CI (experimental).
- **Publishing automation**: `.github/workflows/publish.yml` publishes tagged releases to the VS Code Marketplace, Open VSX (Cursor, Windsurf, VSCodium…) and npm when the corresponding tokens are set; `ci.yml` checks syntax, translations and the CLI package on every push.
- `ROADMAP.md`: what works where, plus research notes on other agent tools and on Rive.

## 1.21.0
- **Languages**: English, Français, 繁體中文, 简体中文, Español, Deutsch, Português (Brasil), 日本語, chosen in ⚙ → Language and remembered. Translations are plain JSON catalogues (`public/locales/`), with fallback to English for anything missing, a checker (`npm run i18n`) and a contributor guide. The VS Code manifest (command titles, setting descriptions) and the status bar texts are localised with VS Code's own `package.nls` / `l10n` mechanism. Non-English and non-French catalogues are AI drafts awaiting native review.
- **Your own characters**: drop your pixel art (PNG/GIF/WebP) in `~/.agent-standup/characters` — `lead.png`, `you.png`, any other image for the sub-agents, `name-talk.png` for an open-mouth frame — and it replaces the drawn figures, crisp and animated (bob, talking frame), with all states still shown. New command "Open characters folder", setting `agentStandup.charactersPath`, and a starter pack in `examples/characters`.

## 1.20.3
- Fix: the raised-hand animation of an agent that may need you shared its name with the talking arm animation, so one overrode the other; each now has its own.

## 1.20.2
- Fix: in Live, the lead's orders to sub-agents and the sub-agents' answers were often not heard. A burst of orders set off a catch-up mode that skipped voices and sped everything up. Now every line is read: when many are waiting each one is shortened to its first sentence (the bubble still shows the full text), only a backlog of more than a dozen lines is skipped, and in Live the voices speak one at a time instead of over each other.

## 1.20.1
Fixes from a second review pass by sub-agents:
- Loop watch: a batch of failing calls now counts once (it used to count each call), so four failures in a row means four failed steps.
- A pinned session that no longer exists no longer keeps the view silently pinned; the status bar refreshes the moment VS Code regains focus; a disposed panel is recreated instead of throwing.
- README: `statusBar` setting listed, duplicate sections merged, and the "zero token cost" claim now says it holds unless French translation or jokes are turned on.

## 1.20.0
Three features and a round of polish (chosen from a research pass by sub-agents; each approved before building):
- **VS Code status bar**: live counts for your workspace — "⚠ 1 needs you", "⟳ 3 working", "✓ your turn" — red when an agent may be waiting for you, with the sessions listed on hover. A click opens the call on the most urgent session (new setting `agentStandup.statusBar`, on by default). It reads the session files directly, so it works even before the panel is opened.
- **Context gauge**: "ctx 62%" in the header for the lead and on each tile and list row from 50%, orange at 70%, red at 88%, plus one warning before auto-compaction and a toast when the conversation is compacted. The window (200k or 1M) is inferred from observed sizes since transcripts do not state it; hover shows tokens used / window.
- **Highlights and loop watch**: in Replay, one-click jumps to the first error, the longest agent wait (waits for you and gaps over an hour are ignored), compactions, and a possible loop. A 🔁 badge appears on an agent that repeats the exact same call 3 times or fails 4 times in a row (polling and screenshot tools are ignored).
- **Polish** (from a UX best-practices review): higher contrast for dim text and tile labels, bigger status chips, done tiles no longer fade their text, calmer idle cards, a coloured dot on the tab icon when something needs you, a friendly "standing by" instead of a lone dot, smoother hover and press feedback.

## 1.19.3
Found by eight read-only sub-agents testing the app (each finding checked before applying):
- API: an unknown session now answers 404 (was 500), over-long ids answer 400; `/api/sessions` is ~10x faster cold (titles from a cached tail read instead of reading whole files) and cached for 2 s. A title you typed (custom title) now wins over the generated one.
- Tool calls shown properly instead of raw JSON: questions to the user (with the options), skills, tool search, notebook edits and MCP tools ("server · tool").
- Accessibility: tiles and agent-list rows are reachable and openable from the keyboard (Tab, Enter/Space), visible focus ring, "reduce motion" now stops every animation including confetti, toasts are announced politely, and a few labels that were English-only are translated.
- README: Sessions tab, `shareUsage` setting, exact menu labels, and the second "Voices" section renamed "Voice engines (per OS)".
- The call timer rests while the tab is hidden.

## 1.19.2
- Fix: the header could overflow the window when several status pills were shown. The pills now collapse to icon + number on windows narrower than 1180 px (full label on hover), and the call timer hides there.

## 1.19.1
Fixes from a code review (two read-only sub-agents, each finding checked before applying):
- Live: "needs you?" and the slow badge only trust wall-clock ages when playback has caught up with the live end (no false alerts while voices are queued).
- Switching sessions resets all per-session state (no stale 🎉/confetti/waiting states); past errors no longer replay as 😬 shakes when skipping ahead; a goodbye bubble can no longer stay stuck on a tile; the catch-up mode flags reset on pause.
- Server: one malformed transcript record no longer breaks the whole timeline; huge transcripts are read in 16 MB chunks; the Sessions board memoises its scan and caches untitled sessions; the 4-minute "silent sub-agent is finished" fallback (old transcripts only) now refreshes the cache when it kicks in; `..` is rejected for the pinned session.
- Known limitation, not changed: in Live, tool calls issued in parallel can be merged into a beat that was already delivered, so the tile may show them one update late.

## 1.19.0
- **Little lines and animations** (on by default, ⚙ → Little lines & animations; local, no API, never in the transcript): a sub-agent answers briefly when it receives an order, with variants by what it was asked (tests, review, exploring, bug fixing, docs, UI, cleanup, performance) and a generic pool, in English and French; it says goodbye before leaving the call; other agents sometimes comment when one reports back.
- Small touches: a thought emoji now and then above a busy agent (⌨️ for commands, 🔍 for reads), a little shake and 😬 when a tool call fails (also a quick cue for errors), and confetti when the lead hands the turn back after a long job.

## 1.18.1
- Fix: sub-agents looked finished the moment they were launched (since 1.17.3). Recent Claude Code answers an Agent/Task call with "Async agent launched" immediately, which is not a completion. Completion now comes from Claude Code's task-notification record (background agents) or from a real synchronous answer; a sub-agent's last sentence is only treated as its final report once it is finished (or silent for 90 s).
- Measured on real sessions: the average number of agents shown as working went from 0.0 back to 0.8 / 2.3 on two multi-agent sessions.

## 1.18.0
- **Optional usage counter** (`agentStandup.shareUsage`, off by default, ignored when VS Code telemetry is off): at most one empty request per day to a 1-pixel file on GitHub, so active installs can be counted without any server or identifier. Documented in the README.
- `npm run stats` (maintainers): landing visits per source, release downloads, opt-in active installs, with the change since the last run.

## 1.17.3
- Fix: agents showed "stalled" (and never left the call) after finishing. A sub-agent that ended without a final sentence was never marked done, so the lead kept "waiting" on it. Completion is now taken from the lead getting the sub-agent's answer back; background agents no longer block the lead's status.

## 1.17.2
- Fix: the reactions bar was still visible in 1.17.1 (a leftover CSS rule overrode the hiding); it is now really hidden by default.

## 1.17.1
- The reactions bar is now hidden by default (it took too much room); turn it on in ⚙ → Reactions bar.

## 1.17.0
- **Agents list**: a fixed column left of the call (wide windows) with each agent's role and one status line, urgent first, lead on top. Click = spotlight that agent (25 s), double-click = details. Toggle in ⚙ → Agents list.

## 1.16.0
- **Sessions board** (new tab next to Call / Tree): every session active in the last 12 h, across all projects, with a single state (working · needs you? · waiting on sub-agents · your turn · idle) and active sub-agents. Reads only the tail of each transcript (a few ms for 40 sessions). Click a card to follow that session live.
- **Call feels more like a call**: a raised hand ✋ on tiles that may need you, 😰 on stalled ones, ⌛ while waiting, 🎉 when someone finishes; participants count and a call timer in the header; hover cards with name, state and last command; a reactions bar (👍 👏 ☕ 🔥 🙌) that flies emojis to whoever has the floor and gets a reply.
- Tree view rows use the same one-line status as the tiles.
- Fix (introduced in 1.14.1): a pending file edit/write in Live could break the status update (a missing variable). 
- README and site now open with the positioning: who is waiting on whom, who is blocked, zero token cost.

## 1.15.2
- Fix: in Live, sub-agents were often silent. The "catching up" mode (which mutes voices) was triggered by the number of silent tool calls, and sub-agents produce thousands of them; it now only counts lines that are actually spoken. Skipping ahead also keeps the last 6 spoken lines instead of the last 14 events.

## 1.15.1
- Default voices are back to **Cartoon** (real words, understandable); Animal Crossing and Simlish babble are opt-in in ⚙.

## 1.15.0
- **Animal Crossing and Simlish voices** (opt-in): every agent, lead included, talks in gibberish with a sentence melody and its own register. Works identically on macOS/Windows/Linux and in any language, with no system voice or translation needed. Cartoon (real voice + character) and Natural remain in ⚙.

## 1.14.1
- "Needs you?" no longer fires for Bash commands (11.8% of them legitimately run 25 s+ in real sessions); it now covers file edits/writes pending for 15 s+ and questions/plans waiting.

## 1.14.0
- **One status per tile**: working · waiting on another agent (who) · needs you? · stalled hand-off · done, with a summary in the header and in the tab title. "Needs you?" is a heuristic (a tool that normally needs approval has been pending for 25 s, or a question/plan is waiting); the notification option also fires for it.
- **Cartoon voices** (default): a character per agent (chipmunk, deep, robot, wobbly, radio, monster, squeaky) applied to the system voice. New ⚙ choice: Cartoon / Natural / Babble (syllable babble for sub-agents).

## 1.13.0
- **Copy as Markdown** in the recap: a standup report you can paste in Slack, a PR or a ticket.
- **Notify me when agents finish** (⚙, off by default): chime + tab title + VS Code notification after the team has worked 20 s+ and gone quiet.
- **Search box** above the transcript.
- **Ambience volume** slider (⚙ → Office ambience).
- **Compact layout** for narrow panels such as the VS Code side bar (smaller tiles, banner spotlight).

## 1.12.1
- Office ambience is now off by default (⚙ → Office ambience to turn it on).

## 1.12.0
- **Office ambience** (on by default, ⚙ → Office ambience): keyboards typing while agents work and on every real command, mouse clicks when they read, a coffee machine (grinder, pouring, steam, beep) with a little "Someone is making coffee…" note, a phone buzzing, a chair, a far-away door, paper, a knock on the meeting-room door. All synthesised in the browser, no audio files; it fades down when someone talks.
- In Live, the header shows which project is being followed.

## 1.11.2
- The app now always starts in English (switch to Français in the menu; your choice is remembered).

## 1.11.1
- Live view now honours `CLAUDE_CONFIG_DIR` (and `AGENT_STANDUP_PROJECTS`) and lets you pin the project to follow, instead of always the most recent session anywhere (menu → Source → Live).

## 1.11.0
- **Token usage per agent**: ⚡ counter in the header and on each tile, per-agent breakdown in the detail drawer and the recap (counted once per message, as recorded in the session files).
- **Stuck / quiet / failed**: tiles pulse amber with ⏳ when a command has been running for 1 min+, show 💤 after 3 min of silence, and count failed tool calls (✗). The tab title shows how many agents are working.
- **Much faster server**: each transcript is parsed once and then read incrementally (a live update on a 12 MB, 168-sub-agent session went from ~1.6 s to ~50 ms), responses are cached and gzip-compressed (12 MB → 3.3 MB), and memory for sessions you are no longer viewing is released. Verified identical to the previous output on 9 real sessions.
- Fix: a report from a nested sub-agent now goes to its real parent instead of the lead.
- Smoother UI on very large sessions (repaints of the tree, details and badges are coalesced). Keyboard shortcuts **T** (tree/call), **R** (recap), **L** (transcript).

## 1.10.0
- Built-in demo (⚙ → Source → Demo, or "Watch the demo" when there is no session yet): a fictional team fixes a slow login page, with real-looking commands, outputs, diffs, a task list and a retry-logic sub-agent. Ships its own French.
- Spotlight sizing: the speaker's tile now keeps a 3:2 shape at every window size (it used to get too flat on wide screens).
- The "is sharing their screen" badge moved into the window's title bar.
- README and website: real screenshots, a 1-minute video and a GIF, all produced by `scripts/capture-demo.js` from the demo.

## 1.9.0
- The coffee link is easier to find (still never intrusive): a gold ☕ button in the header, a highlighted line in the ⚙ menu, a link under the Join button, and the end-of-episode recap.
- Landing page / download site (GitHub Pages, source in `docs/`, generated by `npm run landing` from the app's own character art).

## 1.8.1
- Fix: two Agent Standup windows (sidebar + panel + browser) no longer talk at the same time; the last window where you pressed Join/Play/🔊 owns the sound, the others show 🔈.
- Fix: a line that is not translated in time is spoken by an English voice instead of a French voice reading English.

## 1.8.0
- Support: a "buy the dev a coffee" line in the ⚙ menu and at the end of the recap (never during a live call), a Sponsor button on the repository, and a note in the README. Friendlier "port already in use" message for `node server.js`.

## 1.7.1
- Translation: finds Claude Code much more reliably (PATH, Homebrew/npm/nvm/Bun/Volta, Windows `.exe`/`.cmd`, and the binary bundled with the official VS Code Claude Code extension); new `agentStandup.claudePath` setting; precise hints (not found / not signed in / VS Code started from a Claude Code session); stays in English without a warning when French cannot work and was not chosen explicitly.
- The extension now always runs its own server on a free port (`agentStandup.port` = 0) instead of reusing whatever already answers on 4747, which could be a server without the right environment.

## 1.7.0
- Office music: live FIP web radio (8 stations) with a volume control. The music fades down quickly while agents talk and back up slowly afterwards (ducking). Never recorded in video exports.

## 1.6.0
- Final name: **Agent Standup** (extension id `agent-standup`, commands `Agent Standup: …`, settings `agentStandup.*`). Uninstall *Agent Calling* / *Claude Call* first; settings and saved preferences start fresh.

## 1.5.0
- Renamed to **Agent Calling** (extension id `agent-calling`, commands `Agent Calling: …`, settings `agentCalling.*`). Uninstall *Claude Call* first; settings and saved preferences start fresh.

## 1.4.1
- Security: the local server only answers requests addressed to localhost and refuses cross-site / DNS-rebinding requests; session ids are validated.
- Reliability: translation workers are stopped when VS Code closes or after 10 min idle; another window takes over the server if the one serving it closes; an OFFLINE indicator shows when the server is unreachable; cached audio older than a day is purged.
- Performance: very large sessions are re-parsed at most every ~2× their parse time instead of on every poll.
- Polish: bilingual tooltips and aria-labels, keyboard focus outline, bilingual hints.

## 1.4.0
- Real outputs: tool results from the transcripts are matched to their calls. The shared terminal shows each command's actual output (errors in red), search matches, and a spinner with a live counter while a command runs; the editor view shows files that are read with their real content and line numbers; edits keep their diff plus the result line.
- Precise activity tags: tiles show what each agent is doing ("Reading App.jsx", "Running npm test", "Searching “x”"…) and tool calls end with ✓/✗ and their real duration.
- Task list panel next to the shared screen when the agent uses a todo list; agent detail drawer lists recent calls with expandable output; recap counts tool errors.
- The shared screen stays up while a command is running.
- Replay/seek and live-join rebuild the recent screen history so the shared screen is never empty.

## 1.3.0
- Renamed to **Claude Call** (extension id `claude-call`, commands `Claude Call: …`, settings `claudeCall.*`). If you had *Agent Standup* installed, uninstall it; settings and saved preferences start fresh.
- README rewritten to cover every feature, platform voices, translation, privacy and troubleshooting.

## 1.2.1
- Fix: a character's body/background could turn transparent after a screen share (duplicate SVG gradient ids between the tile and the presenter camera). Ids are now unique per instance.
- Live call is much closer to real time: every new line is translated the moment it arrives by warm workers (~4 s instead of 15–20 s), the feed polls every 0.7 s, lines are shorter in live mode, and the call skips ahead when it falls too far behind. With ANTHROPIC_API_KEY set, translation takes ~1–2 s.

## 1.2.0
- Voices on Windows (installed SAPI voices via PowerShell) and Linux (espeak-ng), same pipeline as macOS.

## 1.1.0
- Finished agents leave the call after 2 minutes (playback time) with a dissolve animation, particles and a "left the call" toast; they return if they get a new task. Can be turned off in the menu.
- The speaker always gets the spotlight and keeps it until someone else talks.
- Screen sharing now looks like a real video call: a terminal or editor window (with the actual diff) fills the stage, with a "sharing" badge and the presenter's camera in the corner.

## 1.0.0
- New original look: soft mascots at their desks in front of illustrated rooms; expressions follow what the agent is doing (typing, speaking, done).
- Live call that follows the newest Claude Code session; sidebar view and editor panel in VS Code.
- Reliable voices: generated by the server (macOS `say`) and played through WebAudio, so it sounds the same in a browser and in VS Code. Lip-sync follows the audio.
- Sub-agent tree, shared "screen" of the tool being used, clickable timeline (replay), recap, video export with voices.
- French or English, translated on the fly with your local `claude` CLI.
- Simplified controls: one settings menu, one mute button, one play/pause.
