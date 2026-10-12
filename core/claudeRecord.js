// Turns one Claude Code transcript record into the events of the timeline (say, tool, results, order…). Called by the incremental reader for every new line.
const { blocks, clip, toolLabel, resultText, resultImages, RESULT_MAX, NO_RESULT, HARNESS } = require('./transcript');

function parseRecord(st, r) {
  const agent = st.agent, ts = Date.parse(r.timestamp) || 0, push = (e) => { e.k = agent + ':' + st.raw.length; st.raw.push(e); return e; };   // k: the event's key in the live feed = whose file + its rank in it. A file is only ever appended to, so the rank never changes (and when it is not, the whole file is read again under a new number, see readNew)
  if (ts > (st.lastTs || 0)) st.lastTs = ts;
  if (st.journal) { if (r.type === 'result' && r.agentId) push({ ts: 0, agent, kind: 'wfdone', child: String(r.agentId).replace(/[^\w.-]/g, '_') }); return; }   // a workflow's journal: one line when an agent starts, one when it hands its result back (no time on them)
  if (r.type === 'system' && r.subtype === 'compact_boundary') { push({ ts, agent, kind: 'compact' }); return; }   // Claude Code compacted the conversation
  if (r.type === 'queue-operation' && typeof r.content === 'string' && r.content.includes('<task-notification>')) {   // how Claude Code reports that a background sub-agent has stopped
    const id = (r.content.match(/<tool-use-id>([^<]+)<\/tool-use-id>/) || [])[1], status = (r.content.match(/<status>([^<]+)<\/status>/) || [])[1];
    if (id && status && status !== 'running') push({ ts, agent, kind: 'agentdone', toolId: id });
    return;
  }
  if (r.type === 'attachment' && r.attachment && r.attachment.type === 'queued_command') {   // an order typed while the lead was working: Claude Code hands it over in the middle of the turn, as an attachment and not as a user message
    const q = r.attachment, human = q.origin ? q.origin.kind === 'human' : q.commandMode === 'prompt'; if (agent !== 'main' || !human) return;   // the same record also carries task notifications
    const txt = (Array.isArray(q.prompt) ? q.prompt.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : typeof q.prompt === 'string' ? q.prompt : '').replace(HARNESS, '').trim();
    if (txt && !/^<(system-reminder|command-|local-command|task-notification)/.test(txt)) push({ ts: Math.max(ts, st.lastTs || 0), agent: 'user', kind: 'user', text: txt });   // its place in the call is when the lead got it, not when it was typed (minutes earlier, during a long command): the call hears of it only now, and a line dated in the past looks "far behind" and was shown without a voice
    return;
  }
  if (r.type === 'user') {
    const items = [], wf = r.toolUseResult && typeof r.toolUseResult === 'object' && typeof r.toolUseResult.runId === 'string' ? r.toolUseResult.runId : '';   // tool results: the real output that appeared on the agent's screen
    for (const b of blocks(r)) if (b.type === 'tool_result' && wf) push({ ts, agent, kind: 'wfrun', toolId: b.tool_use_id, run: wf });   // the answer to a Workflow call names the run it started: its agents are in subagents/workflows/<run>/
    for (const b of blocks(r)) if (b.type === 'tool_result' && (st.toolName[b.tool_use_id] === 'Agent' || st.toolName[b.tool_use_id] === 'Task') && !(st.bg && st.bg[b.tool_use_id]) && !/^\s*Async agent launched/i.test(resultText(b.content))) push({ ts, agent, kind: 'agentdone', toolId: b.tool_use_id });   // a synchronous call: the lead got the sub-agent's answer back, so it has finished (async launches answer immediately and are not a completion)
    for (const b of blocks(r)) if (b.type === 'tool_result' && st.toolName[b.tool_use_id] && !NO_RESULT.has(st.toolName[b.tool_use_id])) {
      const n = st.toolName[b.tool_use_id], img = resultImages(b.content).length;
      items.push({ id: b.tool_use_id, err: !!b.is_error, out: clip(resultText(b.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trimEnd(), RESULT_MAX[n] || (/^mcp__/.test(n) ? 900 : 600)), ...(img ? { img } : {}) });   // img: how many pictures came back; the page fetches them from /api/media
    }
    if (items.length) push({ ts, agent, kind: 'results', items });
    const typed = blocks(r).filter((b) => b.type === 'text').map((b) => b.text).join('\n').replace(HARNESS, ''), cut = /^\s*\[Request interrupted[^\]]*\]/i.test(typed);   // what the human typed, without the blocks the harness wraps around it
    if (agent !== 'main') { if (!st.prompt && typed.trim() && !st.raw.length) st.prompt = { ts, text: typed.trim() }; return; }   // a sub-agent's first user message is the order, emitted from the parent's side (kept here for the agents of a workflow, whose order is in no other file)
    if (cut && st.act >= 0) st.raw[st.act].end = 1;   // Esc: the turn stops there, without the end_turn mark. The last thing the lead said or did closes it
    const txt = typed.replace(/^\s*\[Request interrupted[^\]]*\]\s*/i, '').trim();
    if (txt && !/^<(system-reminder|command-|local-command|task-notification)/.test(txt) && !r.isMeta && !r.isCompactSummary) push({ ts, agent: 'user', kind: 'user', text: txt });   // not the summary Claude Code writes when it compacts: thousands of characters the human never typed
  } else if (r.type === 'assistant') {
    const m = r.message || {}; let said = null;
    if (m.id && m.usage) {   // the same message is repeated once per content block with identical numbers: keep one per message id
      const u = m.usage, prev = st.msgUsage.get(m.id);
      st.msgUsage.set(m.id, { ts: prev ? prev.ts : ts, u: { i: u.input_tokens || 0, o: u.output_tokens || 0, r: u.cache_read_input_tokens || 0, w: u.cache_creation_input_tokens || 0 }, model: m.model });
    }
    const th = () => { const t = st.th; st.th = ''; return t ? { th: t } : {}; };   // what the agent was thinking before this line or call, when Claude Code kept it (most of the time it only keeps a signature): the call shows it as an inner thought
    for (const b of blocks(r)) {
      if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) st.th = clip(b.thinking.replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\n ]*/g, '\n').trim(), 900);   // line breaks are kept: each line of its notes is a thought of its own
      else if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) { said = push({ ts, agent, kind: 'say', text: b.text.trim(), ...th() }); st.act = st.raw.length - 1; st.sayOf = m.id; st.sayAt = st.act; }
      else if (b.type === 'tool_use') {
        st.toolName[b.id] = b.name; if (b.input && b.input.run_in_background) (st.bg = st.bg || {})[b.id] = true;
        if (b.name === 'Agent' || b.name === 'Task') push({ ts, agent, kind: 'agentcall', toolId: b.id, bg: !!(b.input && b.input.run_in_background), text: (b.input && b.input.prompt) || '', title: (b.input && b.input.description) || '' });
        else { push({ ts, agent, kind: 'tool', tool: toolLabel(b, ts), ...th() }); st.act = st.raw.length - 1; }
      }
    }
    if (agent === 'main' && m.stop_reason === 'end_turn') {   // the lead's turn is over: Claude Code writes one record per content block, each with the message's stop reason, so the mark goes on the line this record carries (a thinking block carries none)
      if (!said && m.id && st.sayOf === m.id) said = st.raw[st.sayAt];   // ...or on the line the same message brought in an earlier record
      if (said) said.end = 1;
    }
  }
}

module.exports = { parseRecord };
