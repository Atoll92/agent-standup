const { typed, partsText } = require('./text');

// ---- one record of a rollout file → the events of the call
// Two generations of the format are read. The current one (2026) writes an "item_completed" line for everything that happened: what was typed, what the agent said,
// each command with its output, each file it changed, each search. The earlier one wrote the messages as "user_message" / "agent_message" events and the tool calls as
// raw "function_call" records. A file of the current kind also carries those raw records (the script the model wrote around its commands), which would say everything twice:
// once the first item is seen, the raw tool calls are left alone.
function parser({ toolLabel, clip, resultMax = {} }) {
  const shellText = (c) => (Array.isArray(c) ? (c.length === 3 && /^-l?c$/.test(c[1]) ? c[2] : c.join(' ')) : String(c == null ? '' : c));
  const diffSides = (d) => { const add = [], del = []; for (const l of String(d || '').split('\n')) { if (/^(\+\+\+ |--- |@@|diff |index |\*\*\* )/.test(l)) continue; if (l[0] === '+') add.push(l.slice(1)); else if (l[0] === '-') del.push(l.slice(1)); } return { add: add.join('\n'), del: del.join('\n') }; };
  const patchFiles = (text) => {   // the "*** Update File: x" blocks of an apply_patch call
    const out = []; let cur = null;
    for (const l of String(text || '').split('\n')) { const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(l); if (m) { cur = { type: m[1].toLowerCase(), file: m[2].trim(), body: [] }; out.push(cur); } else if (cur && !/^\*\*\* (Begin|End) Patch/.test(l)) cur.body.push(l); }
    return out.map((x) => ({ type: x.type, file: x.file, ...diffSides(x.body.join('\n')) }));
  };
  const NO_RESULT = new Set(['TodoWrite']);
  return function record(st, r) {
    if (r.type !== 'event_msg' && r.type !== 'response_item' && r.type !== 'turn_context' && r.type !== 'compacted') return;
    const agent = st.agent, p = r.payload && typeof r.payload === 'object' ? r.payload : {}, cx = st.cx || (st.cx = { items: false, model: '', n: 0, tot: null, last: 0, userAt: -1 });
    const ts = Math.max(Date.parse(r.timestamp) || 0, st.lastTs || 0); st.lastTs = ts;   // the lines of one file are in order; a line without a time takes the last one
    const push = (e) => { e.k = agent + ':' + st.raw.length; st.raw.push(e); if (e.ts > cx.last) cx.last = e.ts; return e; };
    const th = () => { const t = st.th; st.th = ''; return t ? { th: t } : {}; };
    const say = (text, final) => { const t = String(text == null ? '' : text).trim(); if (!t) return; const e = push({ ts, agent, kind: 'say', text: t, ...th() }); st.act = st.raw.length - 1; if (final && agent === 'main') e.end = 1; };
    const user = (text) => { const t = typed(text); if (!t) return; push({ ts, agent: 'user', kind: 'user', text: t }); cx.userAt = st.raw.length - 1; };
    const call = (id, name, input, at) => { const when = Math.max(Math.min(at || ts, ts), cx.last); st.toolName[id] = name; push({ ts: when, agent, kind: 'tool', tool: toolLabel({ id, name, input: input || {} }, when), ...th() }); st.act = st.raw.length - 1; };   // a command is placed when it started, never before what the file already said
    const result = (id, out, err) => { const n = st.toolName[id]; if (!n || NO_RESULT.has(n)) return; push({ ts, agent, kind: 'results', items: [{ id, err: !!err, out: clip(String(out == null ? '' : out).trimEnd(), resultMax[n] || (/^mcp__/.test(n) ? 900 : 600)) }] }); };
    const endTurn = () => { if (agent === 'main' && st.act > cx.userAt && st.raw[st.act]) st.raw[st.act].end = 1; };   // the turn is over (or was stopped): the last thing the lead said or did closes it

    if (r.type === 'turn_context') { if (typeof p.model === 'string') cx.model = p.model; return; }
    if (r.type === 'compacted') { push({ ts, agent, kind: 'compact' }); return; }
    if (r.type === 'event_msg') {
      if (p.type === 'item_completed' && p.item && typeof p.item === 'object') {
        const it = p.item, id = String(it.id || 'cx' + st.raw.length), at = +p.started_at_ms || 0; cx.items = true;
        if (it.type === 'UserMessage') user(partsText(it.content));
        else if (it.type === 'AgentMessage') say(partsText(it.content), it.phase === 'final_answer');
        else if (it.type === 'CommandExecution') { call(id, 'Bash', { command: shellText(it.command) }, at); result(id, it.aggregated_output != null ? it.aggregated_output : [it.stdout, it.stderr].filter(Boolean).join('\n'), it.status === 'failed' || (typeof it.exit_code === 'number' && it.exit_code !== 0)); }
        else if (it.type === 'FileChange') Object.entries(it.changes && typeof it.changes === 'object' ? it.changes : {}).forEach(([file, c], i) => {
          const cid = i ? id + ':' + i : id, kind = c && c.type, d = diffSides(c && c.unified_diff);
          if (kind === 'add') call(cid, 'Write', { file_path: file, content: c.content != null ? String(c.content) : d.add }, at);
          else call(cid, 'Edit', { file_path: file, old_string: kind === 'delete' && c.content != null ? String(c.content) : d.del, new_string: d.add }, at);
          result(cid, '', it.status === 'failed');   // the line is written once the change is made: without an answer the call would look like it is still waiting (for an approval, on a file change)
        });
        else if (it.type === 'McpToolCall') { call(id, 'mcp__' + (it.server || 'mcp') + '__' + (it.tool || 'tool'), it.arguments && typeof it.arguments === 'object' ? it.arguments : {}, at); result(id, partsText(it.result && it.result.content), it.status === 'failed' || !!(it.result && it.result.isError)); }
        else if (it.type === 'ImageView') { call(id, 'Read', { file_path: it.path }, at); result(id, ''); }
        else if (it.type === 'Extension' && /^web\./.test(it.kind || '')) {
          const a = it.action && typeof it.action === 'object' ? it.action : {}, q = it.query || a.query || (Array.isArray(a.queries) && a.queries[0]) || '';
          if (a.url) call(id, 'WebFetch', { url: a.url }, at); else call(id, 'WebSearch', { query: q }, at);
          result(id, (Array.isArray(it.results) ? it.results : []).slice(0, 6).map((x) => (x.title || '') + (x.url ? ' · ' + x.url : '')).join('\n'));
        }
        return;
      }
      if (p.type === 'user_message') { if (!cx.items) user(p.message); return; }
      if (p.type === 'agent_message') { if (!cx.items) say(p.message, p.phase === 'final_answer'); return; }
      if (p.type === 'token_count') {   // what the last request used. The same numbers are written again when only the rate limits moved: the running total tells
        const info = p.info && typeof p.info === 'object' ? p.info : null, u = info && info.last_token_usage, tot = info && info.total_token_usage ? info.total_token_usage.total_tokens : null;
        if (!u || (tot != null && tot === cx.tot)) return; cx.tot = tot;
        const cached = u.cached_input_tokens || 0, w = u.cache_write_input_tokens || 0;
        st.msgUsage.set('t' + cx.n++, { ts, u: { i: Math.max(0, (u.input_tokens || 0) - cached - w), o: u.output_tokens || 0, r: cached, w }, model: cx.model || 'codex', ...(info.model_context_window > 0 ? { cw: info.model_context_window } : {}) });   // cw: the size of the context window, which Codex states
        return;
      }
      if (p.type === 'task_complete' || p.type === 'turn_complete' || p.type === 'turn_aborted') endTurn();
      return;
    }
    // response_item: what the model sent, raw
    if (p.type === 'reasoning') {   // the summary Codex keeps of what the agent was thinking: an inner thought on its next line or call
      const s = (Array.isArray(p.summary) ? p.summary : []).map((x) => (x && typeof x.text === 'string' ? x.text : '')).filter(Boolean).join('\n').replace(/\*\*/g, '');
      if (s.trim()) st.th = clip(s.replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\n ]*/g, '\n').trim(), 900);
      return;
    }
    const isCall = p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call', id = String(p.call_id || p.id || '');
    if (isCall && id) {
      let a = {}; if (p.type === 'custom_tool_call') a = { input: p.input }; else if (p.type === 'local_shell_call') a = p.action && typeof p.action === 'object' ? p.action : {}; else { try { const v = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : p.arguments; if (v && typeof v === 'object') a = v; } catch {} }
      const n = String(p.name || (p.type === 'local_shell_call' ? 'shell' : ''));
      if (/^request_user_input/.test(n)) { call(id, 'AskUserQuestion', { questions: (Array.isArray(a.questions) ? a.questions : []).map((q) => ({ question: (q && (q.question || q.title)) || '', options: (q && Array.isArray(q.options) && q.options) || [] })) }); return; }   // the agent asks the person something: in both generations
      if (cx.items) return;
      if (/^(shell|shell_command|exec_command|local_shell|unified_exec|container\.exec)$/.test(n)) call(id, 'Bash', { command: shellText(a.command != null ? a.command : a.cmd) });
      else if (n === 'apply_patch') { const fl = patchFiles(a.input != null ? a.input : a.patch); if (!fl.length) call(id, 'Edit', { file_path: '', old_string: '', new_string: clip(a.input || a.patch || '', 500) }); if (fl.length > 1) (cx.more = cx.more || {})[id] = fl.length; fl.forEach((f, i) => { const cid = i ? id + ':' + i : id; if (f.type === 'add') call(cid, 'Write', { file_path: f.file, content: f.add }); else call(cid, 'Edit', { file_path: f.file, old_string: f.del, new_string: f.add }); }); }
      else if (n === 'update_plan') call(id, 'TodoWrite', { todos: (Array.isArray(a.plan) ? a.plan : []).map((x) => ({ content: (x && x.step) || '', status: (x && x.status) || 'pending' })) });
      else if (n === 'view_image') call(id, 'Read', { file_path: a.path });
      else if (n) call(id, p.namespace ? String(p.namespace).replace(/::$/, '') + '__' + n : n, a);
      return;
    }
    if ((p.type === 'function_call_output' || p.type === 'custom_tool_call_output' || p.type === 'local_shell_call_output') && id) {
      if (cx.items && st.toolName[id] !== 'AskUserQuestion') return;   // in the current format the item already carried the output (an MCP call has the same id in both: it would be answered twice, the second time without its failure)
      let out = p.output, err = false;
      if (typeof out === 'string' && out[0] === '{') { try { const j = JSON.parse(out); if (j && typeof j === 'object' && ('output' in j || 'metadata' in j)) { err = !!(j.metadata && typeof j.metadata.exit_code === 'number' && j.metadata.exit_code !== 0); out = j.output != null ? j.output : ''; } } catch {} }
      else if (out && typeof out === 'object' && !Array.isArray(out)) { err = out.success === false; out = out.content != null ? out.content : ''; }
      result(id, partsText(out), err); for (let i = 1; i < ((cx.more || {})[id] || 0); i++) result(id + ':' + i, '', err);
      return;
    }
    if (p.type === 'web_search_call' && !cx.items && id) call(id, 'WebSearch', { query: (p.action && p.action.query) || '' });
  };
}

module.exports = { parser };
