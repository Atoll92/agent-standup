---
name: credits
description: Add a small credits line to a pull request (or a commit message) saying which agents of this Claude Code session worked on it, named as Agent Standup's call names them (the lead and its sub-agents), with the time worked, the commands and the edits. Use only when the user asks to credit their agents, to add Agent Standup credits, or to say on the PR who built it; never add it on your own.
---

The user asked to credit the agents of this session in a pull request (or a commit). Agent Standup reads the local session file and writes the line; you put it where the user wants it.

## 1. Get the line

Run this from the session that did the work. It reads local session files only, starts no server, sends nothing, and needs Node.js 18 or later.

```bash
npx -y @double_geste/agent-standup@1.46.0 credits --json
```

- It credits the Claude Code session it runs in (`$CLAUDE_CODE_SESSION_ID`). If it says `No session to credit` (an older Claude Code that does not set it), run it again with `--here`: the latest session of the current folder.
- If it says `Unknown command "credits"`, the app version this plugin runs is older than the command: tell the user the credits need a newer version of Agent Standup (update the plugin, or wait for the next version if it is already up to date), and stop.
- The result has `markdown` (the line for GitHub: a small picture of the cast, linked to agent-standup.com, then "Built on an Agent Standup call by Margot, Remy and Iris · 1h12 of work · 48 commands · 12 edits in 9 files"), `text` (the same without HTML, for a commit message or a site that shows no HTML), and the parts: `lead`, `subAgents`, `workMin`, `commands`, `edits`, `filesChanged`.

The names are the ones the user sees in the call, from their own settings. Use the line as it is; do not add the session's title, what it was asked, file names or anything else from the session: a pull request is often public.

## 2. Put it in

- **A pull request you are opening now:** add `markdown` as the last line of its description, after an empty line.
- **An existing pull request:** show the user the line and the PR it goes to, and once they say yes, add it at the end of the description (`gh pr view <n> --json body`, then `gh pr edit <n> --body-file <file>` with the old body and the line). Change nothing else in the description.
- **A commit message:** add `text` as the last paragraph, before any `Co-Authored-By` lines.
- If the description is in another language, you may translate the words of the line ("Built on an Agent Standup call by", "of work", "commands", "edits", "files"); keep the names, numbers, picture and link as they are.

If the user wants it on every pull request from now on, offer to add one line to their `CLAUDE.md` (the project's, or `~/.claude/CLAUDE.md` for all): "When you open a pull request, end its description with the line from `npx -y @double_geste/agent-standup@1.46.0 credits`." Add it only if they say yes.

## 3. Tell the user

One sentence: where the line went, and the line itself.
