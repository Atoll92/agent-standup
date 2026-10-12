// Mistral Vibe sessions (Mistral's coding agent, the `vibe` command) shown as the same call as Claude Code sessions. Nothing is ever written in Vibe's folder.
// Vibe has two ways of keeping a session, and both are read:
// - The current one (the engine Vibe 2.26 starts by default; checked against real sessions of 2.26.1): <home>/logs/session/unified/<id>/. CURRENT names the latest snapshot
//   ("generation"); its manifest lists the pages of the history (chunks/<sha>.json, arrays of entries) and the journal that follows it (journal/<n>.jsonl), whose
//   projection_delta records append, replace or remove entries until the next snapshot. An entry is a message (user or assistant), a reasoning, or an "effect": a tool
//   call with its input, its state and its result, and the times it started and ended. A sub-agent has no history of its own on disk: what is known of it is what the
//   lead did with it (subagent.spawn, .send_message, .wait with the answer it got, .stop).
// - The earlier one (still written by `vibe --legacy-harness`; read from Vibe's source, vibe/core/session/session_logger.py): <home>/logs/session/<prefix>_<date>_<time>_<id>/
//   with messages.jsonl (one message per line, no time on any of them) and meta.json; a sub-agent is a session of its own in <session>/agents/.
// server.js reads the earlier format with its own incremental reader and parser() below; the current one is turned into the same events here (state()).
// All Vibe sessions are listed under one made-up project, PROJ, like Codex ones.
const fs = require('fs'), os = require('os'), path = require('path');
const PROJ = '_vibe', SOURCE = 'vibe', MESSAGES = 'messages.jsonl', META = 'meta.json';
// Where Vibe keeps its files: AGENT_STANDUP_VIBE (a folder; "0" or "off" turns Vibe sessions off), else $VIBE_HOME, else ~/.vibe.
// When AGENT_STANDUP_PROJECTS points the app at one folder of Claude Code sessions (--projects, the tests), Vibe is only read if it is asked for too.
function home() {
  const v = process.env.AGENT_STANDUP_VIBE;
  if (v != null) return /^(0|off|no|false)?$/i.test(v.trim()) ? null : v;
  if (process.env.AGENT_STANDUP_PROJECTS) return null;
  return process.env.VIBE_HOME || path.join(os.homedir(), '.vibe');
}
const dirKey = (cwd) => String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');   // the name Claude Code gives the same folder: how "this project" is asked for everywhere else
const SAFE = /^[\w][\w.\-]*$/;   // a session is known by the name of its folder; one that could not be an id elsewhere in the app is left out
const stat = (f) => { try { return fs.statSync(f); } catch { return null; } };

