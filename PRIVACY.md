# Privacy

Last updated: 21 October 2026.

This page covers Agent Standup in all its forms (the VS Code extension, the `agent-standup` command, the desktop app, the Claude Code plugin) and its website. Agent Standup is published by Double Geste, an individual developer. It is an unofficial community project, not affiliated with Anthropic, OpenAI or Mistral AI.

## The short version

Agent Standup runs on your own computer. It reads files that are already there, shows them to you in a page served from your machine, and by default sends nothing anywhere. There are no accounts and no advertising, and the app itself has no analytics (the website counts its visits, see "The websites" below). The developer never receives your sessions, your code or your prompts.

## What it reads

- **Your session files.** The ones Claude Code writes in `~/.claude/projects` (and the status it keeps for each open session in `~/.claude/sessions`: busy, idle or waiting for your answer; and the plan files a session names in `~/.claude/plans`, to show a plan that waits for your approval), the ones Codex writes in `~/.codex/sessions` (with the names Codex gives them in `~/.codex/session_index.jsonl`), the ones Mistral Vibe writes in `~/.vibe/logs/session`, and the ones Cowork (a tab of the Claude desktop app) writes in that app's own folder (`local-agent-mode-sessions`), with the title the app noted beside each of them. They hold what you typed, what the agents answered and what they ran, so they can contain personal or confidential information. Agent Standup only reads them. It never changes or deletes them. Reading Codex sessions, reading Mistral Vibe sessions and reading Cowork sessions can each be turned off. A page a session published on claude.ai (an artifact) is shown from what the session file holds of it; it is not read from your disk nor fetched from claude.ai.
- **The output of a command a session runs in the background**, while it runs: Claude Code writes it to a file in its own temporary folder (`claude-<your user number>` in `/tmp` or in the system's temporary folder, `…/tasks/`), and the call's shared screen shows its last lines as they come. Only the commands of the session the call follows, while they run: read every second while one is on screen, and once to see whether it still writes when nobody is sharing. Nothing is kept or sent.
- **Your own character images**, if you put some in its characters folder.
- **The list of running programs** (`ps`, on macOS and Linux), only when you click on a session that needs you, to find the editor, terminal or Claude app it runs in. That app is then brought to the front, or a local link such as `vscode://…` is opened, as a click on it would; nothing is sent.

## What it keeps on your computer

- **Your settings**, in one small file in your user configuration folder. In every form, it also holds, for the one time the call asks for a coffee, the first day the call was in view and the day it asked. In the desktop app and from the command line, it also holds, for the one time the app asks for a star on GitHub, the number of days the page was in view, the last of those days and your answer.
- **Spoken lines, for a day.** When voices are on, each line is turned into a sound file in a private folder (a temporary one on macOS and Windows, `~/.cache/agent-standup/tts` on Linux) so it does not have to be made twice. Files older than a day are deleted.
- **The natural voice model**, only if you install it.
- **Which window plays sound**, in a file named `audio.json` beside your settings: a random name for that window and a time.
- **The sessions you put away as done**, in a file named `done.json` beside your settings: for each one, the name of its project folder, its id and a time. Nothing of what was said in it.
- **A log of the app's own errors**, in a file named `errors.log` beside your settings. Each line holds the date, the app's version, where the error happened, its message and the first lines of its stack trace. The path of your home folder is replaced by `~`, and the address of the page (which names the project) by the word `page`. An error message can still name a file or a project of yours, or hold a few characters of what the app was reading when it failed. The file is cut down when it passes 256 KB, and it is never sent anywhere by the app.
- **A character pack you bought**, in a `packs` folder beside your characters folder (`~/.agent-standup/packs`): its pictures, and in a file named `codes.json` the code of the purchase, which is the reference Stripe gave it. The code is kept so that the app can show it to you: it is what installs the pack on another computer.
- **Whether you share usage, in the desktop app, the command line and the Claude Code plugin:** your answer, in your settings file, and an empty file named after the kind of app and the week of the last request (for example `sent-cli-week-2026-10-19`) beside your settings.
- **Whether you want to hear about new versions, in the desktop app, the command line and the Claude Code plugin:** your answer, in your settings file, the last version you were told about, and, in a file named `update-check.json` beside your settings, the latest version number npm gave and when it was asked.
- **In VS Code's own storage for the extension:** the day and the week of the last "share usage" requests when that setting is on, whether you have been asked about that setting; for the rating the extension asks for (at most twice), the number of days the call was opened or an agent was at work, the last of those days, the day to ask again and whether to stop asking; and short-lived marks (a hash, no session content, deleted after a day) so that only one window notifies you of a given wait.
- **Which editor window runs which session**, in a folder named `editors` beside your settings: for each open VS Code, Cursor or Windsurf window with the extension, a small file with the number of its process, the editor's link scheme (for example `vscode`) and its window number, so that a click on a session that needs you opens it in the right window. It is removed when the window closes.

Nothing else is written. Uninstalling the app and deleting those folders removes everything.

## What can leave your computer

Nothing by default. The local server listens on `127.0.0.1` only and refuses requests that do not come from your own machine.

The following happen only if you turn them on or start them yourself:

| When | What is sent | To whom |
|---|---|---|
| You choose French, Spanish or Brazilian Portuguese as the language (for the last two, unless you switch off "Call in this language" in the ⚙ menu), or turn on the jokes | Short lines of the session, to be translated or answered | Anthropic, through your own Claude Code login (or your own API key if you set one) |
| You turn on the office radio | A request for the audio stream; no session content | Radio France |
| You turn on "share usage" in VS Code (off until you say yes: the extension asks once, the first time you open the call; never when VS Code telemetry is off) | One empty request a day for a 1-pixel file when the editor starts, and at most one a week for another when you open the call. No identifier, no content | GitHub |
| You say yes to "share usage" in the desktop app, the command line or the Claude Code plugin (off until you say yes: the page asks once, under ⚙; never when the `DO_NOT_TRACK` environment variable is set; ⚙ › All settings turns it off) | At most one empty request a week for a 1-pixel file, when you open the call, one file for each of the three. No identifier, no content | GitHub |
| You say yes to "Tell me when a new version is out" in the desktop app, the command line or the Claude Code plugin (off until you say yes: the page asks once, under ⚙; never when the `DO_NOT_TRACK` or `NO_UPDATE_NOTIFIER` environment variable is set; ⚙ › All settings turns it off) | At most one request a day for the number of the latest version of the app's package. No identifier, no content | The npm registry |
| You install the natural voices | A download of the voice package and its model; no session content | The npm registry and Hugging Face |
| You run the app with `npx`, or the Claude Code plugin does | A download of the app's package; no session content | The npm registry |
| You press "Buy" on a character pack in the ⚙ menu, or install one with a purchase code | To the website: the name of the pack, then the code of the purchase, asked again every few seconds until the payment is done (for a quarter of an hour at most). No session content, and nothing once the pack is installed, unless you press "Update the pack", which asks for it again with the same code. To Stripe: what you type on its payment page, which opens in your browser | agent-standup.com (hosted by Vercel), which asks Stripe whether that purchase is paid and then sends the pack; Stripe, for the payment |
| You choose "Report a problem" in the ⚙ menu, then send the draft that opens on GitHub | The text the app showed you first: its version, your system and browser, your language, and the last errors of the log above; plus what you write. Until you send it on GitHub, nothing is sent | GitHub, as a public issue under your GitHub account |
| You press "Load its libraries" on an artifact shown in the call, or turn on "Artifacts: load their libraries" in the ⚙ menu (off by default) | Each time such a page is shown: requests for the scripts and fonts that page names. No session content: the page runs in a frame that can send nothing out | The servers claude.ai lets an artifact use: cdnjs (Cloudflare), jsDelivr, unpkg, cdn.tailwindcss.com, code.jquery.com and Google Fonts |

Each of these services sees your IP address, as any website does, and applies its own privacy policy.

## The websites

The website at https://agent-standup.com is hosted by Vercel. It sets no cookie and, with the one exception described below (a video from YouTube, when you play it), loads nothing from any other service: its fonts, pictures and videos are served from the site itself. Vercel, as the host, sees your IP address.

Since 13 October 2026 its visits are counted with Vercel Web Analytics, the host's own counter. For each page viewed, Vercel records the page, the page the visit came from, the approximate location (country, region, city), and the kind of browser, system and device. It uses no cookie. According to Vercel, it tells visitors apart with a value computed from the request that is discarded after a day and is not kept as an identifier: https://vercel.com/docs/analytics/privacy-policy. A visit from a browser that sends "Do Not Track" is not counted.

Since 17 October 2026 the website also counts clicks on its buttons and on its links to other sites, with the same Vercel Web Analytics: for each click, the name of the button (for example "Install VS Code" or "Download"), the part of the page it is in (for example the top of the page or the install section) and a short detail (for example "Mac Intel"), along with the same page, location and browser details as for a page view. Nothing you type is sent, and a browser that sends "Do Not Track" is not counted either.

The website is also the shop for the character packs that are sold (https://agent-standup.com/shop/). Paying happens on a page of Stripe, the payment company: your card and your email are typed there and never pass through the app or the website. Stripe emails you a receipt and an invoice, which carry your purchase code. The website keeps no account and no list of buyers. When the app, or the download on the shop, asks for a pack, the website asks Stripe whether the purchase with that code is paid and not refunded, and sends the pack if it is. The shop page and the page you land on after paying set no cookie, load nothing from another site (except the shop's YouTube video once you play it) and are not counted; the latter shows the code from its own address and sends it nowhere. Stripe's privacy policy: https://stripe.com/privacy.

The earlier landing page at https://atoll92.github.io/agent-standup/ is hosted by GitHub Pages. Each visit there loads one tiny image from GitHub, named after where the visit came from (for example "reddit" or "direct"), so the project can count visits by source. It also asks GitHub's public API which release is the latest, to show its version number and download links. It sets no cookie and carries no identifier. GitHub, as the host, sees your IP address.

Both pages show one video from YouTube. Until you press play it is a picture and a link served by the page itself, and nothing is asked of YouTube. When you press play, the player is loaded from YouTube (Google), in the mode YouTube calls privacy-enhanced (youtube-nocookie.com): Google then sees your IP address and that you play this video, may keep data in your browser, and applies its own privacy policy: https://policies.google.com/privacy. The links to the channel open YouTube itself.

## What the developer can see

Only totals that the stores, GitHub and Vercel show: download and install counts, stars, the number of daily and weekly "share usage" requests, visit counts by source, and for the website the number of visits by page, by the page they came from, by country and by kind of browser and device, and how many times each button was clicked. None of it identifies a person.

If you buy a character pack, the developer also sees what Stripe shows a seller about a payment: the email and the name you gave on the payment page, your country, the amount and the date, and the last four digits and the brand of the card. It also sees whether the purchase was started in the app or on the website, and from which link of the website. This is used to answer you about that purchase, to refund it, and for the accounts the law requires, and for nothing else.

## Children

Agent Standup is a tool for developers and is not directed at children.

## Changes

Changes to this page are made in the public repository, where its full history can be read: https://github.com/Atoll92/agent-standup/commits/main/PRIVACY.md

## Contact

Questions or concerns: open an issue at https://github.com/Atoll92/agent-standup/issues
