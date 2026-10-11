// Codex sessions (OpenAI's Codex: the desktop app and the command line) shown as the same call as Claude Code sessions.
// Codex writes one "rollout" file per thread in <home>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl. Nothing is ever written there, and nothing else in the Codex folder is read
// but session_index.jsonl (the names of the threads). server.js reads the files with its own incremental reader and hands each record to parser() below, which turns it into the
// events a Claude Code record gives (say, user, tool, results, usage, compact), so everything after that is shared: the timeline, the live feed, the page.
// All Codex sessions are listed under one made-up project, PROJ. No Claude Code project folder can have that name: theirs are paths with every other character turned into "-".
const fs = require('fs'), os = require('os'), path = require('path');
const PROJ = '_codex';
// Where Codex keeps its files: AGENT_STANDUP_CODEX (a folder; "0" or "off" turns Codex sessions off), else $CODEX_HOME, else ~/.codex.
// When AGENT_STANDUP_PROJECTS points the app at one folder of Claude Code sessions (--projects, the tests), Codex is only read if it is asked for too.
function home() {
  const v = process.env.AGENT_STANDUP_CODEX;
  if (v != null) return /^(0|off|no|false)?$/i.test(v.trim()) ? null : v;
  if (process.env.AGENT_STANDUP_PROJECTS) return null;
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}
const dirKey = (cwd) => String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');   // the name Claude Code gives the same folder: how "this project" is asked for everywhere else

// ---- finding the files
const NAME = /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
let memo = { at: 0, home: undefined, rows: [], byId: new Map() };
function scan() {   // every rollout file with its date and size, newest first; shared by all the polls of two seconds
  const h = home(), now = Date.now(); if (memo.home === h && now - memo.at < 2000) return memo;
  const rows = [], byId = new Map();
  const walk = (dir, depth) => {
    let names; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4) walk(fp, depth + 1); continue; }
      const m = NAME.exec(e.name); if (!m) continue;
      let st; try { st = fs.statSync(fp); } catch { continue; }
      const row = { id: m[1].toLowerCase(), file: fp, mtime: st.mtimeMs, size: st.size }; rows.push(row); byId.set(row.id, row);
    }
  };
  if (h) walk(path.join(h, 'sessions'), 0);
  rows.sort((a, b) => b.mtime - a.mtime);
  memo = { at: now, home: h, rows, byId }; return memo;
}
const row = (id) => scan().byId.get(String(id).toLowerCase()) || null;
const fileOf = (id) => { const r = row(id); return r ? r.file : null; };

// ---- the first line of a file says what the thread is: its folder, and whether another thread started it
const headCache = new Map();   // file → { ok, cwd, dir, child } (the first line never changes)
function firstLine(file, max = 1024 * 1024) {
  let fd; try {
    fd = fs.openSync(file, 'r'); const parts = []; let pos = 0;
    while (pos < max) { const buf = Buffer.alloc(64 * 1024), n = fs.readSync(fd, buf, 0, buf.length, pos); if (!n) break; const nl = buf.subarray(0, n).indexOf(10); if (nl >= 0) { parts.push(buf.subarray(0, nl)); return { text: Buffer.concat(parts).toString('utf8'), whole: true }; } parts.push(buf.subarray(0, n)); pos += n; }
    return { text: Buffer.concat(parts).toString('utf8'), whole: false, capped: pos >= max };
  } catch { return { text: '', whole: false }; } finally { if (fd != null) fs.closeSync(fd); }
}
function head(file) {
  const hit = headCache.get(file); if (hit) return hit;
  const { text, whole, capped } = firstLine(file); let out = { ok: false, cwd: '', dir: '', child: false };
  if (!text) return out;   // not written yet: looked at again next time
  let p = null; try { const r = JSON.parse(text); if (r && r.type === 'session_meta' && r.payload && typeof r.payload === 'object') p = r.payload; } catch {}
  if (p) out = { ok: true, cwd: typeof p.cwd === 'string' ? p.cwd : '', child: !!p.parent_thread_id || !!(p.source && typeof p.source === 'object' && p.source.subagent) };
  else if (capped && /^\{"timestamp":"[^"]*","(?:ordinal":\d+,")?type":"session_meta"/.test(text)) {   // a first line longer than what was read: the two facts, without the rest
    const cwd = text.match(/"cwd":"((?:[^"\\]|\\.)*)"/); let c = ''; try { c = cwd ? JSON.parse('"' + cwd[1] + '"') : ''; } catch {}
    out = { ok: true, cwd: c, child: /"parent_thread_id":"[^"]+"/.test(text) || /"source":\{"subagent"/.test(text) };
  }
  out.dir = dirKey(out.cwd);
  if (whole || capped) { if (headCache.size > 5000) headCache.clear(); headCache.set(file, out); }   // a first line still being written is read again next time
  return out;
}
// The threads a person started, newest first. A thread started by another thread (Codex's review of a command before it runs, a sub-agent) is not a session of its own.
function sessions(limit = 80) {
  const out = []; for (const r of scan().rows) { const h = head(r.file); if (!h.ok || h.child) continue; out.push({ ...r, cwd: h.cwd, dir: h.dir }); if (out.length >= limit) break; }
  return out;
}
const inProject = (id, key) => { const r = row(id); if (!r || !key) return false; if (key === PROJ) return true; const d = head(r.file).dir; return d === key || d.startsWith(key + '-'); };
const projectLabel = (cwd) => { const h = os.homedir(), rel = cwd && cwd.startsWith(h + path.sep) ? cwd.slice(h.length + 1) : cwd; return 'Codex' + (rel ? ' · ' + rel.split(path.sep).join('/') : ''); };

