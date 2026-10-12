// Turns one Claude Code transcript record into events. The incremental reader (reader.js) calls parseRecord for every new line of a file.
//
// The events and signals pushed to state.raw are the raw material of the timeline (see timeline.js); core/models says what each kind is.
// An event's `k` is its key in the live feed (see feed.js).
const { blocks, clip, toolLabel, resultText, resultImages, RESULT_MAX, NO_RESULT, HARNESS } = require('../../transcript');
const { Say, ToolCall, AgentCall, AgentDone, Results, UserMessage, Compact, WorkflowRun, WorkflowDone } = require('../../models');

// What the harness writes into a "user" message that the human did not type.
const NOT_TYPED = /^<(system-reminder|command-|local-command|task-notification)/;
const INTERRUPT = /^\s*\[Request interrupted[^\]]*\]/i;
const INTERRUPT_PREFIX = /^\s*\[Request interrupted[^\]]*\]\s*/i;
const ASYNC_LAUNCH = /^\s*Async agent launched/i;

const isSubAgentCall = (name) => name === 'Agent' || name === 'Task';

function parseRecord(state, record) {
  const ctx = {
    state,
    record,
    agentId: state.agent,
    timestamp: Date.parse(record.timestamp) || 0,
    // The key = whose file + the event's rank in it. A file is only ever appended to, so the rank never changes
    // (and when it does, the whole file is read again under a new number, see reader.js).
    push(event) { event.key = state.agent + ':' + state.raw.length; state.raw.push(event); return event; },
  };
  if (ctx.timestamp > (state.lastTs || 0)) state.lastTs = ctx.timestamp;

  if (state.journal) return readJournalRecord(ctx);
  if (record.type === 'system' && record.subtype === 'compact_boundary') return readCompaction(ctx);
  if (isTaskNotification(record)) return readTaskNotification(ctx);
  if (record.type === 'attachment' && record.attachment && record.attachment.type === 'queued_command') return readQueuedCommand(ctx);
  if (record.type === 'user') return readUserRecord(ctx);
  if (record.type === 'assistant') return readAssistantRecord(ctx);
}

// A workflow's journal: one line when an agent starts, one when it hands its result back (no time on them).
function readJournalRecord({ record, agentId, push }) {
  if (record.type === 'result' && record.agentId) push(new WorkflowDone({ agentId, childId: String(record.agentId).replace(/[^\w.-]/g, '_') }));
}

function readCompaction({ timestamp, agentId, push }) {
  push(new Compact({ timestamp, agentId }));
}

// How Claude Code reports that a background sub-agent has stopped.
const isTaskNotification = (record) => record.type === 'queue-operation' && typeof record.content === 'string' && record.content.includes('<task-notification>');

function readTaskNotification({ record, timestamp, agentId, push }) {
  const toolId = (record.content.match(/<tool-use-id>([^<]+)<\/tool-use-id>/) || [])[1];
  const status = (record.content.match(/<status>([^<]+)<\/status>/) || [])[1];
  if (toolId && status && status !== 'running') push(new AgentDone({ timestamp, agentId, callId: toolId }));
}

// An order typed while the lead was working: Claude Code hands it over in the middle of the turn, as an attachment and not as a user message.
function readQueuedCommand({ state, record, timestamp, agentId, push }) {
  const queued = record.attachment;
  const typedByHuman = queued.origin ? queued.origin.kind === 'human' : queued.commandMode === 'prompt';
  if (agentId !== 'main' || !typedByHuman) return;   // the same record also carries task notifications

  const prompt = queued.prompt;
  const text = (Array.isArray(prompt) ? prompt.filter((block) => block && block.type === 'text').map((block) => block.text).join('\n') : typeof prompt === 'string' ? prompt : '')
    .replace(HARNESS, '').trim();
  if (!text || NOT_TYPED.test(text)) return;

  // Its place in the call is when the lead got it, not when it was typed (minutes earlier, during a long command):
  // the call hears of it only now, and a line dated in the past looks "far behind" and was shown without a voice.
  push(new UserMessage({ timestamp: Math.max(timestamp, state.lastTs || 0), text }));
}

