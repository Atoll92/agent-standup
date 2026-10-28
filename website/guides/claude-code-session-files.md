# What Claude Code writes to disk while it works

I wanted three answers about my coding agents without switching tabs all day: is it done, is it stuck, is it waiting for me? Claude Code doesn't offer an API for that, but it doesn't need one: it already writes everything it does to disk, as it goes. These are my notes from reading those files for a few months, for anyone who wants to build on them. Everything below was checked on real sessions, from Claude Code 2.1.59 to 2.1.310. None of it is a documented interface, so expect it to move.

## The transcript: one JSON line per event

Every session is a file:

```
~/.claude/projects/<folder>/<session-id>.jsonl
```

`<folder>` is the directory the session was started in, with every character that is not a letter or a digit turned into `-`. So `/Users/you/my.app` becomes `-Users-you-my-app`. If you set `CLAUDE_CONFIG_DIR`, the whole tree moves there.

The file is append-only: one JSON object per line, written while the session runs. Most lines are `user` or `assistant` records with a `timestamp`, the `cwd` and a `message` whose `content` is a list of blocks: `text`, `tool_use` (the model calls a tool) and `tool_result` (the answer, carried by a `user` record). Each record also says what started the session in `entrypoint`: `cli` for a terminal, `claude-vscode` for the VS Code panel, `claude-desktop` for the desktop app, `sdk-cli` for `claude -p` and programs built on the Agent SDK.

Three things in there are worth knowing.

- **How a turn ends.** Recent versions put a `stop_reason` on each assistant message: `tool_use` when the model is about to call a tool, `end_turn` when it hands the conversation back to you. That one field is the cleanest "is it done?" signal there is. Older versions (2.1.59 still does) write the sentence before a tool call with no `stop_reason` at all, so code that reads transcripts has to cope with it missing.
- **What Claude Code noted about a call.** The `user` record that carries a `tool_result` often has a `toolUseResult` field next to it: Claude Code's own structured note about the call. For an `Edit` or a `Write` it holds `structuredPatch`, the hunks of the change. It's richer than the text the model sees, and it's how you can show the actual diff an agent applied.
- **The task list.** The model's to-do list is the input of its `TodoWrite` calls: an array of items with their content and status (pending, in progress, completed). Read the latest one and you have the plan and how far along it is.

When the conversation gets compacted, a `system` record with `subtype: "compact_boundary"` marks the spot, and the summary that follows comes as a `user` record flagged `isCompactSummary: true`. It looks like a message from you, but it isn't one. Records flagged `isMeta` aren't yours either.

## Sub-agents get files of their own

A sub-agent's transcript isn't in the main file. It sits in a folder named after the session, next to it:

```
~/.claude/projects/<folder>/<session-id>/subagents/agent-<id>.jsonl
~/.claude/projects/<folder>/<session-id>/subagents/agent-<id>.meta.json
```

In recent versions the `.meta.json` says `"finished": true` once the sub-agent is done. Sub-agents launched by a workflow go one level deeper, in `subagents/workflows/<run>/agent-*.jsonl`, and each run also keeps a `journal.jsonl` that is not an agent. Records flagged `isSidechain: true` belong to a sub-agent, not to the lead: skip them when you count the lead's turns.

To know who launched whom, match the lead's `tool_use` calls (the order it gave) with the `tool_result` it got back (the sub-agent's report).

## The live status: ~/.claude/sessions

The transcript tells you what happened. For what's happening right now, Claude Code keeps one small file per running process:

```
~/.claude/sessions/<pid>.json
```

```
{"pid": 89509, "sessionId": "182766f1-…", "cwd": "/Users/you/project",
 "version": "2.1.310", "kind": "interactive", "entrypoint": "claude-vscode",
 "status": "waiting", "waitingFor": "permission prompt",
 "statusUpdatedAt": 1793062190430}
```

`status` is `busy` while the agent works, `idle` at the prompt, and `waiting` while a menu is open. That's your "is it waiting for me?" answer. The terminal has written this file since 2.1.221, and the VS Code panel, the desktop app and the Agent SDK since 2.1.269. Three traps:

- **`waiting` isn't always a question.** `waitingFor` says why: `permission prompt` and `input needed` are real requests, but `dialog open` means the person opened a dialog themselves (`/model`, `/config`, `/resume`…). Treat that one as idle, or every `/model` will look like an agent asking for help.
- **The file outlives its process.** A process that was killed doesn't clean up after itself. Check that the `pid` is still alive before you trust the file.
- **The pending call is often missing from the transcript.** While a menu is open, the tool call behind it may not be written yet. A plan approval (`ExitPlanMode`) is only written once it's answered, and the first question of a session can take a while to show up. The plan itself is already on disk, in `~/.claude/plans/<name>.md`.

## Background commands stream to a temp folder

A command started in the background writes its output live to a file under the system's temp folder, as it runs:

```
<tmp>/claude-<uid>/<folder>/<session-id>/tasks/<id>.output
```

On macOS that's `/tmp/claude-501/…`. Tail it and you can watch a test run or a build that the transcript will only summarize later.

## When there's no transcript

With `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` set, the session writes its status file but no transcript, and says "Transcript saving is off". A session started with an inherited `CLAUDE_CODE_CHILD_SESSION` marker writes neither. So "no transcript" doesn't always mean "no session".

## Codex, for comparison

OpenAI's Codex keeps one "rollout" file per thread, sorted by date: `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`. Its desktop app later compresses threads nobody uses (`.jsonl.zst`), and the thread names live in `~/.codex/session_index.jsonl`. It's a different format, but the same idea: an append-only log you can read without asking the tool anything.

## If you build on these files

- **Read, never write.** These files belong to a running program.
- **Read incrementally.** Remember the byte offset you stopped at, read only what was added since, and keep a half-written last line for the next pass. Re-parsing a 50 MB transcript every second is the fastest way to make your laptop fan spin.
- **Tolerate missing fields.** The `claude` in your terminal can be months older than the one in your editor, and both write to the same folder.
- **Leave out temp folders.** Tests and scripts start throwaway sessions under `/tmp`, and you rarely want them in your view.

| Question | Where the answer is |
|---|---|
| Is it done? | The last assistant message has `stop_reason: "end_turn"`, and the status file says `idle` |
| Is it waiting for me? | The status file says `waiting`, and `waitingFor` isn't `dialog open` |
| Is it stuck? | `busy`, but nothing new in the transcript or the task output for minutes |
| What is it doing? | The last `tool_use` block, its `toolUseResult`, and the latest `TodoWrite` list |
| Which sub-agents are still running? | `subagents/*.meta.json` without `"finished": true` |

## What I built with it

All of this is what [Agent Standup](https://agent-standup.com) reads. It shows every Claude Code, Codex and Mistral Vibe session on your computer as a live video call: each agent is a character on camera, the one working shares its screen (the real command output, diff or test run), and the one that needs you raises its hand. It only reads the files above, so it costs zero tokens and works with sessions started anywhere. It's free and MIT licensed: https://github.com/Atoll92/agent-standup

Try it without installing anything (Node 18 or later): `npx @double_geste/agent-standup@latest --open`
