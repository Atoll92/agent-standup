# Agent Standup

Know when one of your coding agents needs you, without checking every terminal and editor window.

- **Agents in Menu Bar** shows `✋ 2` when two sessions wait for your approval or answer, `⚙ 3` while three are working, and `✓` when it is your turn. Its menu lists each session with its project, what it asks, and for how long. Click one to open it in the call.
- **Agent Sessions** lists the sessions on this Mac, grouped into needs you, your turn, working and idle, with their sub-agents.
- **Open the Standup** opens [Agent Standup](https://agent-standup.com): your sessions as a live video call, where each agent and sub-agent is a character who talks through what it is doing.

It covers Claude Code (terminal, VS Code, the desktop app), Codex, Mistral Vibe and Cowork.

## Requirements

Node.js 18 or later. The extension runs Agent Standup's command line with `npx -y @double_geste/agent-standup`, which npm downloads the first time. If Node.js is installed somewhere unusual, set **npx Path** in the extension's preferences.

## Privacy

Agent Standup reads only the session files those tools already write on your Mac (`~/.claude`, `~/.codex`, `~/.vibe`, and the desktop app's folder). It never writes to them, and the extension sends nothing anywhere. **Open the Standup** starts the call on your own machine (`localhost:4747`) when it is not already running in VS Code, the desktop app or a terminal.

Turn off **Session Titles** in the preferences to show only projects, states and counts.

Agent Standup is open source (MIT): https://github.com/Atoll92/agent-standup
