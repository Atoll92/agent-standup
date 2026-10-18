# Codex session viewer

Codex, both the desktop app and the `codex` command line, records every thread on your computer, but those records are long JSON files that are hard to read. Agent Standup reads them and plays each Codex session as a live call: what you typed, what the agent says, each command with its real output, and the files it changes. Your Codex sessions show up next to your Claude Code and Mistral Vibe ones.

## What you can see

- **What you typed and what the agent says**, as the session happens.
- **Every command with its real output**, and whether it failed.
- **Files created or changed**, web searches, MCP calls and the questions Codex asks you.
- **Its reasoning summaries**, shown as the agent's inner thoughts.
- **Token counts** and the end of each turn.
- **A board of every session**, Codex, Claude Code and Mistral Vibe together, with the ones that need you first.
- **Replay** of any past Codex session, with a recap.

## How it works

Codex writes one "rollout" file per thread in `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl` (or under `$CODEX_HOME`), and the names of threads in `session_index.jsonl`. Agent Standup reads those files and nothing else in the Codex folder. It never writes there and makes no model call to show them: zero tokens, and nothing leaves your machine.

A command appears in the call once it has finished, because that is when Codex writes it down. The short automatic reviews Codex runs before some commands are not shown as sessions. Codex sub-agents are not shown yet: a Codex session appears as the lead and you.

## Try it

- **In VS Code, Cursor or Windsurf:** search "Agent Standup" in the Extensions view.
- **In a terminal, without installing anything** (Node 18 or later): `npx @double_geste/agent-standup --open`
- **As a desktop app** for macOS, Windows and Linux, from https://agent-standup.com

To leave Codex out, use the setting `agentStandup.codex` in VS Code, or `--codex off` on the command line. To read Codex sessions from another folder: `--codex /path/to/codex-home`.

## Questions

**Does it work with the Codex desktop app?** Yes. The desktop app and the command line write the same files.

**Does it use my OpenAI quota?** No. It only reads files already on your disk.

**Is it open source?** Yes, MIT licensed: https://github.com/Atoll92/agent-standup . Not affiliated with OpenAI.
