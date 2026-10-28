# Mistral Vibe session viewer

Mistral Vibe, Mistral's coding agent (the `vibe` command), keeps a full log of every session, but in a form made for the program, not for you. Agent Standup reads those logs and shows each Vibe session as a live call: what you typed, what the agent says, every tool call with its real output, its todo list, and its sub-agents joining the call under the names the lead gave them. Your Vibe sessions show up next to your Claude Code and Codex ones.

## What you can see

- **Every tool call with its real output**, and whether it failed.
- **Files created or changed** and the agent's todo list.
- **Its sub-agents**, each joining the call with the order it was given and the answer it sent back.
- **When Vibe needs you:** a session waiting for your approval or your answer shows as "needs you", because Vibe records it.
- **Its reasoning**, shown as the agent's inner thoughts, and token totals.
- **A board of every session**, Vibe, Claude Code and Codex together.
- **Replay** of any past Vibe session.

## Both of Vibe's formats

Vibe keeps its sessions in `~/.vibe/logs/session` (or under `$VIBE_HOME`), in two formats, and Agent Standup reads both:

- **The current engine** (the default since Vibe 2.26) writes snapshots and a journal for each session, with the time of every event, so the call is exact. A sub-agent leaves no history of its own there: you see what the lead asked it and what it answered.
- **The earlier engine** (`vibe --legacy-harness`, and older versions) writes one message per line with no times, and saves at the end of each step. Here you also see each of a sub-agent's own commands.

Agent Standup never writes in Vibe's folder and makes no model call to show the sessions: zero tokens, and nothing leaves your machine. Checked against real sessions of Vibe 2.26.1.

## Try it

- **In VS Code, Cursor or Windsurf:** search "Agent Standup" in the Extensions view.
- **In a terminal, without installing anything** (Node 18 or later): `npx @double_geste/agent-standup@latest --open`
- **As a desktop app** for macOS, Windows and Linux, from https://agent-standup.com

To leave Vibe out, use the setting `agentStandup.vibe` in VS Code, or `--vibe off` on the command line. If Vibe saves its logs elsewhere (`session_logging.save_dir`), point Agent Standup at that home folder with `--vibe /path/to/vibe-home`.

## Questions

**Does it use my Mistral quota?** No. It only reads files already on your disk.

**Is it open source?** Yes, MIT licensed: https://github.com/Atoll92/agent-standup . Not affiliated with Mistral AI.