// ---- finding the sessions
let memo = { at: 0, home: undefined, rows: [], byId: new Map() };
function scan() {   // every session folder with the date and size of its messages, newest first; shared by all the polls of two seconds
  const h = home(), now = Date.now(); if (memo.home === h && now - memo.at < 2000) return memo;
  const rows = [], byId = new Map(), root = h ? path.join(h, 'logs', 'session') : '';
  let names = []; if (root) { try { names = fs.readdirSync(root, { withFileTypes: true }); } catch {} }
  for (const e of names) {
    if (!e.isDirectory() || !SAFE.test(e.name) || e.name === 'unified') continue;
    const dir = path.join(root, e.name), file = path.join(dir, MESSAGES), st = stat(file); if (!st || !st.isFile()) continue;
    const row = { id: e.name, dir, file, mtime: st.mtimeMs, size: st.size }; rows.push(row); byId.set(row.id, row);
  }
  let uni = []; if (root) { try { uni = fs.readdirSync(path.join(root, 'unified'), { withFileTypes: true }); } catch {} }
  for (const e of uni) {   // the current format: one folder per session, CURRENT is rewritten at each snapshot
    if (!e.isDirectory() || !SAFE.test(e.name) || byId.has(e.name)) continue;
    const dir = path.join(root, 'unified', e.name), file = path.join(dir, 'CURRENT'), st = stat(file); if (!st || !st.isFile()) continue;
    const row = { id: e.name, dir, file, mtime: st.mtimeMs, size: st.size, uni: true }; rows.push(row); byId.set(row.id, row);
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  for (const r of rows.filter((x) => x.uni).slice(0, 40)) { const j = journalOf(r.dir); if (j) { r.journal = j.file; r.mtime = Math.max(r.mtime, j.mtime); r.size += j.size; } }   // between two snapshots only the journal is written: it is what says a session is moving
  rows.sort((a, b) => b.mtime - a.mtime);
  memo = { at: now, home: h, rows, byId }; return memo;
}
function journalOf(dir) {   // the newest journal segment of a session
  let names; try { names = fs.readdirSync(path.join(dir, 'journal')).filter((f) => f.endsWith('.jsonl')).sort(); } catch { return null; }
  for (let i = names.length - 1; i >= 0 && i >= names.length - 2; i--) { const file = path.join(dir, 'journal', names[i]), st = stat(file); if (st) return i === names.length - 1 || st.size ? { file, mtime: st.mtimeMs, size: st.size } : null; }
  return null;
}
const row = (id) => scan().byId.get(String(id)) || null;
const fileOf = (id) => { const r = row(id); return r ? r.file : null; };

// ---- meta.json: read again only when it was written
const metaCache = new Map();   // session folder → { sig, v }
const NO_META = { title: '', start: 0, cwd: '', children: [], stats: null, model: '', cw: 0 };
function meta(dir) {
  const f = path.join(dir, META), st = stat(f); if (!st) return NO_META;
  const sig = st.mtimeMs + ':' + st.size, hit = metaCache.get(dir); if (hit && hit.sig === sig) return hit.v;
  let j = null; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}   // being written: asked again next time, nothing is kept
  if (!j || typeof j !== 'object') return hit ? hit.v : NO_META;
  const env = j.environment && typeof j.environment === 'object' ? j.environment : {}, cfg = j.config && typeof j.config === 'object' ? j.config : {}, model = typeof cfg.active_model === 'string' ? cfg.active_model : '';
  const mc = (Array.isArray(cfg.models) ? cfg.models : []).find((m) => m && (m.alias === model || m.name === model)), s = j.stats && typeof j.stats === 'object' ? j.stats : null;
  const v = {
    title: typeof j.title === 'string' ? j.title.trim() : '', start: Date.parse(j.start_time) || 0, cwd: typeof env.working_directory === 'string' ? env.working_directory : typeof j.origin_directory === 'string' ? j.origin_directory : '',
    children: (Array.isArray(j.child_sessions) ? j.child_sessions : []).filter((c) => c && typeof c === 'object').map((c) => ({ tool: String(c.tool_call_id || ''), agent: String(c.agent || ''), rel: String(c.relative_path || '').replace(/\\/g, '/'), sid: String(c.session_id || '') })),
    stats: s ? { p: +s.session_prompt_tokens || 0, c: +s.session_completion_tokens || 0, r: +s.session_cached_tokens || 0, x: +s.context_tokens || 0 } : null, model, cw: mc && mc.max_context_length > 0 ? +mc.max_context_length : 0,
  };
  if (metaCache.size > 3000) metaCache.clear(); metaCache.set(dir, { sig, v }); return v;
}
// The sessions a person started, newest first, each with the folder it was started in.
function sessions(limit = 80) { return scan().rows.slice(0, limit).map((r) => { const m = meta(r.dir); return { ...r, cwd: m.cwd, key: dirKey(m.cwd) }; }); }   // meta.json is written in both formats
const inProject = (id, key) => { const r = row(id); if (!r || !key) return false; if (key === PROJ) return true; const d = dirKey(meta(r.dir).cwd); return d === key || d.startsWith(key + '-'); };
const projectLabel = (cwd) => { const h = os.homedir(), rel = cwd && cwd.startsWith(h + path.sep) ? cwd.slice(h.length + 1) : cwd; return 'Mistral Vibe' + (rel ? ' · ' + rel.split(path.sep).join('/') : ''); };

// ---- names: the title Vibe gave the session, else the first thing the person typed
function readPart(file, from, len) { let fd; try { fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(len), n = fs.readSync(fd, buf, 0, len, from); return buf.subarray(0, n).toString('utf8'); } catch { return ''; } finally { if (fd != null) fs.closeSync(fd); } }
const typed = (m) => String((typeof m.input_text === 'string' && m.input_text) || (typeof m.content === 'string' ? m.content : '') || '').replace(/^Scratchpad directory:[^\n]*\n(?:You can read and write files here[^\n]*\n)?\s*/, '').trim();   // without the note Vibe puts in front of a sub-agent's task
const promptCache = new Map();   // messages file → the first prompt ('' = looked for in the first megabyte and not there)
function firstPrompt(file, size) {
  const hit = promptCache.get(file); if (hit != null) return hit;
  let out = '';
  for (const l of readPart(file, 0, Math.min(1024 * 1024, size)).split('\n')) { if (!l.includes('"user"')) continue; let j; try { j = JSON.parse(l); } catch { continue; } if (j && j.role === 'user' && !j.injected) { const t = typed(j); if (t) { out = t.replace(/\s+/g, ' ').slice(0, 90); break; } } }
  if (out || size > 64 * 1024) { if (promptCache.size > 2000) promptCache.clear(); promptCache.set(file, out); }   // a file that has just been created is looked at again
  return out;
}
const brief = (s) => { const m = /^(.{8,70}?)[.!?](\s|$)/.exec(s); if (m) return m[1]; if (s.length <= 56) return s; const cut = s.slice(0, 56), sp = cut.lastIndexOf(' '); return (sp > 30 ? cut.slice(0, sp) : cut) + '…'; };   // what a sub-agent was asked, in a few words: Vibe gives a task no title
const title = (r) => { if (!r.uni) return meta(r.dir).title || firstPrompt(r.file, r.size) || r.id; const u = uniLoad(r), se = (u.env && u.env.session) || {}; return meta(r.dir).title || str(se.title).trim() || str(se.preview).replace(/\s+/g, ' ').trim().slice(0, 90) || r.id; };

