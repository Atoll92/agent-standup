# Changelog

## 1.42.0
- **Codex sub-agents join their lead's call.** When a Codex session starts sub-agents (and they start their own), each one joins the call of the session that started it, under the name Codex gave it, with its own commands and their output, its tokens and the report it hands back; the lead stays at work while one of them works. A sub-agent is no longer listed as a session of its own, and the short reviews Codex runs before a command stay hidden. Compressed Codex threads work the same way. Contributed by [Harrison O'Connor-Hoover](https://github.com/harrisonoconnorhover) (#13).
- **Give the lead another name than Margot.** ⚙ → All settings → Characters → **Lead agent name**, or in VS Code the setting `agentStandup.leadName`, which gives each workspace its own name and wins over the field. The lead is renamed at once on its tile, in the agents list and in the transcript; its forks follow (“Bob 2”, “Bob 3”…), a sub-agent never keeps the same name, and an empty field brings Margot back. Asked for, and tested on real sessions, by [Saros-12-42](https://github.com/Saros-12-42) (#14).
- **Settings changed in one window stay changed.** Each window now saves only what you changed in it, so a call left open elsewhere (another tab, the desktop app, a second VS Code window) no longer puts its older settings back when it saves. Found by Saros-12-42.
- **⚙ → Source:** the list of projects has a label, “Project to follow”, instead of only a tooltip.
- **Halloween:** on the 30th and 31st of October the drawn characters bring a carved pumpkin to their desk. Click your own tile to see where your vampire costume comes from; the rest of the cast is in the [hand-drawn Halloween pack](https://agent-standup.com/shop/) by Fabien Coupas, from 2 €.
- **agent-standup-band** (the line above the Claude Code prompt): it no longer pushes away what other mods draw there, no longer tells a session about itself after `/clear` or a resume, shows again when a session you hid asks again, and a slow check of the sessions no longer brings back a wait you already answered.

## 1.41.2
- **The VS Code rating request no longer disappears for good.** VS Code tucks a notification into the bell after a few seconds, and if you had not clicked it by then, Agent Standup never asked again. Now it asks again a week later, one last time, unless you chose “Rate it” or “No thanks”. If an earlier version asked you once already, you are asked one more time. Nothing is sent: VS Code keeps the days and the answer for the extension.
- **The one-time coffee tip** comes at the end of a run of three minutes, not only ten, so people whose agents finish quickly see it too.

## 1.41.1
- **More room for the call:** for new users, the list of agents on the left of the call is off by default; ⚙ → Agents list (left) turns it on, and ⚙ → Reset to defaults now turns it off. If you already use Agent Standup, nothing changes.
- **A plan waiting for your approval is on the shared screen again** with Claude Code 2.1.30x, which sends the plan in its file only.
- **The VS Code status bar** no longer mixes up a folder inside your workspace and a folder beside it with a similar name.

## 1.41.0
- **The shared screen shows much more of what the agents do, and live.** When an agent updates its task list (TodoWrite, or the task tools of Claude Code and Cowork), the list itself is shared, large, with a short flash on each task done. A test run shows its passed, failed and skipped counts in large, a green or red bar and the names of the tests that failed (node, vitest, jest, pytest, mocha, go, cargo). An edit shows its diff with real line numbers and context, and so does a Bash command that edited files; `git diff` is in colour. The Claude desktop app's **Claude Preview** is a browser window, with its screenshots, its size and its console. A web search is a page of results, a fetched page shows its address, status and what the agent read. A plan waiting for your approval is shown as a document. The screenshots you paste in a prompt are shared from your own camera, and Codex's screenshots and images are shown at last.
- **The output of a background command, as it is written.** A command an agent runs in the background (or a Monitor) streams its lines on the shared screen with a red ● LIVE until it ends, even after the turn is over. It is read from the file Claude Code writes in its temporary folder, on this computer; nothing is sent.
- **The screen feels alive.** A command is typed and its output scrolls in, in under a second (not while catching up, above 2× or with reduced motion). In a narrow sidebar the window keeps its whole width.
- **The demo** shows the new screens: a plan, a failing then passing test run, diffs, a web search and a page in Claude Preview.
- **Stopped by the usage limit, or logged out.** A session that Claude's usage limit stopped says “⏳ usage limit · resets 7:20pm”, and one that is logged out says “logged out: run /login”, on the board, in the call, in the VS Code status bar and from the command line, instead of “⚠ gave up?”. When several sessions are stopped, one line says so.
- **Claude Code open but writing no history.** With `CLAUDE_CODE_SKIP_PROMPT_HISTORY` set, Claude Code keeps no session file Agent Standup could read: the Sessions view and the empty call now say so and why.
- **A volume for the voices**, under Agent voices in ⚙.
- **The tab title and icon count every session that needs you**, not only the one the call follows; the Sessions card and the red line say what a waiting command is for.
- **Fixes.** Codex threads that Codex compressed (`.jsonl.zst`) are listed again (with Node 22.15 or later). A lead waiting on a workflow it started in the background is no longer “your turn”. The VS Code status bar and notification see the sessions of the workspace's worktrees and sub-folders, and on Windows the drive letter's case no longer hides them. Closing a Claude Code tab no longer makes the call announce that the session has just finished. Scheduled Cowork sessions show their name instead of an id. A Mistral Vibe session waiting on you still needs you as long as the Vibe that has it open runs (for up to four hours), and closing that Vibe no longer knocks with “your turn”. The agent-standup-band plugin no longer reports `claude -p` runs (Agent Standup's own translator among them). Translation with `ANTHROPIC_API_KEY` works with models that think first. The caption of the shared screen is no longer hidden under the presenter's camera. Long waits read in hours. `status --json` gives limit, auth, since and ran, and with `--titles` the question or command; `--config DIR` works.
- **Docs.** The website and landing no longer mention a “Join” button, use `npx …@latest`, and say “waits for your answer”; the privacy policy lists the editor-window notes, the process list read on a click and the background-command output; the README describes agent-standup-band.

## 1.40.0
- **“Needs you” only when a session really asks.** The visitor, the red line, the sound and the notifications (VS Code, the desktop app, the status bars) now come only when Claude Code or Mistral Vibe says a question or a permission menu is open. A call left without its answer (you typed something else, the session was closed mid-call) no longer reads as waiting for you, and a session Claude Code says is at work is believed. A question in a session started with `claude -p` goes to the program that started it, not to you: it never needs you. Where Claude Code does not say (Cowork, Claude Code before 2.1.269), a question or a plan open in the transcript still needs you, and a file edit left pending is only a guess: it stays on the tile as “needs you?”, with no visitor, no red and no notification. VS Code no longer reminds you with “Still waiting”, and an agent of the call’s own session that waits for you is told in one red line instead of two.
- **A click takes you where you can answer.** A click on what needs you (the red line, the status line, the visitor, the question card, the VS Code and desktop notifications) opens that session in Claude Code: its tab, in the VS Code, Cursor or Windsurf window that runs it, whether the call is in the editor, a browser or the desktop app. A session in Terminal, iTerm2 or the Claude app brings that app to the front (macOS). With several windows of an editor that does not have the Agent Standup extension, that editor comes to the front and you pick the tab. The first time, VS Code may ask whether Claude Code can open the link. **G** still only moves from one to the next. The call goes to the session too, as before. Nothing is sent anywhere: a local link is opened, as a click on it would.
- **See the browser an agent drives.** When an agent drives Chrome (Claude in Chrome) or the Claude desktop app’s own browser, the call’s shared screen becomes a browser window: the page’s title and address, its last screenshot, a pointer that glides to each click, what it types, and the agent’s own words for each step.
- **Told when a new version is out, if you want.** The desktop app, the command line and the Claude Code plugin ask once whether to tell you. Off until you say yes; then at most one request a day to the npm registry for the number of the latest version, nothing about you or your sessions, never with `DO_NOT_TRACK` or `NO_UPDATE_NOTIFIER` set. The notice shows how to update that app: download it again, the two plugin commands, or the npx or npm command to copy. The command in the README and on the website is now `npx @double_geste/agent-standup@latest --open`, which always starts the latest version.
- **Claude Code 2.1.300 to 2.1.302.** A lead waiting on sub-agents that run in the background is no longer “your turn”, a fork joins the call as the lead’s twin and its tokens count once, and the recap shows the cost Claude Code counted and each agent’s effort and advisor.
- **A line above the Claude Code prompt when another session needs you.** A second plugin, **agent-standup-band**, shows which other session waits on a question or an approval, and a short toast when one starts waiting or finishes its turn, in the terminal and in the Claude desktop app’s Code tab (Claude Code 2.1.294 or later): `/plugin install agent-standup-band --marketplace Atoll92/agent-standup`.
- **Easier to find in VS Code.** The extension is now listed as “Agent Standup: Claude Code & Codex Agent Monitor”, and the README opens with install buttons for VS Code, Cursor and the macOS app.
- **French:** “vous attend ?” instead of “attend vous ?”.

## 1.39.2
- **Smooth again, and still light.** In 1.39.1 the characters’ small motions moved in visible steps. They are smooth again: one clock moves them all together 25 times a second, instead of the browser redrawing the page 60 times a second, so the call stays light in VS Code.
- **The hourglass no longer makes VS Code flicker.** The turning ⌛ of an agent that waits on others (the lead while its sub-agents work) and the slow drift of the backgrounds were left out of 1.39.1, and kept the page redrawing 60 times a second. They now move with the rest.

## 1.39.1
- **The call no longer makes VS Code flicker.** The characters’ small endless motions (breathing, blinking, typing, the twinkling screens, the coffee steam, the spinner of a running command) now move in small steps instead of redrawing the page 60 times a second; in VS Code every one of those redraws went through the editor’s own window, which could flicker. The call now draws less than half as often, with the same characters. The red “live” dot no longer starts its pulse over every second.
- **The coffee line** now says Agent Standup is free and made by one person.

## 1.39.0
- **“⚠ gave up?” when an agent stops without doing the work.** A session whose agent ends its turn saying it could not do what was asked (“I couldn’t verify…”), or on an error, now reads “⚠ gave up?” in amber with its own first sentence, in the header, its tile, its tab and its card, instead of a plain “your turn”. A check that came out clean (“I couldn’t find any bugs”, “I can’t reproduce it: it already works”) still reads as done. An agent that starts waiting on you takes the spotlight as soon as nobody is talking.
- **The Claude Code plugin opens the call again.** The plugin’s `open` skill passed a flag the version it pins did not know, which stopped it with “Unknown command”.
- **Help count users, if you want to.** The desktop app, the command line and the Claude Code plugin ask once, from the second day you use them, whether to help count how many people use Agent Standup. With a yes, they make at most one empty request a week to a counter of their own: no identifier, nothing about you or your sessions, never with `DO_NOT_TRACK` set. The server reads your answer from the settings file again before it sends anything, and ⚙ → All settings turns it off. The privacy policy and the READMEs say so.
- **Codex models named as OpenAI writes them** next to the token counts (GPT-5.1 Codex Max, GPT-5 mini…), as Claude ones already were.
- **The Halloween pack’s line, fixed and spaced.** It waited behind the offer of the real voices, so many people never saw it. It now goes first on its day, shows the cast and the price, and comes at most twice: once from 19 October (“Halloween is coming…”), once on the 30th or 31st if five days have passed. Never on your first day, never the day another ask was made, never after 31 October.

## 1.38.0
- **The call starts as soon as you open it.** No more “Join” screen: the live call plays at once, silent, and your first click or key in it turns the sound on (browsers allow sound only after one; a **🔊 Turn on sound** chip at the top says so). With no session yet, the page names every tool it reads (Claude Code, Codex, Mistral Vibe, Cowork), and the demo plays by itself.
- **What needs you, in one line.** When an agent of this session or another session waits for you, a red line under the header says who, what it asks and for how long, in the Call, Tree and Sessions views alike (“✋ “Fix the slow login” needs you · Bash(npm run build) · 4 min”). Click it, or press **G**, to go there; again for the next one. It says “needs you” when Claude Code reports a menu open in the session, and keeps the question mark (“may need you”, “needs you?”) only when it is a guess from how long a call has waited. The header chip for agents waiting on others now reads “on sub-agents”.
- **VS Code tells you when a session waits for you.** A notification names the session and what it asks (its question, the command waiting for your go-ahead, a plan to approve), with **Go to session** and **Open call**; once more, “Still waiting”, if nobody answered 5 minutes later. Not while the call is in view, nor while you are on that session's Claude Code tab, and with several windows on one folder only one of them tells it. Off with `agentStandup.notifyNeedsYou`. The desktop app's notification names the session too.
- **Why the call is in this session.** With several sessions at once, the end of the row of tabs says why the call is where it is: where you last typed, where the work is, you went there, pinned by you.
- **Sessions: idle folded, one tool at a time.** Idle sessions fold into one line you open on demand, and when sessions of two tools or more are listed, buttons at the top show one tool only.
- **Longer statuses, and a Focus layout.** What an agent is doing takes two lines before it is cut, on its tile and in the agents list, and the whole text is in the tooltip. ⚙ → All settings → **Focus layout** turns the characters into small cameras and gives their room to the shared screen.
- **Hover ✗ or ♻ to see the calls behind them.** The failed calls of an agent (the tool, what it was for, the command and the error lines that matter) and its repeated work, newest first; 🔁 ⏳ 💤 have the same card, and a tap shows it on a touch screen.
- **Margot's questions are easier to read.** Each question stands apart with its number, its short label and “pick one” or “one or more”, each option on its own row with what it means under it, and the head and foot of the card stay while the questions scroll. The card is now a switch in ⚙ → All settings, off by default.
- **Fewer asks.** The app asks for something (a star, a coffee, a look at the Halloween pack) at most once a day and never on the first day you use it, and the ☕ in the header waits for the second day. The Halloween pack is one line in ⚙ (the rest is in the Characters window), its note stops after 2 November, and the lines that offer something show one at a time, above the timeline and the highlights instead of over them.
- **Fixes.** Natural voices install from an editor or app opened from the Dock, where npm could not find node (exit 127). A visitor from another session speaks its whole line again when it has two parts. The README, the privacy policy, the plugin and the npm page now say exactly what is read and what is sent (translation in French, Spanish and Brazilian Portuguese, the jokes, the plan files, the weekly usage counter).

## 1.37.0
- **Which model spent the tokens.** When a session mixes models (a Haiku sub-agent under an Opus lead, for instance), each card's token count says which one (“⚡ 391 · Haiku”), the token count in the header lists the model of each agent, an agent's panel shows it next to its tokens, and the recap has a Model column.
- **Repeated work, counted.** A ♻ on an agent's card counts the work it did twice, read from the session alone, with no model call: a file read again with no change in between, a file another agent had already read, the same search run again, a command run again after it failed. Hover it to see each one; the recap lists them under “Repeated work”. Reading a long file part by part, reading a file again after it was edited, and waiting loops such as `sleep` do not count.
- **⚙ › Rate Agent Standup.** It opens the review page of the store your editor installs from, or GitHub in the desktop app and the command line. In the editor, a day an agent works now counts toward the one rating request, even if you never open the call. The desktop app and the command line ask once, on the third day, for a star on GitHub (“Later” asks again a week later, one time).
- **A coffee for the dev, asked once.** The ☕ button stays in the header down to 300 px wide, so it shows in the sidebar too. Once, at the end of a long run you followed live (from the second day you use the app, never the day the star is asked), the call asks whether it helped and offers a coffee: either answer, or none, ends it for good. The extension's page in VS Code also has a Sponsor button. Nothing is sent: the days are kept in your settings file.

## 1.36.0
- **A Bash command waiting for your go-ahead now says “needs you?”.** In the transcript, a command waiting for your approval looks just like one that runs, so the call and the board said “working” while the session waited on you. Recent Claude Code also notes, for each open session, when a menu waits for your answer: the app reads it, and a permission or a question shows “needs you?” the moment it opens, even one left open for an hour, with the command or the question next to its timer in the header (“Margot — needs you? 2 min · Bash(npm run build)”) and on its card.
- **What you are answering to, in the call.** While a menu waits for you in the session the call follows, the lead says what it is, word for word, in a card beside the call that stays until you answer: the question and its options numbered as in the menu (one or several choices), the command and what it is for, the file to edit, the plan to approve. You still answer in Claude Code; the card goes when you have. Claude Code does not always write a question down before you answer it: until it does, the card says a menu is waiting, and the question appears as soon as it is written. A plan is read from its own file, so it always shows.
- **Time waiting on you, apart from time spent working.** A card that waits for you says how long the session worked and how long it has waited since (“worked 25 min · waiting on you for 12 min”): a session that looks slow may have finished the hard part ten minutes ago and need one answer. A card at work says how long it has been at it, and the lead’s “your turn” in the call how long ago its turn ended.
- **Your session no longer drops out of the call when many sessions are written elsewhere.** The app keeps a list of recent sessions, and for Claude Code it was the 40 most recent across all your projects. On a machine where a desktop app or a script writes many sessions in temporary folders, or with many projects at work, the Claude Code session of the folder you follow could leave that list: no tab, and the call stayed on another session, such as a Mistral Vibe one in the same folder, which has places of its own. Every folder now keeps its newest sessions in the list whatever is written elsewhere, and sessions in temporary folders have a few places of their own.
- **A menu left open for a while still needs you.** Opened (or reopened) on a session whose menu had waited more than three minutes, the call said “your turn” and showed no card. It now says “needs you?” and shows what the menu asks, however long it has been open.
- **Your own dialogs are not a question for you.** Claude Code also says it is waiting while you have /model, /config, /mcp or another of its dialogs open: the status bar no longer turns red for that, and no visitor knocks.
- **A menu forgotten for more than half an hour no longer takes the call.** It still needs you on the board and its visitor still knocks, but the call stays in the session you are working in.
- **VS Code stays responsive while the call reads a large session.** The app's server now runs in a process of its own, started when you open the call. Reading a 100 MB session held every extension of the window for over a second, Claude Code's included; it is now a few milliseconds. If that process cannot start, the server runs inside VS Code as before. A window whose call you never open starts nothing.
- **Two windows no longer both speak.** Each VS Code window has its own server, and two windows with the call open could talk at once: which window has the sound is now known to all of them.
- **A window follows its own folder, not the one beside it.** A session in `app-old` could take the call of a window open on `app` (Claude Code names both folders alike). The call now takes the sessions of the folder and of the folders inside it only, for Claude Code, Codex and Mistral Vibe.
- **Fast with hundreds of folders.** With one folder per task (worktrees), the list of sessions grew without end and each refresh read them all again (300 ms). It keeps 200 sessions and refreshes in about 10 ms.
- **Windows: translation works again with Claude Code installed through npm.** The command line reached it cut into pieces.
- **The desktop app runs on Electron 44** (from 33, no longer supported), opens only the links the extension opens, and refuses the camera, microphone, screen and location to its page. It needs macOS 13 or later.
- **Smaller fixes.** Going to a session in the second after it appeared no longer comes undone. After a language switch, what each agent is doing is in the new language. A status cut short ends on a whole word. “Your settings moved” is no longer shown to someone who never saw the old menu. Natural voices that hang are started again instead of silencing the lines after them. A hidden call that nobody can hear asks the server less often. One odd line in a transcript no longer breaks a session's card, and one request can no longer stop the server. The German call says “du” throughout, and the settings search and speed buttons are named for screen readers in every language.

## 1.35.0
- **Artifacts made from a claude.ai template are shown in the call.** When Claude builds a design or a document from one of claude.ai's Artifact types (a Claude Design booklet, for instance), the window used to say “No preview here” for the whole session. It now shows each page as Claude publishes it, a few seconds each, under the name the canvas gives it (“03 · Day 1 – Session”). claude.ai lets no other page show its own, so each page is put together from the session file, as for any artifact; its scripts do not run and nothing is fetched unless you load its libraries.
- **The whole document, once it is made.** When the lead says it is done, the window shows every page of the document at once. Click it in the line of files and it opens laid out as on the claude.ai canvas, rows and titles included, at the width of the window, to scroll through.

## 1.34.0
- **Docs and pages opened for you are in the line of files.** A document Claude writes with the Claude Docs connector, and an artifact Claude opens on your screen, now show under the call with the files made for you: their title and their link (claude.ai lets no other page show them, so there is no preview). Each one appears once, whatever its address; the call says “Showing …” when an agent opens one.
- **Easier to find in VS Code.** The extension declares the 30 keywords the Marketplace allows (ai agents, multi-agent, agent monitor, dashboard, anthropic…), so a search in the Extensions view finds it.
- **One request for a rating.** On the third day you open the call, a notification asks whether you would rate Agent Standup, on the page of the store your editor installs from (the VS Code Marketplace, or Open VSX for Cursor, VSCodium and the others). “Later” asks again a week later, once; “Rate it” and “No thanks” end it. Nothing is sent.
- **Help count how many people use it (only if you say yes).** The first time you open the call, the extension asks once whether to turn on “share usage”, with what it sends: an empty request for a 1-pixel file on GitHub, once a day when the editor starts and at most once a week when you open the call, with no identifier and nothing about you or your sessions (GitHub sees your IP address, as with any download). It is not asked when VS Code telemetry is off, and the setting can be turned off any time. The privacy policy says so.

## 1.33.0
- **The Halloween pack.** Eight characters drawn by hand by Fabien Coupas (@fabien_coupas on Instagram), each in its own room: a pumpkin leads the call, you are a vampire, and a ghost, a cat, a bat, a wolf, a witch and skeletons do the work. They talk with two mouths and a head that nods a little, their hands type while they work, and now and then one of them pulls out a laptop with stickers for a few seconds. When a call has more agents than characters, the next ones are skeletons, each with its own mix of 5 hats, 4 pairs of glasses, 2 moustaches and 3 pairs of eyes. **2 € or more**, one payment on a Stripe page, no account: ⚙ → Characters → Halloween pack → Buy. The pack installs by itself once paid. Its purchase code (`HW-XXXX-XXXX`, also on the receipt Stripe emails) installs it on another computer: ⚙ → Characters → Halloween pack → “I already bought it”. It can also be bought, and downloaded again, on https://agent-standup.com/shop/
- **You are the vampire.** The pack's vampire is free for everyone and is your character in the call when you use the drawn characters. To get your previous character back: ⚙ → Characters → You → “Like the cast”. A cast you chose yourself (the cat pack, your own pictures) keeps its own human.
- **⚙ → Characters opens a window.** The cast (the drawn characters, a pack, the cat pack, your own pictures) and who you are, each with a picture. For your own pictures, it has a button per role to add one, and an ✕ to take one out: a picture replaced or taken out is moved to a `replaced` folder, never deleted.
- **Your own characters can be drawn in layers**, as the Halloween pack is: `name-bg.png` (its room), `name-head.png` (a head that nods while it speaks; `name-talk.png` is then the head with its mouth open), `name-hands.png` (hands that type), `name-desk.png` and `name-desk-dark.png` (a laptop it pulls out now and then), `name+hat-1.png` and so on (what it may wear, one of each kind or none per agent). Large pictures are drawn smooth; pixel art keeps its hard pixels.
- **A lighter settings menu.** ⚙ keeps what is changed often: search, language, voices, characters, source and tools. The rest (display, alerts, ambience and music, the laptop, your agents' own names) is in **⚙ → All settings**, which the search finds too, with a **Reset to defaults** at the bottom. A tip says once where the settings went.
- **Click on yourself.** The panel of the human (click your tile) now lists what you did while the agents worked: a walk, too much coffee, cloud spotting, approving without reading… A new day at each opening.
- **Sessions started in a temporary folder no longer take the call.** A script or a tool that runs Claude Code in a folder of its own under the system's temporary folder (`/var/folders`, `/tmp`, `AppData\Local\Temp`) leaves a session each time. When the call follows all projects, or your editor's folder has no session, it went to those: one of them, with no tab for yours. It now leaves them out unless there is nothing else, they have no tab and send no visitor, and the VS Code status bar does not count them when no folder is open. They are still in the Sessions view, and a window open on such a folder follows it.

## 1.32.0
- **A softer babble.** In the Animal Crossing style each letter was a click: full level in 2 ms, gone 10 ms later, tiring now that it is what you hear before the real voices are installed. Same notes and same rhythm, but each blip now has a rounder start and a short tail, and the high voices, which came out twice as loud as the lead, are level with the others.
- **Two voice styles, and the natural voices are the default.** ⚙ → Voice style now has the **natural voices** (the Kokoro model, called *Very natural voices* until now) and the Animal Crossing babble. Until the natural voices are installed (about 750 MB, one download for every language) the agents babble in the Animal Crossing style, and a line at the bottom of the call says the real voices exist: **Install** fetches them and switches to them once they are ready, ✕ closes the line for good. The cartoon voices (the default until now), Simlish and the plain system voices (*Natural*) are gone: whoever had Simlish is on Animal Crossing, and whoever had the cartoon or the plain system voices is on the natural voices.
- **With the natural voices, a system voice only where the model has none.** A line in German, Danish, Japanese, Korean or Chinese is read by a system voice of that language when your computer has one (it was read by an English voice), and so is a line the model could not make.
- **The natural voices speak French, Spanish and Brazilian Portuguese.** In French, they used the Kokoro model for English lines only and handed every French line to the system voices. French now comes from the same model, and so do Spanish and Portuguese, with eight voices each as in English. The model has few voices outside English (one French, three Spanish, three Portuguese): the lead takes one as it is, and each other character gets one of them mixed with its English voice, so an agent sounds like itself in every language. A new install includes it (18 MB more, the eSpeak NG phonemizer, fetched by npm like the rest). If the voices are already installed, a line at the bottom of the call and ⚙ → Voice style offer to add these voices when the interface is in one of the three languages; until you click, their lines stay on the system voices.
- **The call in Spanish or Brazilian Portuguese.** With one of them as the interface language, the call is held in it: what the agents say is translated into it as it is in French, the little lines between agents are in that language, and everything is read by Spanish or Portuguese voices. Translating sends the lines to Anthropic through your own Claude Code login and counts on your plan, so the first such call says it once, with **Turn off** next to it; the switch stays in ⚙ → Language (**Call in this language**). French is as before.
- **In a replay, agents no longer talk over each other.** Sub-agents that had spoken back to back were played together, up to three voices at once: with the natural voices, and in a call with many sub-agents, most of what they said was lost. They now take turns, in the order they spoke, as they already did in the live call. A replay with many sub-agents lasts longer for it.
- **A Spanish or Portuguese line is read by a voice of its language**, whatever the interface language, and also with that switch off: a session you hold in Spanish was read by English voices. By the natural voices of that language, or by a system voice (Mónica, Paulina, Luciana on a Mac) until their add-on is installed.
- **The call is in the session you last touched, and a click on a tab pins it.** Start a session or type in one, and the live call goes there. What the agents write no longer moves the call: it used to follow the session written to last, so with two sessions at work it went from one to the other. Click a tab to pin the call there (📌): it stays while you go through the Claude Code tabs of your editor and while you type in it, until you ask something in another session, which takes the call there, or until you click that tab again. A pin used to hold whatever you did: a new order in another session did not bring the call along. The visitor, or a session picked in the list, takes the call there without pinning it: it stays until you type somewhere. One case moves the call without you: when the session you last typed in has finished and been quiet for a minute and a half while another one is still at work, the call goes to that one. A session you went to by a click is not left that way.
- In VS Code, the Claude Code tab you switch to keeps the call for as long as you type nowhere else. It kept it for a minute and a half. A call you pinned stays where it is while you switch tabs.
- **The Sessions view is in sections, what waits for you first:** needs you?, your turn, working, waiting on sub-agents, idle, each with its count. It was one grid with the counts in a line above.
- **The question on the card.** A session that stopped on a question shows the question itself on its card, not only “AskUserQuestion”.
- **Put a session away as done.** ✓ on a card whose turn is over, or that is idle, moves it to a **Done** section at the bottom of the Sessions view, closed until you open it. The session comes back by itself when it moves again, and ↩ brings it back at once. Its tab leaves the row of tabs of the call too, unless the call is in that session. Kept in a small file beside your settings, so every window agrees within a few seconds. The menu bar and the status bar still count it.
- **The pull request of a session on its card.** When Claude Code noted a pull request for a session, its card has a **PR #n** button that opens it on GitHub (pull requests on github.com only).
- **Artifacts in the call.** When a Claude Code session publishes an artifact (a page on claude.ai), its author shares it on the screen in a browser window: the real page, shown whole. When the turn ends the artifact is in the line of files (🌐). Click it there, or click the window, to pin it: it takes the room at full size, can be scrolled and used, and stays until you close it (✕ or Esc). A pinned page follows the next versions the session publishes, ‹ › step through the other artifacts of the session, and ↗ opens the page on claude.ai. In a replay each publish shows the version it sent. The page is put together from the session file (the Write and Edit calls that made it): nothing is read from your disk or fetched from claude.ai, which lets no other page frame it. It runs in a frame that can reach neither the app nor the network. A page that uses libraries kept on a CDN shows **Load its libraries** (also ⚙ → Display → **Artifacts: load their libraries**), off by default. An artifact made from a claude.ai template (a deck, a design, a document), or whose page a command wrote, has no preview: the window shows its title and its link. In exported videos the page is an empty frame.
- **Cowork sessions too.** Sessions of Cowork, a tab of the Claude desktop app, appear next to your Claude Code sessions: in the session list under “Cowork”, on the board, and in the live call when one of them is the most recent, sub-agents included. Each has the name the desktop app gave it, a “Cowork” mark on its tab, and a lead that reads “Lead · Cowork”. Nothing to set up: Cowork records its sessions in the format of Claude Code, in the desktop app's own folder, and the app reads them there and never writes there. A task Cowork runs on a schedule is a session too. A conversation in the Chat tab is not on your computer and cannot be shown. `AGENT_STANDUP_COWORK=off` (command line: `--cowork off`) leaves them out. Checked on macOS; not yet on Windows or Linux.
- **A second session no longer goes unseen when your editor is open on another folder.** When the folder the live call follows has no session (VS Code open on one folder, your agents started in a terminal in another), the call already went to the latest session of anywhere, but there was no row of tabs: one session on screen and nothing to say there was another. The tabs now show the other active sessions too, as they do when no folder is followed.
- **Tabs say which tool runs a session.** A Mistral Vibe or Codex session has a small “Vibe” or “Codex” mark on its tab, and in its call the lead reads “Lead · Vibe”. The lead has the same name in every call, so two sessions of one folder looked alike. Claude Code sessions are as before.
- Opening a Mistral Vibe or Codex session from the Sessions view or from ⋯ no longer makes the live call follow that tool only. It saved “Mistral Vibe” (or “Codex”) as the project to follow: a window with no folder open then showed that tool’s sessions and never a Claude Code one, also after a restart. If you are in that state: ⚙ → Source → **All projects (most recent)**.
- In VS Code, a click on the status bar while a Mistral Vibe or Codex session is the one at work opens the call on that session, and the window goes on following its folder. It followed that tool only: let go of the pin, the call stayed among the Vibe sessions and the Claude Code session of the same folder had no tab.
- **A sub-agent’s report is heard again.** Since Claude Code 2.1.293 a sub-agent hands its report back to the lead through a call of its own, and most write no last sentence beside it. The app took the last sentence it found as the report: the report itself was not said, and the sentence the agent had opened with (“I am reading the files…”) was shown as its report to the lead. The report is now what the agent hands back.
- **Report a problem.** ⚙ → **Report a problem** opens the draft of an issue on GitHub, filled with the app’s version, your system and the last errors the app noted. It now keeps its own errors in a small file on your computer (`errors.log`, beside your settings), cut down when it grows. You see the text first, and nothing is sent until you send the issue yourself.

## 1.31.0
- **Several sessions at once.** When a second session is active, a row of tabs appears under the header of the live call: the session the call is in and the others, each with its state (working, needs you?, waiting on sub-agents, your turn). Click a tab to move the call there; it stays there (📌) until you click its own tab again, which lets the call follow the latest activity. With a single session there is no row.
- **A visitor when another session stops for you.** A question, an edit that waits for your go-ahead, or a turn that is over in another session: someone from there leans in at the edge of the call and says which one, between two lines and never over one. A click takes the call there. ⚙ → Display → **A visitor when another session needs you** turns it off.
- **In VS Code the call goes to the Claude Code tab you switch to**, so a conversation and its call can sit side by side. A tab does not pin the call: it stays with that conversation for a minute and a half and for as long as it is active, then follows the latest activity again. A call you pinned takes its pin along. A tab is found by its title: a conversation that has no title yet, the sidebar chat and a terminal do not move the call. ⚙ → Display → **Follow the Claude Code tab I am on** turns it off.
- **Files made for you.** When a turn ends, the files the session created for you show in one line under the call: those the lead names, else the documents (a report, a picture, a spreadsheet), not every source file it wrote. A document made by a command (an export, a report written by a script, a package) shows too when the lead names it. A click shows the file in its folder (Finder, Explorer, the file manager); nothing is read and nothing is run. All the files are in the list behind “+N”. ⚙ → Display → **Files made for you, when a turn ends** turns it off.
- **The lead's turn ends when Claude Code says so.** The end of a turn is read from the mark Claude Code writes, in the call and in the list of sessions. The lead is no longer shown as done, with “your turn”, each time it thinks for a while, also in the first turn of a session. It has a word each time its turn ends: what it changed, that it waits for your answer, or the floor back to you; and one when the agents it waited for are all back.
- **Token counts are live again.** During a live call the ⚡ counts on the tiles and in the header stood still: they only moved on a reload or when you moved the slider. They now follow the session. The camera of the agent who shares its screen carries its count, the large tile shows it readably, and each line of the agents list has it. An agent whose tile has left the stage keeps its line in that list, under “done”, with what it used. The header counter says who used what.
- A turn that ends on a message Claude Code writes itself (the API is down, the limit is reached, the request was refused) is over: the lead looked busy for three minutes after it.
- A session you stopped with Esc reads “your turn” on its tab, in the Sessions view and in the VS Code status bar. It read “working” for ten minutes.
- With Claude Code 2.1.87 and older, a session could read “your turn” in the middle of a turn, between a sentence and the tool call that follows it. Such a line is now given 45 seconds.
- `research_notes/` and `reports/` folders in the project are never part of a package.

## 1.30.0
- **Mistral Vibe sessions too.** Sessions of [Mistral Vibe](https://github.com/mistralai/mistral-vibe), Mistral’s coding agent (the `vibe` command), appear next to your Claude Code and Codex sessions: in the session list under “Mistral Vibe”, on the board, and in the live call when one of them is the most recent. Nothing to set up: the app reads the folders Vibe already writes in `~/.vibe/logs/session` (or `$VIBE_HOME`) and never writes there. You see what you typed, what the agent says, each command and tool call with its real output and whether it failed, the files it changed, its todo list, its reasoning as inner thoughts, the token totals, and **its sub-agents**, which join the call under the name the lead gave them, with their orders and their answers.
- **Both of Vibe’s engines are read**, each checked against real sessions of Vibe 2.26.1. The one it starts by default keeps the time of every event, so the call is exact; a sub-agent leaves no record of its own there, so you see what it was asked and what it answered, not each of its commands. The earlier one (`vibe --legacy-harness`, and older versions) does record a sub-agent’s commands but writes no times: followed live they are right to within a step.
- **Leave Vibe out if you prefer:** the VS Code setting `agentStandup.vibe`, or `AGENT_STANDUP_VIBE=off` (command line: `--vibe off`). The Claude Code and Codex sessions shown before are all still there; Vibe ones are added beside them.
- **The lead is now called Margot**, whatever tool runs the session. It was “Claude” in a Claude Code session and “Codex” in a Codex one. One character for every model, and no product name on it. Your own picture for the lead (`lead.png`, or `claude.png`) works as before.
- A character pack name that is not a pack (`constructor`, `toString`…) answered with a server error. It now answers that there is no such pack. Found by [thesubr00t](https://github.com/thesubr00t) (#7).
- The website, the README, the store description (ten languages) and the command line help now say Claude Code, Codex and Mistral Vibe. Unofficial as before: not affiliated with Anthropic, OpenAI or Mistral AI.
- New pictures and videos, recorded from the current app, and a short video for Mistral Vibe users in English and in French.

## 1.29.0
- **Your own agent names.** A sub-agent you defined yourself (a file in `.claude/agents/`, for example `code-reviewer.md`) or named when it was launched now keeps that name on its tile, in the transcript and in the voices: “Code Reviewer” rather than a first name drawn from the list. Two of the same type become “Code Reviewer” and “Code Reviewer 2”. The agent types Claude Code ships (general-purpose, Explore, Plan…) still get a first name. ⚙ → Characters → **Keep my agents’ own names** turns it off. Asked for by [Eshinio](https://github.com/Eshinio) (#6).
- **The slider works in Replay and in the demo.** It sat at the left and did nothing when clicked or dragged; only a live call set its range. This had been there since the first version.
- **French lines get proper French voices.** With the very natural voices, every French line was read by one and the same system voice, the first in the list (a Canadian one on a Mac): the speech model has no French voice, whatever earlier versions said. French lines are now read by your system voices, one per character, French from France first unless your computer is set to another French. For a clear improvement on a Mac, download an *Enhanced* or *Premium* French voice (System Settings → Accessibility → Spoken Content → System Voice → Manage Voices).
- **Natural voices: no more robotic ones on a Mac.** Apple’s synthetic voices (Eddy, Flo, Reed, Sandy, Shelley) were picked among the five voices of a call, in English as in French. They are now used only when fewer than two other voices are installed.
- **Faster first load.** The first page after the app starts waited a second or more for the list of system voices. The call now appears at once and the voices follow.
- **Header:** the status pill is no longer shortened to “REPL…”, and when the window is too narrow for the counters they lose their words (the icon and the number stay) instead of being cut mid-word. This showed in Spanish, Portuguese and German.
- Live, Replay and Demo are translated in the eight languages that have a catalogue.
- The website shows the install commands whole (they were cut with “…” on narrow screens).

## 1.28.0
- **Korean (한국어).** The interface is available in a tenth language: menus, chips, tooltips, the recap, and in VS Code the command titles, the setting descriptions and the status bar. Pick it in ⚙ → Language. Contributed by [jainefer](https://github.com/jainefer) (#5). Like the other languages apart from English and French it is an AI draft not yet reviewed by a native speaker: corrections are welcome.
- The website and the README suggest the very natural voices for the best experience (⚙ → Voice style, a one-time install).

## 1.27.0
- **Codex sessions too.** Sessions of OpenAI’s Codex (the desktop app and the `codex` command) appear next to your Claude Code sessions: in the session list under “Codex”, on the board, and in the live call when one of them is the most recent. Nothing to set up: the app reads the files Codex already writes in `~/.codex/sessions` (or `$CODEX_HOME`) and never writes there. You see what you typed, what the agent says, each command with its real output, the files it created or changed, web searches, MCP calls, the questions it asks you, its reasoning summaries as inner thoughts, token counts and the end of each turn. The lead is called Codex.
- **Not yet for Codex:** its sub-agents (a Codex call is the lead and you) and pictures. A command appears when it has finished, because that is when Codex writes it down.
- **Leave Codex out if you prefer:** the VS Code setting `agentStandup.codex`, or `AGENT_STANDUP_CODEX=off` (command line: `--codex off`). The session list and the board keep all the Claude Code sessions they showed before; Codex ones are added beside them. With French translation or the jokes turned on, the lines of a Codex session are sent through your Claude login like any other line.
- **Opening the call on one session works again.** Clicking the status bar in VS Code to open the call on a given session showed an empty page: one line ran too early and stopped everything. It had been there since 1.20.0.
- The website, the store description (nine languages) and the command line help now say Claude Code and Codex. Unofficial as before: not affiliated with Anthropic or OpenAI.

## 1.26.0
- **A new icon: the lead itself.** The app icon is now the lead as you see it in the call (the peach character with the gold headset, its focused smile, its desk and its coffee), in front of a window at night. It replaces the old icon in the extension list, the desktop app (macOS and Windows) and the website, and the camera emoji in the header and the browser tab. The red dot on the tab when an agent may be waiting for you is still there.
- **The lead’s room has a window.** The three screens with rising curves behind the lead looked like a trading desk. They are replaced by a window on the city at night, with a few lit windows that twinkle slowly.
- **VS Code side bar:** the one-colour symbol is now the lead’s head with its headset (it was a camera).
- **Desktop app:** the indicator in the menu bar or tray has its own small drawing, sharp on high-density screens, where it used to be the large icon shrunk to 18 pixels.
- **For contributors:** the drawings are in `brand/` with a short guide (files, colours, how to use the logo), and `npm run brand` renders every icon, the link preview and the README header from them. The link preview and the README header now show the team at the office.

## 1.25.10
- **Inner thoughts, tidied.** The “54 calls in. What do I know so far?” thought is gone: it came back with a new number every time. An agent’s own reasoning is shown in whole sentences (it was cut at every dot: “The migration in db/schema.” then “sql locks the whole table.”) and each line of its notes is a thought of its own. A thought sits above the activity line and takes three lines at most; in the narrow list it is one line inside the row, so the rows no longer jump. No more doubled punctuation (“Why is the login slow?.”), long file names are shortened, a command is named without the folder it starts from, a search pattern that is a regular expression is not read out, and the kind of agent (“Explore”) is not a task. A thought no longer flashes just before the agent’s own line, ends when the agent is done, and the mumble of the babble styles is cut by a spoken line too.
- **The wrap-up is made for the ear.** “To sum up” read up to 520 characters of Markdown as one run: a heading straight into the next sentence, list dashes, table rows, half a minute long. It now says the first sentence of each paragraph and list item, a short heading as a sentence of its own, no tables, code, emoji or clock seconds, in about 280 characters (18 seconds).
- **Very natural voices no longer drop the end of a long line.** The model takes about 500 characters per call (300 when the line is full of numbers) and the rest was cut without a word. A longer line is now made in parts, cut at the ends of sentences, and joined. Clips made before this version are not reused.

## 1.25.9
- Very natural voices (Kokoro): a model download cut short (the window reloaded or the app quit while the model was being fetched) left a file that failed to load every time after, and the natural voices were gone until someone deleted the models folder by hand. The file is now dropped and fetched once more. Contributed by [neondragon](https://github.com/neondragon) (#3).
- The starter pack is no longer shipped: ⚙ → Characters offers the drawn characters (default), the cat pack and your own folder. Its three example images stay in the repository (`examples/characters`) as a model for your own. If you had chosen it, the call goes back to the drawn characters (or to your folder if it has images).

## 1.25.8
- **Inner thoughts.** In a live call, an agent that has been at work for a while thinks to itself: a lighter, italic bubble that is not said out loud. What it thinks is real. When the session keeps the agent’s own reasoning, the bubble shows it, sentence by sentence, before anything else; Claude Code only keeps that text for some of the lead’s steps and almost never for sub-agents, so the rest of the time the thought is about what the agent is on: the command it is waiting for, the files it goes between, its current to-do item, a failure, its task. About one thought in five escapes as a mumble: the character’s own voice, low and muffled, lips closed, cut as soon as anyone speaks. Never while the agent talks, two at most on screen, off in Quiet or with ⚙ → Little lines & animations.
- **Your own lines are always voiced.** An order typed during a long command is handed over when the command returns, stamped with the time you typed it: two minutes “late”, so the call showed it without a voice, as it does when it is far behind. It now takes its place when the lead gets it. And whatever the backlog, a line of yours is never skipped nor muted: it is said, shortened if need be.
- Open VSX is published by the release workflow itself (trusted publishing, no token).

## 1.25.7
- **A live call that does not lose anything.** The page used to ask the server for “everything after line N”, but a session is not written in order: lines are added in the past, and lines already sent change. The server now tells the page what is new and what changed, and the page corrects itself. In a live call this brings back what was missing: an order you type while the lead works (1.25.6 only showed it after a reload, and could say the lead’s last line twice), a sub-agent’s report (its last line becomes a report a few seconds after it is written: until now it went by as an ordinary line, with no ✅, no ding and no thanks), and every tool call of a message that launches several.
- **The lead’s turn ends when it really ends.** Claude Code marks the message that closes a turn; the call uses that mark instead of “quiet for 25 seconds”. No more “your turn”, confetti and “To sum up…” in the middle of a turn after a long command; the lead shows as working while it thinks about your order; “Notify me when the agents finish” also works for a session without sub-agents. An interrupted turn ends too.
- **Speech bubbles are readable.** A bubble sits above the tile’s own status badge and icons at every width, is no longer cut by its tile, and is not shown twice.
- **Narrow panels (the VS Code side bar).** One row per agent up to 480 px, whoever needs you first; the playback bar no longer overflows; Call / Tree / Sessions stays reachable; no sideways scrolling from 270 px.
- **One status that tells the truth.** The header said WAITING while the lead worked, while an agent needed you and when it was your turn. It now says which: offline, who needs you, who is stalled, how many are working, or your turn with the lead’s last sentence (“Do you want me to commit?”). A click goes to the agent concerned.
- **First run.** With no session yet, the empty state and its demo button are no longer hidden behind Join, and the text names the folder being watched. Join has the focus (Enter joins); the settings toggles tell screen readers their state; Escape closes the menu and the detail panel.
- **Voices.** A line ends when its sound ends: the slowed-down cartoon characters kept talking over the next speaker for up to 2.5 seconds, mouth closed, and Pause did not stop them; subtitles now follow the real length of the voice. The voice says what the caption shows: “and/or” and “client/server” are read in full (only a file path is named by its last part; a web address by its site). A short line (“OK.”) no longer makes a character switch to the voice of the other language for one sentence. When the call is behind, the next lines are prepared in the form they will be said, so a voice starts with its line instead of a second later.
- **Chatter between agents is Normal by default again** (Quiet since 1.25.0 for those who had not chosen).
- Sub-agents launched by a workflow are part of the call (they were invisible). A compaction summary is no longer read aloud as if you had typed it. Session titles follow a later rename.
- Fix: the lead’s own answer to your order was skipped after a long order. Fix: pausing and resuming at the end of a live call said the last line again. Fix: in a replay, jumping to another line of the same speaker closed its bubble.
- Safety: one malformed request could stop the standalone server; another site could read the saved settings through a script tag; speech commands hidden in a transcript (`[[slnc …]]`) reached the macOS voice.
- Under the hood: the live call is now tested in a real browser on every push (one case per regression that reached a release), and nothing is published from a commit whose tests fail.

## 1.25.6
- **The lead answers your order.** About one time in three, Claude starts on its tools without writing a word, and the call stayed silent after your order (half a minute on average, sometimes minutes). In a live call the lead now says what it is starting with, taken from the tool call itself (“Got it. Let me look at server.js.”, “Okay. I’m running a command: run the tests.”). Only when it has not spoken by itself; local like the other little lines, absent from the transcript, off with ⚙ → Little lines & animations.
- Fix: in a live call, sub-agents no longer answered the lead’s orders, and the lead hardly ever thanked them for a report. Since 1.25.0 these little answers were only said when the call was less than 6 seconds behind the session, and reading the order itself takes longer than that while the new agent is already at work. An answer to what was just said is now allowed up to 30 seconds behind (remarks from bystanders still wait for a quiet moment). After a parallel launch, the first three agents answer (only the first one did since 1.25.2).
- An order you type while the lead is working is now part of the call. Claude Code hands such a message over in the middle of the turn, in a record of its own, and the call ignored it: your line was neither shown nor read, and the lead’s answer came out of nowhere.
- Fix: joining a live call read the end of the previous one again. The call picked the session up 16 events before its end, whatever its age, so the last lines of a session that was long over were said as if they had just happened (and said once more each time the session was loaded again: a rewritten transcript, a return from another session). A live call now starts when you join it: what happened before is on screen (states, transcript) and only what comes after is said, once. If the agents are at work when you join, the last 10 seconds are said too, so you know what they are on.

## 1.25.5
- Fix: the lead could read the same wrap-up several times in a row (its state flipped to done more than once without a new message). Once per message now.
- While a screen is shared, a member who speaks still gets the spotlight (the presenter’s own tile stays small: its camera is already in the corner of the share).

## 1.25.4
- Fix: after a change of characters (a pack, Reload, your folder), the small camera in the corner of a shared screen kept the previous look while the tile had the new one, so the lead could appear as two different characters at once.

## 1.25.3
- **Character packs built in**: ⚙ → Characters → Starter pack or Cat pack switches the whole call to those characters in one click, in the extension, the command and the desktop app alike; Drawn characters is the default; My folder uses your own images (picked by itself if your folder already had some). Until now the packs only lived in the repository, to copy by hand.
- **The voice follows the language of the line, not of the interface.** A session written in French with the interface in English was read by an English voice (French with an English accent); the other way round, an English line was read by a French voice. Each line now gets a voice of its own language when it clearly reads as French or English (the short lines of banter keep the interface language). A line already in French is no longer sent to Claude for translation.

## 1.25.2
- **Sub-agents show up at once in a live call.** When the lead launches several agents in parallel, their tiles appear the moment the orders are written (before, each tile waited for its order to be read out, one after the other, and a burst of hundreds of tool events could hide them until the call caught up). The first order is read in full; the others are named in one line (“Also Remy on X, Iris on Y”). Hundreds of tool events from parallel agents now scroll past in a couple of seconds instead of minutes.
- **The lead says what it did.** When the lead finishes (confetti), the part of its last message that the live reading had cut short is read as a wrap-up (“To sum up: …”), so you know what was done without opening the transcript.
- **Quiet chatter really is quiet**: no lines to fill the silences, no thinking out loud, no remarks from bystanders; only the real exchanges (orders, reports, a word of thanks or acknowledgement).
- A little faster voice while catching up on a backlog.

## 1.25.1
- Fix: in a live call, the first line after a silence (typically your own order) was skipped or rushed. The call measured how far behind it was against the previous event, which after a few idle minutes looked like a huge backlog. The lag is now the gap between the line being played and the newest line of the session, so an idle session is never “behind”.
- Fix: your own sub-agent characters were picked per agent without looking at the others, so two sub-agents often got the same picture while others went unused. A new sub-agent now gets a picture no other agent on the call holds; pictures repeat only once every one is taken. Contributed by [rqwj](https://github.com/rqwj) (#1).
- A cat pack in `examples/cats` (11 cats, CC0), contributed by [KajetanCiunelis](https://github.com/KajetanCiunelis) (#2). Their suggestion too: ⚙ → Characters → **Laptop in front of your own characters** (off by default) shows a darker laptop while a custom character works, dark enough to stay visible under a white or cream sprite.

## 1.25.0
Five UX improvements and agents that talk to each other more.
- **Jump to who needs you**: press **J** / **K** (or click the “need you” / “stalled” chip) to move to the next agent that needs you or is stalled. The help (**?**) now explains each state.
- **Settings menu**: sections that fold (and remember it), a search box, a new Display section. “Notify me when the agents finish” is now on by default (until you choose otherwise; the browser asks permission on your first click).
- **Cmd/Ctrl+K**: jump to any session from any view, with search.
- **Very narrow panel** (under 300 px, like the VS Code side bar): one row per agent instead of tiles. Wider windows keep the tiles.
- **Replay**: **←** / **→** step through the call, **N** / **Shift+N** jump between highlights, speed presets 1× 2× 4× 8×, and each session remembers where you stopped. Browser shortcuts (Cmd+R, Ctrl+N…) are no longer taken over by the page.
- **Agents talk to each other**, using what really happened in the session (edits, tool calls, errors, files, time taken): a new agent asks a question and the lead answers; a report gets a reaction that fits (all good, errors along the way, that took long) and sometimes a word from a third agent; an agent that fails three times in a row gets a “you okay?”; every few minutes the lead calls a quick round and the busy agents answer. ⚙ → Display → **Chatter between agents**: Quiet (default) / Normal / Lively.
- Reports are introduced more naturally (“All done. …”); orders keep the lead’s exact instructions, read a little longer in a live call.
- **Live calls keep the rhythm of the real session**: the page measures how far behind the real conversation it is and, past 6 s, speaks a little faster and reads shorter lines; the small talk and the exchanges between agents only happen when the call has caught up; past a minute it skips ahead. New events are polled every 0.4 s (was 0.7) and their audio is prepared as soon as they arrive. On a simulated live session the median delay between a line being written and it being spoken went from about 3 s to 1 s.

## 1.24.3
- **Dansk** (Danish) interface, suggested by a Reddit reader. AI-drafted: corrections welcome in `public/locales/da.json`.
- **Keyboard shortcuts** are listed under ⚙ → Keyboard shortcuts, or press **?**. Switching to the tree view with **T** now says how to get back.
- README: a security section (what it reads, what it can send, local only) and how several sessions at once are handled.

## 1.24.2
Narrow and short windows (the VS Code side bar, a small panel), found by going through every panel at five window sizes.
- Fix: the Sessions view showed a blank page when the window was 640 px wide or less, and stayed blank on the next load. A style meant for the status chips of the header was also applied to the whole page.
- Fix: the settings gear (⚙) slid off the right edge under about 400 px. The buttons now keep their size; the name, the context gauge and the token counter give way instead (the gauge is hidden under 480 px, the counter under 420 px).
- Fix: in a window less than about 350 px tall, the Highlights bar covered the seek and speed sliders while an agent shared their screen. The shared screen now shrinks, and the bar keeps to two rows and scrolls.
- Fix: the task list of the shared screen was cut off with no way to scroll (no task visible at 1280×450, a list of 8 cut at 1280×720). It now uses the full height, scrolls, and brings the task in progress into view.
- Fix: in a window narrower than about 480 px, the task list squeezed the shared terminal to a strip. The task list is now hidden there and the terminal keeps the room.
- Sessions view: cards of sessions that need you or are stalled keep their coloured border and status chip, but are no longer filled with red or orange, and titles are no longer tinted. That fill came from the same misapplied style.

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
