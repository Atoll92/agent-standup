# Agent Standup

![Agent Standup](.claude-plugin/icon.png)

Watch the Claude Code, Codex, Mistral Vibe and Cowork sessions on your computer as a live team call. Each agent is a small character at its desk: the lead gives orders, sub-agents join, share their screen with the real commands and diffs, and report back. You see at a glance who is working, who waits on whom, and who needs you.

This plugin is a thin way in to the [Agent Standup](https://github.com/Atoll92/agent-standup) app. It adds four skills to Claude Code.

## Install

In Claude Code 2.1.275 or later:

    /plugin install agent-standup --marketplace Atoll92/agent-standup

In earlier versions, in two steps:

    /plugin marketplace add Atoll92/agent-standup
    /plugin install agent-standup@double-geste

## Use it

- `/agent-standup:open` starts the app and opens the call in your browser at `http://localhost:4747`. You can also ask Claude to "open the standup" or "show me my agents".
- `/agent-standup:status` prints one line: how many sessions are working, how many need you, and whether it is your turn, or whether a session stopped on Claude's usage limit (with when it resets) or because Claude Code is logged out. You can also ask "is anything waiting for me?".
- `/agent-standup:whiteboard` draws the day's standup on a Claude Whiteboard: one section per session, with what it was asked, what it did and what it waits on, and what needs you standing out. You can also ask "put today's standup on a whiteboard".
- `/agent-standup:timesheet` fills a Claude Sheet with one row per session: start, end, project, time worked, time it waited for you, turns, commands, edits and files changed, with totals. You can also ask "make me a timesheet of my agents for this week".

The whiteboard and the timesheet are artifacts on claude.ai: they need Claude Code signed in to claude.ai on a paid plan, and are private until you share them.

It needs Node.js 18 or later and works where Claude Code runs on your own computer. In a chat on claude.ai there is no computer to run it on, so Claude will give you the command to run yourself.

## A line above your prompt (optional)

A second plugin, `agent-standup-band`, tells you inside Claude Code when another session needs you: a line above the prompt ("✋ web-shop (VS Code) needs an approval") and a toast when one starts waiting or finishes its turn. It reads only the status Claude Code keeps for each open session, needs no Node.js and sends nothing. In Claude Code 2.1.294 or later:

    /plugin install agent-standup-band --marketplace Atoll92/agent-standup

## What it runs

Every skill runs one command, pinned to an exact version of the app's npm package:

    npx -y @double_geste/agent-standup@1.46.0

`npx` downloads that package from the npm registry the first time. The package has no dependencies. `open` starts a web server that listens on your own machine only (`127.0.0.1`); `status` and `report` (which the whiteboard and the timesheet read) start nothing and exit.

## Data

The app reads the session files Claude Code writes in `~/.claude/projects` (and the status it keeps for each open session in `~/.claude/sessions`, and, while a command runs in the background, what it writes in Claude Code's temporary folder; the same in each `~/.claude-<name>` folder of another Claude account), the ones Codex writes in `~/.codex/sessions`, the ones Mistral Vibe writes in `~/.vibe/logs/session`, and those of Cowork (a tab of the Claude desktop app) in that app’s own folder. It never writes to them. By default it sends nothing anywhere: the page is served from your machine (`127.0.0.1`) to your browser. A click on a session that needs you looks at the list of running programs to open that session where it runs: a local link, or its terminal or Claude app brought to the front.

On your machine it keeps your settings in one small file, the list of sessions you put away as done, a log of its own errors, a character pack if you buy one, and, when voices are on, the spoken lines as sound files in a private folder, deleted after a day.

Only these can leave your computer, each when you turn it on or start it yourself. The plugin turns none of them on.

- **Whiteboard and timesheet:** when you ask for one, Claude puts on it what the day's report says of your sessions (their projects and titles, times and counts, and for the whiteboard a short summary of what each was asked and did, with file names), and creates it on claude.ai with your own Claude account. To do so Claude reads the day's report in your conversation, as it reads any command's output: for each session, its title, your first message of the day and the agent's last words. Nothing is sent until you ask, and only that one board or sheet.

- **Translation and jokes:** with the interface in French, Spanish or Brazilian Portuguese (translation is on for those languages, and can be switched off for the last two), or with the jokes turned on, short lines of the session go to Anthropic through your own Claude Code login, or your own API key if you set one.
- **Office radio:** a request for the audio stream, to Radio France.
- **Natural voices:** installing them downloads a voice package from the npm registry and its model from Hugging Face.
- **Character packs:** pressing "Buy" asks agent-standup.com for a payment page (the payment happens on Stripe), then for the pack. No session content.
- **Report a problem:** opens a draft issue on GitHub with the app’s version, your system, browser and language, and its last errors. Nothing is sent unless you submit it on GitHub yourself.
- **Artifact libraries:** when you ask for them, an artifact shown in the call loads the scripts and fonts it names from the servers claude.ai lets artifacts use. The page runs in a frame that cannot send anything out.

- **Usage count:** the page asks once whether you would help count how many people use it. If you say yes, it loads an empty 1-pixel file from GitHub at most once a week, when you open the call: no identifier, nothing about you or your sessions. It is never asked, and nothing is sent, when the `DO_NOT_TRACK` environment variable is set; ⚙ › All settings turns it off.
- **New versions:** the page also asks once whether to tell you when a new version is out. If you say yes, it asks the npm registry for the latest version number at most once a day, and shows how to update the plugin when there is one. Never asked, and nothing sent, with `DO_NOT_TRACK` or `NO_UPDATE_NOTIFIER` set; ⚙ › All settings turns it off.

Running the app with `npx` downloads its package from the npm registry.

## Privacy

[Privacy policy](https://github.com/Atoll92/agent-standup/blob/main/PRIVACY.md): what the app reads, what it keeps on your computer, and the few optional features that contact another service.

## More

The app also exists as a VS Code extension and a desktop app. Source, documentation and issues: https://github.com/Atoll92/agent-standup

Unofficial: not affiliated with or endorsed by Anthropic, OpenAI or Mistral AI. MIT licensed.