// A "user" record carries tool results (the real output that appeared on an agent's screen) and what the human typed.
function readUserRecord(ctx) {
  const { state, record, timestamp, agentId, push } = ctx;
  const toolResults = blocks(record).filter((block) => block.type === 'tool_result');
  const toolName = (toolResult) => state.toolName[toolResult.tool_use_id];

  // The answer to a Workflow call names the run it started: its agents are in subagents/workflows/<run>/
  const run = record.toolUseResult && typeof record.toolUseResult === 'object' && typeof record.toolUseResult.runId === 'string' ? record.toolUseResult.runId : '';
  if (run) for (const toolResult of toolResults) push(new WorkflowRun({ timestamp, agentId, callId: toolResult.tool_use_id, run }));

  // A synchronous sub-agent call: the lead got the sub-agent's answer back, so it has finished
  // (async launches answer immediately and are not a completion).
  for (const toolResult of toolResults) {
    const background = state.bg && state.bg[toolResult.tool_use_id];
    if (isSubAgentCall(toolName(toolResult)) && !background && !ASYNC_LAUNCH.test(resultText(toolResult.content))) push(new AgentDone({ timestamp, agentId, callId: toolResult.tool_use_id }));
  }

  const items = [];
  for (const toolResult of toolResults) {
    const name = toolName(toolResult);
    if (!name || NO_RESULT.has(name)) continue;
    const pictures = resultImages(toolResult.content).length;   // how many came back; they are served from the transcript, not stored in the event
    const output = clip(resultText(toolResult.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trimEnd(), RESULT_MAX[name] || (/^mcp__/.test(name) ? 900 : 600));
    items.push({ callId: toolResult.tool_use_id, failed: !!toolResult.is_error, output, pictures });
  }
  if (items.length) push(new Results({ timestamp, agentId, items }));

  // What the human typed, without the blocks the harness wraps around it.
  const typed = blocks(record).filter((block) => block.type === 'text').map((block) => block.text).join('\n').replace(HARNESS, '');
  if (agentId !== 'main') return rememberSubAgentOrder(ctx, typed);

  // Esc: the turn stops there, without the end_turn mark. The last thing the lead said or did closes it.
  if (INTERRUPT.test(typed) && state.act >= 0) state.raw[state.act].endTurn();

  const text = typed.replace(INTERRUPT_PREFIX, '').trim();
  // A compaction summary is not typed either: thousands of characters the human never wrote.
  if (text && !NOT_TYPED.test(text) && !record.isMeta && !record.isCompactSummary) push(new UserMessage({ timestamp, text }));
}

// A sub-agent's first user message is the order, emitted from the parent's side. It is kept here for the agents
// of a workflow, whose order is in no other file.
function rememberSubAgentOrder({ state, timestamp }, typed) {
  if (!state.prompt && typed.trim() && !state.raw.length) state.prompt = { timestamp, text: typed.trim() };
}

function readAssistantRecord(ctx) {
  const { state, record, timestamp, agentId, push } = ctx;
  const message = record.message || {};
  if (message.id && message.usage) recordUsage(state, message, timestamp);

  let said = null;   // the last thing this record said
  for (const block of blocks(record)) {
    if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
      rememberThought(state, block.thinking);
    } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      said = push(new Say({ timestamp, agentId, text: block.text.trim(), thought: takeThought(state) }));
      state.act = state.raw.length - 1; state.sayOf = message.id; state.sayAt = state.act;
    } else if (block.type === 'tool_use') {
      readToolUse(ctx, block);
    }
  }

  // The lead's turn is over. Claude Code writes one record per content block, each with the message's stop reason,
  // so the mark goes on the line this record carries (a thinking block carries none)...
  if (agentId === 'main' && message.stop_reason === 'end_turn') {
    // ...or on the line the same message brought in an earlier record.
    if (!said && message.id && state.sayOf === message.id) said = state.raw[state.sayAt];
    if (said) said.endTurn();
  }
}

// The same message is repeated once per content block with identical numbers: keep one per message id.
function recordUsage(state, message, timestamp) {
  const usage = message.usage, prev = state.msgUsage.get(message.id);
  state.msgUsage.set(message.id, {
    timestamp: prev ? prev.timestamp : timestamp,
    tokens: { input: usage.input_tokens || 0, output: usage.output_tokens || 0, cacheReads: usage.cache_read_input_tokens || 0, cacheWrites: usage.cache_creation_input_tokens || 0 },
    model: message.model,
  });
}

// What an agent was thinking before a line or a call, when Claude Code kept it (most of the time it only keeps a signature).
// The next line or call shows it as an inner thought. Line breaks are kept: each line of the notes is a thought of its own.
function rememberThought(state, thinking) {
  state.pendingThought = clip(thinking.replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\n ]*/g, '\n').trim(), 900);
}
function takeThought(state) {
  const thought = state.pendingThought; state.pendingThought = '';
  return thought;
}

function readToolUse({ state, timestamp, agentId, push }, toolUse) {
  state.toolName[toolUse.id] = toolUse.name;
  const input = toolUse.input || {};
  if (input.run_in_background) (state.bg = state.bg || {})[toolUse.id] = true;

  if (isSubAgentCall(toolUse.name)) {
    push(new AgentCall({ timestamp, agentId, callId: toolUse.id, background: !!input.run_in_background, text: input.prompt || '', title: input.description || '' }));
  } else {
    push(new ToolCall({ timestamp, agentId, tool: toolLabel(toolUse, timestamp), thought: takeThought(state) }));
    state.act = state.raw.length - 1;
  }
}

module.exports = { parseRecord };
