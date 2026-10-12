const { typed, partsText } = require('./text');

// ---- one record of a rollout file → the events of the call
// Two generations of the format are read. The current one (2026) writes an "item_completed" line for everything that happened: what was typed, what the agent said,
// each command with its output, each file it changed, each search. The earlier one wrote the messages as "user_message" / "agent_message" events and the tool calls as
// raw "function_call" records. A file of the current kind also carries those raw records (the script the model wrote around its commands), which would say everything twice:
// once the first item is seen, the raw tool calls are left alone.
function parser({ toolLabel, clip, resultMax = {} }) {
  const shellText = (command) => (Array.isArray(command) ? (command.length === 3 && /^-l?c$/.test(command[1]) ? command[2] : command.join(' ')) : String(command == null ? '' : command));
  const diffSides = (diff) => { const add = [], del = []; for (const line of String(diff || '').split('\n')) { if (/^(\+\+\+ |--- |@@|diff |index |\*\*\* )/.test(line)) continue; if (line[0] === '+') add.push(line.slice(1)); else if (line[0] === '-') del.push(line.slice(1)); } return { add: add.join('\n'), del: del.join('\n') }; };
  const patchFiles = (text) => {   // the "*** Update File: x" blocks of an apply_patch call
    const out = []; let cur = null;
    for (const line of String(text || '').split('\n')) { const match = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line); if (match) { cur = { type: match[1].toLowerCase(), file: match[2].trim(), body: [] }; out.push(cur); } else if (cur && !/^\*\*\* (Begin|End) Patch/.test(line)) cur.body.push(line); }
    return out.map((change) => ({ type: change.type, file: change.file, ...diffSides(change.body.join('\n')) }));
  };
  const NO_RESULT = new Set(['TodoWrite']);
  return function record(state, rolloutRecord) {
    if (rolloutRecord.type !== 'event_msg' && rolloutRecord.type !== 'response_item' && rolloutRecord.type !== 'turn_context' && rolloutRecord.type !== 'compacted') return;
    const agent = state.agent, payload = rolloutRecord.payload && typeof rolloutRecord.payload === 'object' ? rolloutRecord.payload : {}, context = state.cx || (state.cx = { items: false, model: '', n: 0, tot: null, last: 0, userAt: -1 });
    const ts = Math.max(Date.parse(rolloutRecord.timestamp) || 0, state.lastTs || 0); state.lastTs = ts;   // the lines of one file are in order; a line without a time takes the last one
    const push = (event) => { event.k = agent + ':' + state.raw.length; state.raw.push(event); if (event.ts > context.last) context.last = event.ts; return event; };
    const takeThought = () => { const thought = state.th; state.th = ''; return thought ? { th: thought } : {}; };
    const say = (text, final) => { const trimmed = String(text == null ? '' : text).trim(); if (!trimmed) return; const event = push({ ts, agent, kind: 'say', text: trimmed, ...takeThought() }); state.act = state.raw.length - 1; if (final && agent === 'main') event.end = 1; };
    const user = (text) => { const typedText = typed(text); if (!typedText) return; push({ ts, agent: 'user', kind: 'user', text: typedText }); context.userAt = state.raw.length - 1; };
    const call = (id, name, input, at) => { const when = Math.max(Math.min(at || ts, ts), context.last); state.toolName[id] = name; push({ ts: when, agent, kind: 'tool', tool: toolLabel({ id, name, input: input || {} }, when), ...takeThought() }); state.act = state.raw.length - 1; };   // a command is placed when it started, never before what the file already said
    const result = (id, out, err) => { const toolName = state.toolName[id]; if (!toolName || NO_RESULT.has(toolName)) return; push({ ts, agent, kind: 'results', items: [{ id, err: !!err, out: clip(String(out == null ? '' : out).trimEnd(), resultMax[toolName] || (/^mcp__/.test(toolName) ? 900 : 600)) }] }); };
    const endTurn = () => { if (agent === 'main' && state.act > context.userAt && state.raw[state.act]) state.raw[state.act].end = 1; };   // the turn is over (or was stopped): the last thing the lead said or did closes it

    if (rolloutRecord.type === 'turn_context') { if (typeof payload.model === 'string') context.model = payload.model; return; }
    if (rolloutRecord.type === 'compacted') { push({ ts, agent, kind: 'compact' }); return; }
    if (rolloutRecord.type === 'event_msg') {
      if (payload.type === 'item_completed' && payload.item && typeof payload.item === 'object') {
        const item = payload.item, id = String(item.id || 'cx' + state.raw.length), at = +payload.started_at_ms || 0; context.items = true;
        if (item.type === 'UserMessage') user(partsText(item.content));
        else if (item.type === 'AgentMessage') say(partsText(item.content), item.phase === 'final_answer');
        else if (item.type === 'CommandExecution') { call(id, 'Bash', { command: shellText(item.command) }, at); result(id, item.aggregated_output != null ? item.aggregated_output : [item.stdout, item.stderr].filter(Boolean).join('\n'), item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0)); }
        else if (item.type === 'FileChange') Object.entries(item.changes && typeof item.changes === 'object' ? item.changes : {}).forEach(([file, change], index) => {
          const callId = index ? id + ':' + index : id, kind = change && change.type, sides = diffSides(change && change.unified_diff);
          if (kind === 'add') call(callId, 'Write', { file_path: file, content: change.content != null ? String(change.content) : sides.add }, at);
          else call(callId, 'Edit', { file_path: file, old_string: kind === 'delete' && change.content != null ? String(change.content) : sides.del, new_string: sides.add }, at);
          result(callId, '', item.status === 'failed');   // the line is written once the change is made: without an answer the call would look like it is still waiting (for an approval, on a file change)
        });
        else if (item.type === 'McpToolCall') { call(id, 'mcp__' + (item.server || 'mcp') + '__' + (item.tool || 'tool'), item.arguments && typeof item.arguments === 'object' ? item.arguments : {}, at); result(id, partsText(item.result && item.result.content), item.status === 'failed' || !!(item.result && item.result.isError)); }
        else if (item.type === 'ImageView') { call(id, 'Read', { file_path: item.path }, at); result(id, ''); }
        else if (item.type === 'Extension' && /^web\./.test(item.kind || '')) {
          const action = item.action && typeof item.action === 'object' ? item.action : {}, query = item.query || action.query || (Array.isArray(action.queries) && action.queries[0]) || '';
          if (action.url) call(id, 'WebFetch', { url: action.url }, at); else call(id, 'WebSearch', { query: query }, at);
          result(id, (Array.isArray(item.results) ? item.results : []).slice(0, 6).map((result) => (result.title || '') + (result.url ? ' · ' + result.url : '')).join('\n'));
        }
        return;
      }
      if (payload.type === 'user_message') { if (!context.items) user(payload.message); return; }
      if (payload.type === 'agent_message') { if (!context.items) say(payload.message, payload.phase === 'final_answer'); return; }
      if (payload.type === 'token_count') {   // what the last request used. The same numbers are written again when only the rate limits moved: the running total tells
        const info = payload.info && typeof payload.info === 'object' ? payload.info : null, usage = info && info.last_token_usage, tot = info && info.total_token_usage ? info.total_token_usage.total_tokens : null;
        if (!usage || (tot != null && tot === context.tot)) return; context.tot = tot;
        const cached = usage.cached_input_tokens || 0, cacheWrites = usage.cache_write_input_tokens || 0;
        state.msgUsage.set('t' + context.n++, { ts, u: { i: Math.max(0, (usage.input_tokens || 0) - cached - cacheWrites), o: usage.output_tokens || 0, r: cached, w: cacheWrites }, model: context.model || 'codex', ...(info.model_context_window > 0 ? { cw: info.model_context_window } : {}) });   // cw: the size of the context window, which Codex states
        return;
      }
      if (payload.type === 'task_complete' || payload.type === 'turn_complete' || payload.type === 'turn_aborted') endTurn();
      return;
    }
    // response_item: what the model sent, raw
    if (payload.type === 'reasoning') {   // the summary Codex keeps of what the agent was thinking: an inner thought on its next line or call
      const summary = (Array.isArray(payload.summary) ? payload.summary : []).map((part) => (part && typeof part.text === 'string' ? part.text : '')).filter(Boolean).join('\n').replace(/\*\*/g, '');
      if (summary.trim()) state.th = clip(summary.replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\n ]*/g, '\n').trim(), 900);
      return;
    }
    const isCall = payload.type === 'function_call' || payload.type === 'custom_tool_call' || payload.type === 'local_shell_call', id = String(payload.call_id || payload.id || '');
    if (isCall && id) {
      let args = {}; if (payload.type === 'custom_tool_call') args = { input: payload.input }; else if (payload.type === 'local_shell_call') args = payload.action && typeof payload.action === 'object' ? payload.action : {}; else { try { const value = typeof payload.arguments === 'string' ? JSON.parse(payload.arguments) : payload.arguments; if (value && typeof value === 'object') args = value; } catch {} }
      const toolName = String(payload.name || (payload.type === 'local_shell_call' ? 'shell' : ''));
      if (/^request_user_input/.test(toolName)) { call(id, 'AskUserQuestion', { questions: (Array.isArray(args.questions) ? args.questions : []).map((question) => ({ question: (question && (question.question || question.title)) || '', options: (question && Array.isArray(question.options) && question.options) || [] })) }); return; }   // the agent asks the person something: in both generations
      if (context.items) return;
      if (/^(shell|shell_command|exec_command|local_shell|unified_exec|container\.exec)$/.test(toolName)) call(id, 'Bash', { command: shellText(args.command != null ? args.command : args.cmd) });
      else if (toolName === 'apply_patch') { const files = patchFiles(args.input != null ? args.input : args.patch); if (!files.length) call(id, 'Edit', { file_path: '', old_string: '', new_string: clip(args.input || args.patch || '', 500) }); if (files.length > 1) (context.more = context.more || {})[id] = files.length; files.forEach((file, index) => { const callId = index ? id + ':' + index : id; if (file.type === 'add') call(callId, 'Write', { file_path: file.file, content: file.add }); else call(callId, 'Edit', { file_path: file.file, old_string: file.del, new_string: file.add }); }); }
      else if (toolName === 'update_plan') call(id, 'TodoWrite', { todos: (Array.isArray(args.plan) ? args.plan : []).map((step) => ({ content: (step && step.step) || '', status: (step && step.status) || 'pending' })) });
      else if (toolName === 'view_image') call(id, 'Read', { file_path: args.path });
      else if (toolName) call(id, payload.namespace ? String(payload.namespace).replace(/::$/, '') + '__' + toolName : toolName, args);
      return;
    }
    if ((payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output' || payload.type === 'local_shell_call_output') && id) {
      if (context.items && state.toolName[id] !== 'AskUserQuestion') return;   // in the current format the item already carried the output (an MCP call has the same id in both: it would be answered twice, the second time without its failure)
      let out = payload.output, err = false;
      if (typeof out === 'string' && out[0] === '{') { try { const parsed = JSON.parse(out); if (parsed && typeof parsed === 'object' && ('output' in parsed || 'metadata' in parsed)) { err = !!(parsed.metadata && typeof parsed.metadata.exit_code === 'number' && parsed.metadata.exit_code !== 0); out = parsed.output != null ? parsed.output : ''; } } catch {} }
      else if (out && typeof out === 'object' && !Array.isArray(out)) { err = out.success === false; out = out.content != null ? out.content : ''; }
      result(id, partsText(out), err); for (let index = 1; index < ((context.more || {})[id] || 0); index++) result(id + ':' + index, '', err);
      return;
    }
    if (payload.type === 'web_search_call' && !context.items && id) call(id, 'WebSearch', { query: (payload.action && payload.action.query) || '' });
  };
}

module.exports = { parser };