// ---- sub-agents: the sessions in <session>/agents/, each tied to the task call that started it
function subFiles(id) {
  const out = []; out.dirs = []; out.journals = []; const r = row(id); if (!r) return out;
  if (r.uni) { for (const k of uniState(r).kids) out.push({ file: r.file, aid: k.aid, id0: k.aid, run: '', st: k.st, mtime: k.last, meta: { agentType: k.type || 'agent', description: brief(str(k.task).replace(/\s+/g, ' ').trim().slice(0, 90)) || k.name || 'agent', toolUseId: k.spawn } }); return out; }
  const ad = path.join(r.dir, 'agents'); out.dirs.push(ad);
  let names; try { names = fs.readdirSync(ad, { withFileTypes: true }); } catch { return out; }
  const links = meta(r.dir).children;
  for (const e of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.isDirectory() || !SAFE.test(e.name)) continue;
    const dir = path.join(ad, e.name), file = path.join(dir, MESSAGES), st = stat(file); if (!st) continue;
    const link = links.find((c) => c.rel === 'agents/' + e.name) || null, agent = (link && link.agent) || e.name.replace(/_\d{8}_\d{6}_[\w-]+$/, '') || 'agent';
    out.push({ file, aid: e.name, id0: e.name, run: '', meta: { agentType: agent, description: brief(firstPrompt(file, st.size)) || agent, ...(link && link.tool ? { toolUseId: link.tool } : {}) } });
  }
  return out;
}
const watch = (id) => { const r = row(id); return !r ? [] : r.uni ? [path.join(r.dir, META), ...(r.journal ? [r.journal] : [])] : [path.join(r.dir, META)]; };   // written after the messages: the title, the totals and the links to the sub-agents come from it

// ---- the board: is the agent in the middle of a turn, or is it the person's turn? The last message says.
const tailCache = new Map();
function boardRow(r, now) {
  if (r.uni) {   // the current format says it outright: idle, running, or blocked on an approval or a question
    const u = uniState(r), kind = str(u.env && u.env.session && u.env.session.status && u.env.session.status.type), age = now - r.mtime, live = u.kids.filter((k) => !k.done).length;
    const state = age >= 30 * 60e3 ? 'idle' : kind === 'blocked' ? 'blocked' : kind === 'running' ? (u.waiting ? 'waiting' : 'working') : kind === 'idle' || kind === 'failed' ? 'turn' : age < 10 * 60e3 ? 'working' : 'idle';
    return { proj: PROJ, id: r.id, title: title(r), mtime: r.mtime, state, tool: '', ageMs: age, subActive: state === 'idle' || state === 'turn' ? 0 : live, subTotal: u.kids.length, dir: dirKey(meta(r.dir).cwd), source: SOURCE };
  }
  const sig = r.mtime + ':' + r.size; let t = tailCache.get(r.file);
  if (!t || t.sig !== sig) {
    t = { sig, turn: '' };
    const n = Math.min(256 * 1024, r.size), lines = readPart(r.file, r.size - n, n).split('\n').filter(Boolean); let last = null; try { last = JSON.parse(lines[lines.length - 1] || ''); } catch {}
    if (last && typeof last === 'object') t.turn = last.role === 'assistant' && !(Array.isArray(last.tool_calls) && last.tool_calls.length) ? 'closed' : 'open';   // a plain answer closes the turn; a tool call or a tool result means the agent goes on
    if (tailCache.size > 200) tailCache.delete(tailCache.keys().next().value); tailCache.set(r.file, t);
  }
  const m = meta(r.dir), subs = m.children.map((c) => stat(path.join(r.dir, c.rel, MESSAGES))).filter(Boolean), newest = Math.max(r.mtime, ...subs.map((s) => s.mtimeMs));
  const age = now - newest, state = age >= 30 * 60e3 ? 'idle' : t.turn === 'closed' ? 'turn' : age < 10 * 60e3 ? 'working' : 'idle';
  return { proj: PROJ, id: r.id, title: title(r), mtime: newest, state, tool: '', ageMs: age, subActive: state === 'working' ? subs.filter((s) => now - s.mtimeMs < 240000).length : 0, subTotal: m.children.length, dir: dirKey(m.cwd), source: SOURCE };
}

