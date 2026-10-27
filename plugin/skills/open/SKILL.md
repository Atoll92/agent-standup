---
name: open
description: Open Agent Standup, a local page that shows the Claude Code, Codex, Mistral Vibe and Cowork sessions on this computer as a live team call (who is working, who waits on whom, who needs the user). Use when the user asks to watch, see or follow their agents, sub-agents or sessions, or asks for the standup or the call.
---

Agent Standup is a small local web server. It reads the session files Claude Code, Codex, Mistral Vibe and Cowork already write on this computer and shows them as a call. By default it sends nothing anywhere, and it never changes those files.

To open it:

1. Check whether it is already running:

   ```bash
   curl -fsS http://localhost:4747/api/health
   ```

   If this prints JSON, it is running. Skip to step 3.

2. Start it in the background, so it keeps running while the user works. It needs Node.js 18 or later.

   ```bash
   AGENT_STANDUP_FROM=plugin npx -y @double_geste/agent-standup@1.42.0 --open
   ```

   `AGENT_STANDUP_FROM=plugin` tells the app that the plugin started it (if the user agrees to share usage, the plugin is counted apart). In a Windows terminal outside Bash, leave it out.

   `--open` opens the page in the user's browser. If the command says the port is already in use, another program has port 4747: run it again with `--port 4790` and use that port in the address below.

3. Tell the user the address, `http://localhost:4747`, in one or two sentences: the call follows their most recent session, and the Sessions tab lists every session. If the server was already running, the page may not be open: give the address and offer to open it.

To stop it later, stop the background command.

If you cannot run commands on the user's computer, say so, and give them the command from step 2 to run in a terminal themselves.
