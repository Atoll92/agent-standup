# Claude Code sub-agent monitor

When a Claude Code session hands work to sub-agents, the terminal shows one line per agent and little else. You can't easily tell which sub-agent is still working, which one is waiting on another, which one is stuck on a long command, or which session is sitting on a prompt for you. Agent Standup answers those questions by reading the files Claude Code already writes, and shows every agent of every session as a live call.

## What you can see

- **Who is working, waiting or stuck.** Every agent has one status: working (and on what), waiting on another agent (which one), needs you (a permission or a question is open), or done. A tile is flagged when a command has run for over a minute, or when a working agent has gone quiet for three minutes.
- **The whole sub-agent tree.** You, the lead, its sub-agents and their sub-agents, with the order each one was given and the report it sent back.
- **Tokens per agent.** Input, output, cache writes and cache reads, counted once per message as Claude Code records them, so the expensive sub-agent stands out.
- **The real work.** When an agent works, its screen is shared in the call: the command and its actual output, the file it reads, or the exact diff it applies.
- **Every session at once.** A board of all your Claude Code sessions, sorted by what needs you first.
- **Replay.** Open any past session, scrub through it, see a timeline of who worked when, and get a recap of commands run and files changed.

## How it works, and what it costs

Claude Code writes every session to disk as it goes, in `~/.claude/projects/<folder>/<session>.jsonl`, and each sub-agent in a file of its own next to it. Agent Standup reads those files, and only reads them: it never writes there, needs no hooks and no setup, and makes no call to Claude to show the call. It costs zero tokens and nothing leaves your machine. The only optional features that call a model are the translation of the call into French, Spanish or Brazilian Portuguese and the jokes mode, both through your own Claude login.

## Try it

- **In VS Code or Cursor:** search "Agent Standup" in the Extensions view, then open the call from the Activity Bar.
- **In a terminal, without installing anything** (Node 18 or later): `npx @double_geste/agent-standup --open`. It opens the call in your browser, with a built-in demo if you have no session yet.
- **Inside Claude Code:** the plugin adds `/agent-standup:open` and `/agent-standup:status`.
- **As a desktop app** for macOS, Windows and Linux, from https://agent-standup.com

It also reads Codex and Mistral Vibe sessions, so sessions of all three tools show up side by side.

## Questions

**Does it slow Claude Code down or use my quota?** No. It runs beside Claude Code and only reads its log files, like `tail -f` with a face.

**Does it work with sessions started in a terminal?** Yes. It reads every session in `~/.claude/projects` (or `CLAUDE_CONFIG_DIR`), wherever it was started.

**Is it open source?** Yes, MIT licensed: https://github.com/Atoll92/agent-standup