// ---- names: the one Codex gave the thread (session_index.jsonl, the last line for an id wins), else the first thing the person typed
let names = { sig: '', map: new Map() };
function threadNames() {
  const h = home(); if (!h) return names.map;
  const f = path.join(h, 'session_index.jsonl'); let st; try { st = fs.statSync(f); } catch { return names.map; }
  const sig = f + ':' + st.mtimeMs + ':' + st.size; if (sig === names.sig) return names.map;
  const map = new Map(); try { for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l) continue; try { const j = JSON.parse(l); if (j && j.id && typeof j.thread_name === 'string' && j.thread_name.trim()) map.set(String(j.id).toLowerCase(), j.thread_name.trim()); } catch {} } } catch {}
  names = { sig, map }; return map;
}
function typed(t) {   // what the person typed, without what Codex wraps around it: the tags of an answer to a question, and the list of attached files ("# Files mentioned by the user:" … "## My request:")
  let s = String(t == null ? '' : t).replace(/<\/?send_user_message_question_reply>/g, ''); const i = s.indexOf('# Files mentioned by the user:');
  if (i >= 0) { const rest = s.slice(i), m = /\n## My request[^\n]*:[ \t]*\n?/.exec(rest); s = s.slice(0, i) + (m ? '\n' + rest.slice(m.index + m[0].length) : ''); }
  return s.trim();
}
const partsText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).filter(Boolean).join('\n') : '');
const promptCache = new Map();   // file → the first prompt ('' = looked for in the first megabyte and not there)
function firstPrompt(r) {
  const hit = promptCache.get(r.file); if (hit != null) return hit;
  let text = ''; try { const fd = fs.openSync(r.file, 'r'); try { const buf = Buffer.alloc(Math.min(1024 * 1024, r.size)); fs.readSync(fd, buf, 0, buf.length, 0); text = buf.toString('utf8'); } finally { fs.closeSync(fd); } } catch {}
  let out = '';
  for (const l of text.split('\n')) {
    if (!l.includes('"UserMessage"') && !l.includes('"user_message"')) continue; let j; try { j = JSON.parse(l); } catch { continue; }
    const p = (j && j.payload) || {}, t = p.type === 'user_message' ? typed(p.message) : p.type === 'item_completed' && p.item && p.item.type === 'UserMessage' ? typed(partsText(p.item.content)) : '';
    if (t) { out = t.replace(/\s+/g, ' ').slice(0, 90); break; }
  }
  if (out || r.size > 64 * 1024) { if (promptCache.size > 2000) promptCache.clear(); promptCache.set(r.file, out); }   // a file that has just been created is looked at again
  return out;
}
const title = (r) => threadNames().get(r.id) || firstPrompt(r) || r.id;

// ---- the board: is the agent in the middle of a turn, or is it the person's turn? Read from the end of the file.
const tailCache = new Map();
function boardRow(r, now) {
  const sig = r.mtime + ':' + r.size; let t = tailCache.get(r.file);
  if (!t || t.sig !== sig) {
    t = { sig, turn: '' };
    try {
      const fd = fs.openSync(r.file, 'r'); let text = ''; try { const n = Math.min(128 * 1024, r.size), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, r.size - n); text = buf.toString('utf8'); } finally { fs.closeSync(fd); }
      for (const l of text.split('\n')) { const m = /"type":"(task_started|task_complete|turn_started|turn_complete|turn_aborted)"/.exec(l.slice(0, 400)); if (m && l.includes('"event_msg"')) t.turn = /started/.test(m[1]) ? 'open' : 'closed'; }
    } catch {}
    if (tailCache.size > 200) tailCache.delete(tailCache.keys().next().value); tailCache.set(r.file, t);
  }
  const age = now - r.mtime, state = age >= 30 * 60e3 ? 'idle' : t.turn === 'closed' ? 'turn' : age < 10 * 60e3 ? 'working' : 'idle';
  return { proj: PROJ, id: r.id, title: title(r), mtime: r.mtime, state, tool: '', ageMs: age, subActive: 0, subTotal: 0, dir: r.dir, source: 'codex' };
}

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
module.exports = { PROJ, home, dirKey, sessions, row, fileOf, inProject, projectLabel, title, boardRow, parser };