// ---- the current format: the history of a session, as Vibe would load it
const str = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const chunkCache = new Map(), uniCache = new Map();   // a page of history never changes (it is named after its content); session folder → { sig, entries, env, model }
function uniLoad(r) {
  const j = journalOf(r.dir), cs = stat(r.file), sig = (cs ? cs.mtimeMs + ':' + cs.size : '') + '|' + (j ? j.file + ':' + j.mtime + ':' + j.size : ''), hit = uniCache.get(r.dir); if (hit && hit.sig === sig) return hit;
  try {
    const cur = readJson(r.file), gdir = path.join(r.dir, 'generations', String(cur.generation)), man = readJson(path.join(gdir, 'manifest.json')), snap = readJson(path.join(gdir, 'projection-state.json')).snapshot || {};
    let entries = [];
    for (const sha of (man.projection_state && man.projection_state.chunks) || []) { if (!/^[0-9a-f]{16,}$/.test(sha)) continue; let c = chunkCache.get(sha); if (!c) { c = readJson(path.join(r.dir, 'chunks', sha + '.json')); if (chunkCache.size > 60) chunkCache.delete(chunkCache.keys().next().value); chunkCache.set(sha, c); } if (Array.isArray(c)) entries = entries.concat(c); }
    if (!entries.length && snap.history && Array.isArray(snap.history.entries)) entries = snap.history.entries.slice();
    let env = snap; const seg = man.recovery_journal_segment && typeof man.recovery_journal_segment.path === 'string' && SAFE_SEG.test(man.recovery_journal_segment.path) ? path.join(r.dir, man.recovery_journal_segment.path) : '';
    let text = ''; if (seg) { try { text = fs.readFileSync(seg, 'utf8'); } catch {} }
    for (const line of text.split('\n')) {   // what happened since the snapshot. A last line still being written does not parse and is read next time
      if (!line) continue; let rec; try { rec = JSON.parse(line); } catch { continue; }
      if (!rec || rec.type !== 'projection_delta' || !(rec.sequence > cur.snapshot_sequence) || !rec.payload || !Array.isArray(rec.payload.delta)) continue;
      for (const op of rec.payload.delta) {
        if (!op || typeof op !== 'object') continue;
        if (op.op === 'append_entry' && op.entry) entries.push(op.entry);
        else if (op.op === 'replace_entry' && op.entry) { let i = entries.length - 1; while (i >= 0 && entries[i].id !== op.id) i--; if (i >= 0) entries[i] = op.entry; else entries.push(op.entry); }
        else if (op.op === 'remove_entry') entries = entries.filter((e) => e.id !== op.id);
        else if (op.op === 'set_envelope' && op.state) env = op.state;
        else if (op.op === 'set_history_entries' && Array.isArray(op.entries)) entries = op.entries.slice();
      }
    }
    let model = hit && hit.gen === cur.generation ? hit.model : ''; if (!model) { try { model = str((readJson(path.join(gdir, 'runtime-state.json')).session_metadata || {}).active_model); } catch {} }
    const v = { sig, gen: cur.generation, entries: entries.filter((e) => e && typeof e === 'object' && typeof e.id === 'string'), env, model, state: null };
    if (uniCache.size > 200) uniCache.delete(uniCache.keys().next().value); uniCache.set(r.dir, v); return v;
  } catch { return hit || { sig: '', entries: [], env: {}, model: '', state: null }; }   // caught in the middle of a snapshot: what was read last time stands until the next look
}
const SAFE_SEG = /^journal\/[\w.\-]+\.jsonl$/;
const UNI_TOOLS = { 'file_system.bash': 'Bash', 'file_system.read_file': 'Read', 'file_system.write_file': 'Write', 'file_system.search_replace': 'Edit', 'file_system.grep': 'Grep', 'skill.read': 'Skill', 'process.start': 'Bash' };
const OPEN = /^(pending|queued|running|in_progress|awaiting|waiting|blocked|started)/;
const usageMemo = new Map();   // session folder → { p, c, r, list }: the lines of usage already given out. A line never changes once the page has it, so the totals Vibe keeps are handed out as what was added since the last look
let helpers = { toolLabel: (b, ts) => ({ id: b.id, ts, name: b.name, arg: '' }), clip: (t, n) => String(t).slice(0, n), resultMax: {} };   // set by parser(): the server's own way of describing a tool call
function uniState(r) {
  const u = uniLoad(r); if (u.state) return u.state;
  const { toolLabel, clip, resultMax } = helpers, mk = (agent) => ({ agent, raw: [], toolName: {}, msgUsage: new Map(), lastTs: 0 }), st = mk('main'), kids = new Map(), lastOf = new Map(); let th = '', waiting = false;
  const push = (to, e, key) => { e.k = to.agent + ':' + key; to.raw.push(e); if (e.ts > to.lastTs) to.lastTs = e.ts; return e; }, take = () => { const t = th; th = ''; return t ? { th: t } : {}; };
  const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).filter(Boolean).join('\n') : '').trim();
  for (const e of u.entries) {
    const ts = +e.createdAt || 0, end = Math.max(ts, +e.updatedAt || 0);
    if (e.type === 'reasoning') { const t = text(e.text) || text(e.summary); if (t) th = clip(t.replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\n ]*/g, '\n').trim(), 900); continue; }
    if (e.type === 'message') {
      const t = text(e.content); if (!t) continue;
      if (e.role === 'user') push(st, { ts, agent: 'user', kind: 'user', text: t }, e.id);
      else if (e.role === 'assistant') lastOf.set(e.turnId, push(st, { ts, agent: 'main', kind: 'say', text: t, ...take() }, e.id));
      continue;
    }
    if (e.type !== 'effect' || !e.detail || typeof e.detail !== 'object') continue;
    const raw = str(e.detail.toolName), input = e.detail.input && typeof e.detail.input === 'object' ? e.detail.input : {}, state = e.state && typeof e.state === 'object' ? e.state : {}, out = state.output && typeof state.output === 'object' ? state.output : {}, sc = out.structured_content && typeof out.structured_content === 'object' ? out.structured_content : {};
    const open = !state.status || OPEN.test(str(state.status)), failed = state.status === 'failed' || out.type === 'failure' || sc.type === 'error' || (typeof sc.returncode === 'number' && sc.returncode !== 0), errText = str((state.error && state.error.message) || (out.error && out.error.message) || (sc.type === 'error' ? sc.error : ''));
    if (raw === 'search_tool_functions' || raw === 'subagent.list') continue;   // the agent looking up its own tools: not part of the call
    if (/^subagent\./.test(raw)) {
      const name = str(e.detail.agentName || input.agentName), sub = (out._meta && out._meta['mistral.vibe.subagent']) || {}, cid = str(e.detail.childSessionId || sub.childSessionId);
      let kid = kids.get(name);
      if (raw === 'subagent.spawn' && cid) {   // a sub-agent joins: the task is its order
        kid = { aid: cid.replace(/[^\w.-]/g, '_'), name, type: str(input.agent), task: str(input.task), spawn: e.id, st: null, last: end, done: false, said: '' }; kid.st = mk(kid.aid); kids.set(name, kid);
        st.toolName[e.id] = 'Task'; lastOf.set(e.turnId, push(st, { ts, agent: 'main', kind: 'agentcall', toolId: e.id, bg: true, text: kid.task, title: name, ...(name ? { nm: name } : {}), ...take() }, e.id)); continue;
      }
      if (kid && raw === 'subagent.send_message') { kid.last = end; if (str(input.message).trim()) push(st, { ts, agent: 'main', to: kid.aid, kind: 'order', toolId: e.id, bg: true, text: str(input.message), title: name }, e.id); continue; }   // one more order to the same sub-agent
      if (kid && raw === 'subagent.wait') { if (open) { waiting = true; continue; } waiting = false; kid.last = end; const said = str(sc.value != null ? sc.value : text(out.content)).trim(); if (said && said !== kid.said) { kid.said = said; push(kid.st, { ts: end, agent: kid.aid, kind: 'say', text: said }, e.id); } continue; }   // what the lead got back when it waited: the sub-agent's words
      if (kid && (raw === 'subagent.stop' || raw === 'subagent.interrupt')) { if (!open && raw === 'subagent.stop' && !kid.done) { kid.done = true; kid.last = end; push(st, { ts: Math.max(end, kid.st.lastTs + 1), agent: 'main', kind: 'agentdone', toolId: kid.spawn }, e.id); } continue; }
    }
    if (raw === 'vibe.todo') { if (input.action === 'write') { st.toolName[e.id] = 'TodoWrite'; lastOf.set(e.turnId, push(st, { ts, agent: 'main', kind: 'tool', tool: toolLabel({ id: e.id, name: 'TodoWrite', input: { todos: (Array.isArray(input.todos) ? input.todos : []).map((x) => ({ content: (x && x.content) || '', status: x && x.status === 'cancelled' ? 'completed' : (x && x.status) || 'pending' })) } }, ts), ...take() }, e.id)); } continue; }
    const name = UNI_TOOLS[raw] || raw || 'tool', rep0 = Array.isArray(input.content) ? input.content.filter((x) => x && typeof x === 'object') : [];
    const args = name === 'Read' ? { file_path: input.path, offset: input.offset, limit: input.limit } : name === 'Write' ? { file_path: input.path || input.file_path, content: str(input.content) } : name === 'Edit' ? { file_path: input.file_path || input.path, old_string: rep0.map((x) => str(x.old_str)).join('\n…\n'), new_string: rep0.map((x) => str(x.new_str)).join('\n…\n') } : name === 'Skill' ? { skill: input.name } : raw === 'process.start' ? { command: str(input.command), run_in_background: true } : input;
    st.toolName[e.id] = name; lastOf.set(e.turnId, push(st, { ts, agent: 'main', kind: 'tool', tool: toolLabel({ id: e.id, name, input: args }, ts), ...take() }, e.id));
    if (open) continue;
    const o = errText ? errText : name === 'Bash' ? [sc.stdout, sc.stderr].filter(Boolean).map(str).join('\n') : name === 'Read' ? str(sc.content) : name === 'Write' ? (sc.bytes_written != null ? sc.bytes_written + ' bytes' : '') : name === 'Edit' ? (sc.lines_changed != null ? sc.lines_changed + ' lines changed' : '') : str(state.outputText) || text(out.content) || (sc.value != null ? str(sc.value) : '');
    push(st, { ts: end, agent: 'main', kind: 'results', items: [{ id: e.id, err: !!failed, out: clip(o.trimEnd(), resultMax[name] || 600) }] }, e.id + '/r');
  }
  const env = u.env || {}, se = env.session || {}, turn = env.latestTurn || {}, idle = se.status && (se.status.type === 'idle' || se.status.type === 'failed');
  for (const [tid, ev] of lastOf) if (ev.kind !== 'agentcall' && (tid !== turn.id || (turn.status && turn.status !== 'in_progress') || idle)) ev.end = 1;   // a turn that is over ends on the last thing the lead said or did in it
  if (idle) for (const k of kids.values()) if (!k.done) { k.done = true; push(st, { ts: Math.max(+turn.completedAt || 0, st.lastTs, k.st.lastTs + 1), agent: 'main', kind: 'agentdone', toolId: k.spawn }, k.spawn + '/done'); }   // the lead's turn is over: so are the sub-agents it had not stopped itself
  const tu = se.tokenUsage && typeof se.tokenUsage === 'object' ? se.tokenUsage : null, cu = se.contextUsage && typeof se.contextUsage === 'object' ? se.contextUsage : {};
  if (tu) {
    let m = usageMemo.get(r.dir); const p = +tu.inputTokens || 0, c = +tu.outputTokens || 0, cr = +tu.cachedInputTokens || 0;
    if (!m || p < m.p || c < m.c) { m = { p: 0, c: 0, r: 0, list: [] }; if (usageMemo.size > 300) usageMemo.delete(usageMemo.keys().next().value); usageMemo.set(r.dir, m); }
    const dp = p - m.p, dc = c - m.c, dr = Math.max(0, cr - m.r);
    if (dp > 0 || dc > 0) {
      const ts = +se.updatedAt || st.lastTs || Date.now(), model = u.model || 'mistral', cached = Math.min(dr, dp), fresh = dp - cached, x = +cu.inputTokens || 0, id = 'v' + (m.list.length + 1);
      if (x > 0 && dp > x) { const xr = Math.min(cached, +cu.cachedInputTokens || 0, x), xi = x - xr; m.list.push(['' + id + 'a', { ts: ts - 1, u: { i: Math.max(0, fresh - xi), o: dc, r: cached - xr, w: 0 }, model }], [id, { ts, u: { i: xi, o: 0, r: xr, w: 0 }, model }]); }   // several requests since the last look: the last line is the size of the context now, which is what the gauge shows
      else m.list.push([id, { ts, u: { i: fresh, o: Math.max(0, dc), r: cached, w: 0 }, model }]);
      m.p = p; m.c = c; m.r = cr;
    }
    for (const [k, v] of m.list) st.msgUsage.set(k, v);
  }
  u.state = { main: st, kids: [...kids.values()], env, waiting }; return u.state;
}
const state = (id) => { const r = row(id); return r && r.uni ? uniState(r).main : null; };   // null: a session in the earlier format, read line by line with parser()

