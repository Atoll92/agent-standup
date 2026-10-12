# Agent Standup

Watch the Claude Code, Codex and Mistral Vibe sessions on your computer as a live team call. Each agent is a small character at its desk: the lead gives orders, sub-agents join, share their screen with the real commands and diffs, and report back. You see at a glance who is working, who waits on whom, and who needs you.

This plugin is a thin way in to the [Agent Standup](https://github.com/Atoll92/agent-standup) app. It adds two skills to Claude Code.

## Install

In Claude Code 2.1.275 or later:

    /plugin install agent-standup --marketplace Atoll92/agent-standup

In earlier versions, in two steps:

    /plugin marketplace add Atoll92/agent-standup
    /plugin install agent-standup@double-geste

## Use it

- `/agent-standup:open` starts the app and opens the call in your browser at `http://localhost:4747`. You can also ask Claude to "open the standup" or "show me my agents".
- `/agent-standup:status` prints one line: how many sessions are working, how many need you, and whether it is your turn. You can also ask "is anything waiting for me?".

It needs Node.js 18 or later and works where Claude Code runs on your own computer. In a chat on claude.ai there is no computer to run it on, so Claude will give you the command to run yourself.

## What it runs

Both skills run one command, pinned to an exact version of the app's npm package:

    npx -y @double_geste/agent-standup@1.29.0

`npx` downloads that package from the npm registry the first time. The package has no dependencies. `open` starts a web server that listens on your own machine only (`127.0.0.1`); `status` starts nothing and exits.

## Data

The app reads the session files Claude Code writes in `~/.claude/projects` the ones Codex writes in `~/.codex/sessions` and the ones Mistral Vibe writes in `~/.vibe/logs/session`. It never writes to them. By default it sends nothing anywhere: the page is served from your machine to your browser.

On your machine it keeps your settings in one small file and, when voices are on, the spoken lines as sound files in a private temporary folder, deleted after a day.

Three things in the app's settings call out, all off by default: French translation and jokes (short lines go through your own Claude login), a web radio stream, and a usage counter (one empty request a day). The plugin turns none of them on.

## Privacy

[Privacy policy](https://github.com/Atoll92/agent-standup/blob/main/PRIVACY.md): what the app reads, what it keeps on your computer, and the few optional features that contact another service.

## More

The app also exists as a VS Code extension and a desktop app. Source, documentation and issues: https://github.com/Atoll92/agent-standup

Unofficial: not affiliated with or endorsed by Anthropic, OpenAI or Mistral AI. MIT licensed.
