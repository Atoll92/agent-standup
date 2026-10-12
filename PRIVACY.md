# Privacy

Last updated: 12 October 2026.

This page covers Agent Standup in all its forms (the VS Code extension, the `agent-standup` command, the desktop app, the Claude Code plugin) and its website. Agent Standup is published by Double Geste, an individual developer. It is an unofficial community project, not affiliated with Anthropic or OpenAI.

## The short version

Agent Standup runs on your own computer. It reads files that are already there, shows them to you in a page served from your machine, and by default sends nothing anywhere. There are no accounts, no analytics and no advertising. The developer never receives your sessions, your code or your prompts.

## What it reads

- **Your session files.** The ones Claude Code writes in `~/.claude/projects`, the ones Codex writes in `~/.codex/sessions` and the ones Mistral Vibe writes in `~/.vibe/logs/session`. They hold what you typed, what the agents answered and what they ran, so they can contain personal or confidential information. Agent Standup only reads them. It never changes or deletes them. Reading Codex sessions can be turned off.
- **Your own character images**, if you put some in its characters folder.

## What it keeps on your computer

- **Your settings**, in one small file in your user configuration folder.
- **Spoken lines, for a day.** When voices are on, each line is turned into a sound file in a private temporary folder so it does not have to be made twice. Files older than a day are deleted.
- **The natural voice model**, only if you install it.

Nothing else is written. Uninstalling the app and deleting those folders removes everything.

## What can leave your computer

Nothing by default. The local server listens on `127.0.0.1` only and refuses requests that do not come from your own machine.

The following happen only if you turn them on or start them yourself:

| When | What is sent | To whom |
|---|---|---|
| You choose French, or turn on the jokes | Short lines of the session, to be translated or answered | Anthropic, through your own Claude Code login (or your own API key if you set one) |
| You turn on the office radio | A request for the audio stream; no session content | Radio France |
| You turn on "share usage" in VS Code (off by default, and never when VS Code telemetry is off) | One empty request a day for a 1-pixel file. No identifier, no content | GitHub |
| You install the very natural voices | A download of the voice package and its model; no session content | The npm registry and Hugging Face |
| You run the app with `npx`, or the Claude Code plugin does | A download of the app's package; no session content | The npm registry |

Each of these services sees your IP address, as any website does, and applies its own privacy policy.

## The websites

The website at https://agent-standup.com is hosted by Vercel. It sets no cookie, counts no visit and loads nothing from any other service: its fonts, pictures and videos are served from the site itself. Vercel, as the host, sees your IP address.

The earlier landing page at https://atoll92.github.io/agent-standup/ is hosted by GitHub Pages. Each visit there loads one tiny image from GitHub, named after where the visit came from (for example "reddit" or "direct"), so the project can count visits by source. It also asks GitHub's public API which release is the latest, to show its version number and download links. It sets no cookie and carries no identifier. GitHub, as the host, sees your IP address.

## What the developer can see

Only totals that the stores and GitHub publish: download and install counts, stars, the number of daily "share usage" requests, and visit counts by source. None of it identifies a person.

## Children

Agent Standup is a tool for developers and is not directed at children.

## Changes

Changes to this page are made in the public repository, where its full history can be read: https://github.com/Atoll92/agent-standup/commits/main/PRIVACY.md

## Contact

Questions or concerns: open an issue at https://github.com/Atoll92/agent-standup/issues
