# Agent Standup band

![Agent Standup](.claude-plugin/icon.png)

A line above your Claude Code prompt when another Claude Code session on this computer needs you:

    ✋ web-shop (VS Code) needs an approval
    Agent Standup · /agent-standup:open shows them all   Hide

and a short toast when one starts waiting for you, or finishes its turn. You stay in the session you are working in, and still know when another one is stuck on a question or an approval.

It is a mod: a plugin of Claude Code's function hooks. It draws in the terminal and in the Claude desktop app's Code tab. In VS Code, the [Agent Standup extension](https://marketplace.visualstudio.com/items?itemName=DoubleGeste.agent-standup) shows the same in its status bar.

## Install

In Claude Code 2.1.294 or later:

    /plugin install agent-standup-band --marketplace Atoll92/agent-standup

With an earlier version it loads and does nothing: those versions do not run mods (and before 2.1.221 in the terminal, 2.1.269 elsewhere, they do not write the status it reads either).

To see every session as a live team call, install the main plugin too: `/plugin install agent-standup --marketplace Atoll92/agent-standup`, then `/agent-standup:open`.

## What it reads and runs

- Every 4 seconds, the status file Claude Code keeps for each open session, in `~/.claude/sessions/<pid>.json` (or under `CLAUDE_CONFIG_DIR`): which session, its folder, and whether it is busy, idle or waiting for you. Not the conversations. A session started by a program with `claude -p` is left out: its questions go to that program. An Agent SDK app (Zed, a home-made app) is kept, since it may show its menus to a person.
- `ps`, to check that a session said to be waiting still runs: a session that crashed leaves its file behind.

It writes nothing and sends nothing anywhere.

## More

Source and issues: https://github.com/Atoll92/agent-standup. Unofficial: not affiliated with or endorsed by Anthropic. MIT licensed.
