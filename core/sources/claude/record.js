// Turns one Claude Code transcript record into events. The incremental reader (reader.js) calls parseRecord for every new line of a file.
//
// The events pushed to st.raw are the raw material of the timeline (see timeline.js):
//   say        { text, th?, end? }                what an agent says; end: it closed the lead's turn
//   tool       { tool, th? }                      a tool call (tool = what transcript.toolLabel makes of it)
//   agentcall  { toolId, bg, text, title }        the lead launching a sub-agent (Agent / Task tool)
//   agentdone  { toolId }                         a sub-agent has finished
//   results    { items: [{ id, err, out, img? }] } what tool calls returned
//   user       { text }                           what the human typed
//   compact    {}                                 Claude Code compacted the conversation
//   wfrun      { toolId, run }                    a Workflow call named the run it started
//   wfdone     { child }                          a workflow journal says an agent handed its result back
// Every event also has { ts, agent, k }: k is its key in the live feed (see feed.js).
const { blocks, clip, toolLabel, resultText, resultImages, RESULT_MAX, NO_RESULT, HARNESS } = require('../../transcript');

// What the harness writes into a "user" message that the human did not type.
const NOT_TYPED = /^<(system-reminder|command-|local-command|task-notification)/;
const INTERRUPT = /^\s*\[Request interrupted[^\]]*\]/i;
const INTERRUPT_PREFIX = /^\s*\[Request interrupted[^\]]*\]\s*/i;
const ASYNC_LAUNCH = /^\s*Async agent launched/i;

const isSubAgentCall = (name) => name === 'Agent' || name === 'Task';

function parseRecord(st, r) {
  const ctx = {
    st,
    r,
    agent: st.agent,
    ts: Date.parse(r.timestamp) || 0,
    // k = whose file + the event's rank in it. A file is only ever appended to, so the rank never changes
    // (and when it does, the whole file is read again under a new number, see reader.js).
    push(e) { e.k = st.agent + ':' + st.raw.length; st.raw.push(e); return e; },
  };
  if (ctx.ts > (st.lastTs || 0)) st.lastTs = ctx.ts;

  if (st.journal) return readJournalRecord(ctx);
  if (r.type === 'system' && r.subtype === 'compact_boundary') return readCompaction(ctx);
  if (isTaskNotification(r)) return readTaskNotification(ctx);
  if (r.type === 'attachment' && r.attachment && r.attachment.type === 'queued_command') return readQueuedCommand(ctx);
  if (r.type === 'user') return readUserRecord(ctx);
  if (r.type === 'assistant') return readAssistantRecord(ctx);
}

// A workflow's journal: one line when an agent starts, one when it hands its result back (no time on them).
function readJournalRecord({ r, agent, push }) {
  if (r.type === 'result' && r.agentId) push({ ts: 0, agent, kind: 'wfdone', child: String(r.agentId).replace(/[^\w.-]/g, '_') });
}

function readCompaction({ ts, agent, push }) {
  push({ ts, agent, kind: 'compact' });
}

// How Claude Code reports that a background sub-agent has stopped.
const isTaskNotification = (r) => r.type === 'queue-operation' && typeof r.content === 'string' && r.content.includes('<task-notification>');

function readTaskNotification({ r, ts, agent, push }) {
  const toolId = (r.content.match(/<tool-use-id>([^<]+)<\/tool-use-id>/) || [])[1];
  const status = (r.content.match(/<status>([^<]+)<\/status>/) || [])[1];
  if (toolId && status && status !== 'running') push({ ts, agent, kind: 'agentdone', toolId });
}

// An order typed while the lead was working: Claude Code hands it over in the middle of the turn, as an attachment and not as a user message.
function readQueuedCommand({ st, r, ts, agent, push }) {
  const queued = r.attachment;
  const typedByHuman = queued.origin ? queued.origin.kind === 'human' : queued.commandMode === 'prompt';
  if (agent !== 'main' || !typedByHuman) return;   // the same record also carries task notifications

  const prompt = queued.prompt;
  const text = (Array.isArray(prompt) ? prompt.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : typeof prompt === 'string' ? prompt : '')
    .replace(HARNESS, '').trim();
  if (!text || NOT_TYPED.test(text)) return;

  // Its place in the call is when the lead got it, not when it was typed (minutes earlier, during a long command):
  // the call hears of it only now, and a line dated in the past looks "far behind" and was shown without a voice.
  push({ ts: Math.max(ts, st.lastTs || 0), agent: 'user', kind: 'user', text });
}