// ---- the earlier format: one line of messages.jsonl → the events of the call
const TOOLS = { bash: 'Bash', read_file: 'Read', write_file: 'Write', edit: 'Edit', search_replace: 'Edit', grep: 'Grep', web_fetch: 'WebFetch', web_search: 'WebSearch', ask_user_question: 'AskUserQuestion', skill: 'Skill', exit_plan_mode: 'ExitPlanMode' };
const TAGS = /<\/?(tool_error|user_cancellation|vibe_stop_event|vibe_warning)>/g;
function parser({ toolLabel, clip, resultMax = {} }) {
  helpers = { toolLabel, clip, resultMax };
  const args = (tc) => { const a = tc && tc.function && tc.function.arguments; if (a && typeof a === 'object') return a; try { const v = JSON.parse(a || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  function output(name, m) {   // what the tool gave back, as it would have appeared on the agent's screen
    const o = m.tool_result && typeof m.tool_result === 'object' && m.tool_result.output && typeof m.tool_result.output === 'object' ? m.tool_result.output : null, text = str(m.content);
    const err = /<tool_error>|<user_cancellation>/.test(text) || !!(m.tool_result && m.tool_result.cancelled) || (o && typeof o.exit_code === 'number' && o.exit_code !== 0);
    let out = text.replace(TAGS, '');
    if (o && !/<tool_error>/.test(text)) {
      if (name === 'Bash') out = [o.stdout, o.stderr].filter(Boolean).map(str).join('\n');
      else if (name === 'Read' || name === 'WebFetch') out = str(o.content != null ? o.content : out);
      else if (name === 'Write') out = o.bytes_written != null ? o.bytes_written + ' bytes' : '';
      else if (name === 'Edit') out = str(o.message || '');
      else if (name === 'Grep') out = str(o.matches != null ? o.matches : out);
      else if (name === 'WebSearch') out = str(o.answer != null ? o.answer : out);
    }
    return { out: out.trimEnd(), err: !!err };
  }
  function record(st, m) {
    if (typeof m.role !== 'string') return;
    const agent = st.agent, vb = st.vb || (st.vb = { batch: [], lines: 0, last: 0, n: 0, stats: null, calls: {} }), line = vb.lines++;
    const push = (e) => { e.ts = 0; e.k = agent + ':' + st.raw.length; st.raw.push(e); vb.batch.push({ e, line }); return e; };   // the time is given in after(), once the whole batch is known
    const th = () => { const t = st.th; st.th = ''; return t ? { th: t } : {}; };
    if (m.context_boundary === 'compaction') { push({ agent, kind: 'compact' }); return; }   // Vibe compacted the conversation: the message is its summary, not something said
    if (m.role === 'user') {
      if (m.injected) return;   // put there by Vibe (a hook, a reminder), not typed
      const sh = m.manual_shell && typeof m.manual_shell === 'object' && typeof m.manual_shell.command === 'string' ? '! ' + m.manual_shell.command : '', text = sh || typed(m);
      if (agent !== 'main') { if (!st.prompt && text && !st.raw.length) { st.prompt = { ts: 0, text }; vb.batch.push({ e: st.prompt, line }); } return; }   // a sub-agent's first message is its order, shown from the side of whoever gave it
      if (text) push({ agent: 'user', kind: 'user', text });
      return;
    }
    if (m.role === 'assistant') {
      const think = str(m.reasoning_content).trim(); if (think) st.th = clip(think.replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\n ]*/g, '\n').trim(), 900);
      const calls = (Array.isArray(m.tool_calls) ? m.tool_calls : []).filter((tc) => tc && typeof tc === 'object' && tc.function && tc.function.name), text = str(m.content).replace(TAGS, '').trim();
      if (text) { const e = push({ agent, kind: 'say', text, ...th() }); if (!calls.length && agent === 'main') e.end = 1; }   // a plain answer, without a tool call, closes the lead's turn
      calls.forEach((tc, i) => {
        const id = String(tc.id || 'vb' + line + '_' + i), raw = String(tc.function.name), a = args(tc);
        if (raw === 'task') { st.toolName[id] = 'Task'; vb.calls[id] = push({ agent, kind: 'agentcall', toolId: id, bg: false, text: str(a.task), title: str(a.agent || 'explore') }); return; }
        if (raw === 'todo') { if (a.action !== 'write') return; st.toolName[id] = 'TodoWrite'; push({ agent, kind: 'tool', tool: toolLabel({ id, name: 'TodoWrite', input: { todos: (Array.isArray(a.todos) ? a.todos : []).map((x) => ({ content: (x && x.content) || '', status: x && x.status === 'cancelled' ? 'completed' : (x && x.status) || 'pending' })) } }, 0), ...th() }); return; }
        const name = TOOLS[raw] || raw, input = name === 'Skill' ? { skill: a.name } : name === 'AskUserQuestion' ? { questions: (Array.isArray(a.questions) ? a.questions : []).map((q) => ({ question: (q && (q.question || q.header)) || '', options: (q && Array.isArray(q.options) && q.options) || [] })) } : a;
        st.toolName[id] = name; vb.calls[id] = push({ agent, kind: 'tool', tool: toolLabel({ id, name, input }, 0), ...th() });
      });
      return;
    }
    if (m.role === 'tool') {
      const id = String(m.tool_call_id || ''), name = st.toolName[id]; if (!id || !name) return;
      const dur = m.tool_result && typeof m.tool_result.duration === 'number' && m.tool_result.duration >= 0 ? m.tool_result.duration * 1000 : -1;
      if (name === 'Task') { push({ agent, kind: 'agentdone', toolId: id }); return; }   // the lead got the sub-agent's answer back: it has finished
      if (name === 'TodoWrite') return;
      const r = output(name, m), e = push({ agent, kind: 'results', items: [{ id, err: r.err, out: clip(r.out, resultMax[name] || 600) }] });
      if (dur >= 0 && vb.calls[id]) e._call = { c: vb.calls[id], dur };
      delete vb.calls[id];
    }
  }
  // The times. A message carries none, so each batch of lines read at once is spread between two known moments: when the previous batch was written (for the first one,
  // when the session started) and when the file was last written. Followed live, a batch is one step of the agent and the times are right to within that step; a session
  // opened afterwards is spread evenly from its start to its end. Two things are known better and used: a sub-agent starts when its own session starts and hands back
  // when its file was last written, and a tool that says how long it took is placed that long before its result.
  record.after = function after(st) {
    const vb = st.vb; if (!vb || !st.file) return; const dir = path.dirname(st.file), m = meta(dir);
    if (vb.batch.length) {
      const end = st.mtime || Date.now(), n = Math.max(1, vb.lines - vb.n); let start = vb.last || m.start || 0; if (!(start > 0) || start >= end) start = end - Math.min(60000, n * 1500);
      const marks = [[-1, start]];   // [line in the batch, time]: the known moments, in order
      for (const { e, line } of vb.batch) {
        if (e.kind !== 'agentcall' && e.kind !== 'agentdone') continue;
        const link = m.children.find((c) => c.tool === e.toolId), cd = link && link.rel ? path.join(dir, link.rel) : '', t = !cd ? 0 : e.kind === 'agentcall' ? meta(cd).start : ((stat(path.join(cd, MESSAGES)) || {}).mtimeMs || -50) + 50;   // handed back just after the last thing the sub-agent wrote, which is its report
        const prev = marks[marks.length - 1]; if (t > prev[1] && t < end && line - vb.n > prev[0]) marks.push([line - vb.n, t]);
      }
      marks.push([n - 1, end]);
      const at = (j) => { let k = 1; while (k < marks.length - 1 && marks[k][0] < j) k++; const [j0, t0] = marks[k - 1], [j1, t1] = marks[k]; return j1 === j0 ? t1 : t0 + ((t1 - t0) * (j - j0)) / (j1 - j0); };
      let seen = -1, off = 0;
      for (const { e, line } of vb.batch) { const j = line - vb.n; off = j === seen ? off + 1 : 0; seen = j; e.ts = Math.round(at(j)) + off; if (e.tool) e.tool.ts = e.ts; }   // events of one line keep their order, a millisecond apart
      for (const { e } of vb.batch) if (e._call) { const { c, dur } = e._call; delete e._call; const t = Math.max(c.ts, Math.round(e.ts - dur)); if (t < e.ts) { c.ts = t; if (c.tool) c.tool.ts = t; } }
      vb.batch = []; vb.n = vb.lines; vb.last = end; if (end > (st.lastTs || 0)) st.lastTs = end;
    }
    const s = m.stats; if (!s) return;   // the totals of the session, which Vibe keeps in meta.json: what was used since the last look is one more line of usage
    const was = vb.stats || { p: 0, c: 0, r: 0 }, dp = s.p - was.p, dc = s.c - was.c, dr = Math.max(0, s.r - was.r); if (dp < 0 || dc < 0) { vb.stats = { p: s.p, c: s.c, r: s.r }; return; }   // the totals went down (a new count after a rewind): start again from here
    if (dp <= 0 && dc <= 0) return; vb.stats = { p: s.p, c: s.c, r: s.r };
    const ts = vb.last || st.mtime || Date.now(), model = m.model || 'mistral', cw = m.cw ? { cw: m.cw } : {}, id = 'v' + (vb.u = (vb.u || 0) + 1), cached = Math.min(dr, dp), fresh = dp - cached;
    if (s.x > 0 && dp > s.x) {   // several requests since the last look: the last line of usage must be the size of the context now, which is what the gauge shows
      const xr = Math.min(cached, s.x), xi = s.x - xr;
      st.msgUsage.set(id + 'a', { ts: ts - 1, u: { i: Math.max(0, fresh - xi), o: dc, r: cached - xr, w: 0 }, model, ...cw }); st.msgUsage.set(id, { ts, u: { i: xi, o: 0, r: xr, w: 0 }, model, ...cw });
    } else st.msgUsage.set(id, { ts, u: { i: fresh, o: Math.max(0, dc), r: cached, w: 0 }, model, ...cw });
  };
  return record;
}
module.exports = { PROJ, SOURCE, home, dirKey, sessions, row, fileOf, inProject, projectLabel, title, boardRow, subFiles, watch, state, parser };
