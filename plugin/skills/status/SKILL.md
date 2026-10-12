---
name: status
description: Report in one line what the Claude Code, Codex and Mistral Vibe sessions on this computer are doing right now (how many are working, how many need the user, whether it is the user's turn). Use when the user asks what their agents or sessions are doing, or whether anything is waiting for them.
---

Run this and report what it prints. It reads local session files only, starts no server, and needs Node.js 18 or later.

```bash
npx -y @double_geste/agent-standup@1.29.0 status
```

- Add `--here` to count only the sessions started in the current folder.
- Add `--json --titles` when the user wants the list: each session with its title, its state (working, waiting, blocked, turn, idle) and how long it has been in that state.

Reading the result:

- "working" counts sessions in the middle of a turn. The session you are running in is one of them.
- "needs you" means an agent is waiting for an approval or an answer.
- "your turn" means the agent has finished and is waiting for the next message.

If you cannot run commands on the user's computer, say so, and give them the command to run in a terminal themselves.