// A "user" record carries tool results (the real output that appeared on an agent's screen) and what the human typed.
function readUserRecord(ctx) {
  const { st, r, ts, agent, push } = ctx;
  const toolResults = blocks(r).filter((b) => b.type === 'tool_result');
  const toolName = (b) => st.toolName[b.tool_use_id];

  // The answer to a Workflow call names the run it started: its agents are in subagents/workflows/<run>/
  const run = r.toolUseResult && typeof r.toolUseResult === 'object' && typeof r.toolUseResult.runId === 'string' ? r.toolUseResult.runId : '';
  if (run) for (const b of toolResults) push({ ts, agent, kind: 'wfrun', toolId: b.tool_use_id, run });

  // A synchronous sub-agent call: the lead got the sub-agent's answer back, so it has finished
  // (async launches answer immediately and are not a completion).
  for (const b of toolResults) {
    const background = st.bg && st.bg[b.tool_use_id];
    if (isSubAgentCall(toolName(b)) && !background && !ASYNC_LAUNCH.test(resultText(b.content))) push({ ts, agent, kind: 'agentdone', toolId: b.tool_use_id });
  }

  const items = [];
  for (const b of toolResults) {
    const name = toolName(b);
    if (!name || NO_RESULT.has(name)) continue;
    const img = resultImages(b.content).length;   // how many pictures came back; they are served from the transcript, not stored in the event
    const out = clip(resultText(b.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trimEnd(), RESULT_MAX[name] || (/^mcp__/.test(name) ? 900 : 600));
    items.push({ id: b.tool_use_id, err: !!b.is_error, out, ...(img ? { img } : {}) });
  }
  if (items.length) push({ ts, agent, kind: 'results', items });

  // What the human typed, without the blocks the harness wraps around it.
  const typed = blocks(r).filter((b) => b.type === 'text').map((b) => b.text).join('\n').replace(HARNESS, '');
  if (agent !== 'main') return rememberSubAgentOrder(ctx, typed);

  // Esc: the turn stops there, without the end_turn mark. The last thing the lead said or did closes it.
  if (INTERRUPT.test(typed) && st.act >= 0) st.raw[st.act].end = 1;

  const text = typed.replace(INTERRUPT_PREFIX, '').trim();
  // A compaction summary is not typed either: thousands of characters the human never wrote.
  if (text && !NOT_TYPED.test(text) && !r.isMeta && !r.isCompactSummary) push({ ts, agent: 'user', kind: 'user', text });
}

// A sub-agent's first user message is the order, emitted from the parent's side. It is kept here for the agents
// of a workflow, whose order is in no other file.
function rememberSubAgentOrder({ st, ts }, typed) {
  if (!st.prompt && typed.trim() && !st.raw.length) st.prompt = { ts, text: typed.trim() };
}

function readAssistantRecord(ctx) {
  const { st, r, ts, agent, push } = ctx;
  const message = r.message || {};
  if (message.id && message.usage) recordUsage(st, message, ts);

  let said = null;   // the last thing this record said
  for (const b of blocks(r)) {
    if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) {
      rememberThought(st, b.thinking);
    } else if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      said = push({ ts, agent, kind: 'say', text: b.text.trim(), ...takeThought(st) });
      st.act = st.raw.length - 1; st.sayOf = message.id; st.sayAt = st.act;
    } else if (b.type === 'tool_use') {
      readToolUse(ctx, b);
    }
  }

  // The lead's turn is over. Claude Code writes one record per content block, each with the message's stop reason,
  // so the mark goes on the line this record carries (a thinking block carries none)...
  if (agent === 'main' && message.stop_reason === 'end_turn') {
    // ...or on the line the same message brought in an earlier record.
    if (!said && message.id && st.sayOf === message.id) said = st.raw[st.sayAt];
    if (said) said.end = 1;
  }
}

// The same message is repeated once per content block with identical numbers: keep one per message id.
function recordUsage(st, message, ts) {
  const u = message.usage, prev = st.msgUsage.get(message.id);
  st.msgUsage.set(message.id, {
    ts: prev ? prev.ts : ts,
    u: { i: u.input_tokens || 0, o: u.output_tokens || 0, r: u.cache_read_input_tokens || 0, w: u.cache_creation_input_tokens || 0 },
    model: message.model,
  });
}

// What an agent was thinking before a line or a call, when Claude Code kept it (most of the time it only keeps a signature).
// The next line or call shows it as an inner thought. Line breaks are kept: each line of the notes is a thought of its own.
function rememberThought(st, thinking) {
  st.th = clip(thinking.replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\n ]*/g, '\n').trim(), 900);
}
function takeThought(st) {
  const th = st.th; st.th = '';
  return th ? { th } : {};
}

function readToolUse({ st, ts, agent, push }, b) {
  st.toolName[b.id] = b.name;
  const input = b.input || {};
  if (input.run_in_background) (st.bg = st.bg || {})[b.id] = true;

  if (isSubAgentCall(b.name)) {
    push({ ts, agent, kind: 'agentcall', toolId: b.id, bg: !!input.run_in_background, text: input.prompt || '', title: input.description || '' });
  } else {
    push({ ts, agent, kind: 'tool', tool: toolLabel(b, ts), ...takeThought(st) });
    st.act = st.raw.length - 1;
  }
}

module.exports = { parseRecord };
