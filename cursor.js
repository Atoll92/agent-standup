// Cursor Agent CLI sessions (the `agent` / `cursor-agent` command, and Agents Window chats that share the same transcript layout)
// shown as the same call as Claude Code sessions. Nothing is ever written in Cursor's folders.
// Cursor keeps each chat two ways:
// - A readable JSONL transcript at <home>/projects/<slug>/agent-transcripts/<id>/<id>.jsonl (sub-agents in …/subagents/<aid>.jsonl).
//   Each line is { role, message: { content: [{ type: text|tool_use, … }] } } or { type: "turn_ended", status }. Tool results are not
//   written back into the file; tool_use ids are often null. Timestamps, when present, sit inside the text as <timestamp>…</timestamp>.
// - Chat metadata at <home>/chats/<md5(cwd)>/<id>/meta.json (title, cwd, createdAtMs, updatedAtMs). The chats root follows
//   CURSOR_CONFIG_DIR (or $XDG_CONFIG_HOME/cursor); the projects root follows CURSOR_DATA_DIR. A single AGENT_STANDUP_CURSOR folder
//   that holds both projects/ and chats/ is also accepted (the tests, and a home that still uses ~/.cursor for both).
// server.js reads the JSONL with its incremental reader and parser() below. All Cursor sessions are listed under one made-up project, PROJ.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const PROJ = '_cursor', SOURCE = 'cursor';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE = /^[\w][\w.\-]*$/;
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const idOf = (b, fallback) => {   // Cursor often writes tool_use without an id: invent a stable one so the lead's Task call and the sub-agent file stay linked
  if (b && b.id) return String(b.id);
  const task = taskInput(b); if (task && (task.prompt || task.description)) return 'cu_' + crypto.createHash('sha1').update(norm(task.prompt || task.description)).digest('hex').slice(0, 12);
  return fallback;
};
// Where Cursor keeps its files: AGENT_STANDUP_CURSOR (a folder; "0" or "off" turns Cursor sessions off), else $CURSOR_DATA_DIR,
// else $CURSOR_CONFIG_DIR, else ~/.cursor. When AGENT_STANDUP_PROJECTS points the app at one folder of Claude Code sessions (--projects, the tests),
// Cursor is only read if it is asked for too.
function home() {
  const v = process.env.AGENT_STANDUP_CURSOR;
  if (v != null) return /^(0|off|no|false)?$/i.test(v.trim()) ? null : v;
  if (process.env.AGENT_STANDUP_PROJECTS) return null;
  return process.env.CURSOR_DATA_DIR || process.env.CURSOR_CONFIG_DIR || path.join(os.homedir(), '.cursor');
}
// Prefer the same root as home() when both live under ~/.cursor (the common case); CURSOR_CONFIG_DIR alone still points chats elsewhere.
function chatsRoot() {
  const h = home(); if (!h) return null;
  if (process.env.AGENT_STANDUP_CURSOR) return h;
  if (process.env.CURSOR_CONFIG_DIR) return process.env.CURSOR_CONFIG_DIR;
  if (fs.existsSync(path.join(h, 'chats'))) return h;
  const xdg = process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, 'cursor') : path.join(os.homedir(), '.config', 'cursor');
  return fs.existsSync(path.join(xdg, 'chats')) ? xdg : h;
}
const dirKey = (cwd) => String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
const stat = (f) => { try { return fs.statSync(f); } catch { return null; } };

// ---- finding the sessions
let memo = { at: 0, home: undefined, rows: [], byId: new Map() };
function scan() {
  const h = home(), now = Date.now(); if (memo.home === h && now - memo.at < 2000) return memo;
  const rows = [], byId = new Map(), root = h ? path.join(h, 'projects') : '';
  let projs = []; if (root) { try { projs = fs.readdirSync(root, { withFileTypes: true }); } catch {} }
  for (const p of projs) {
    if (!p.isDirectory()) continue;
    const base = path.join(root, p.name, 'agent-transcripts'); let names = []; try { names = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of names) {
      if (!e.isDirectory() || !UUID.test(e.name)) continue;
      const id = e.name.toLowerCase(), dir = path.join(base, e.name), file = path.join(dir, e.name + '.jsonl'), st = stat(file); if (!st || !st.isFile()) continue;
      if (byId.has(id)) continue;   // the same id under two project slugs: keep the first (newest walk order does not matter; meta.json says the folder)
      const row = { id, dir, file, mtime: st.mtimeMs, size: st.size, slug: p.name }; rows.push(row); byId.set(id, row);
    }
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  memo = { at: now, home: h, rows, byId }; return memo;
}
const row = (id) => scan().byId.get(String(id).toLowerCase()) || null;
const fileOf = (id) => { const r = row(id); return r ? r.file : ''; };

// ---- meta.json under chats/: title and cwd. Indexed by session id, refreshed with the scan.
let metaMemo = { at: 0, root: undefined, byId: new Map() };
function metaScan() {
  const root = chatsRoot(), now = Date.now(); if (metaMemo.root === root && now - metaMemo.at < 2000) return metaMemo.byId;
  const byId = new Map(); let hashes = []; if (root) { try { hashes = fs.readdirSync(path.join(root, 'chats'), { withFileTypes: true }); } catch {} }
  for (const h of hashes) {
    if (!h.isDirectory()) continue;
    let ids = []; try { ids = fs.readdirSync(path.join(root, 'chats', h.name), { withFileTypes: true }); } catch { continue; }
    for (const e of ids) {
      if (!e.isDirectory() || !UUID.test(e.name)) continue;
      const f = path.join(root, 'chats', h.name, e.name, 'meta.json'), st = stat(f); if (!st) continue;
      let j = null; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
      if (!j || typeof j !== 'object') continue;
      byId.set(e.name.toLowerCase(), {
        title: typeof j.title === 'string' ? j.title.trim() : '',
        cwd: typeof j.cwd === 'string' ? j.cwd : '',
        created: +j.createdAtMs || 0, updated: +j.updatedAtMs || 0, hash: h.name, mtime: st.mtimeMs,
      });
    }
  }
  metaMemo = { at: now, root, byId }; return byId;
}
const metaOf = (id) => metaScan().get(String(id).toLowerCase()) || { title: '', cwd: '', created: 0, updated: 0 };
// A project slug is usually the cwd with non-alnum turned into "-". When meta.json is missing, recover a plausible path from it.
function cwdFromSlug(slug) {
  if (!slug || typeof slug !== 'string') return '';
  const parts = slug.split('-').filter(Boolean); if (!parts.length) return '';
  if (parts[0] === 'root' || parts[0] === 'home') {   // /root/… or /home/…
    const abs = '/' + parts.join('/'); if (stat(abs)) return abs;
    // try joining progressively when a segment had a hyphen (agent-standup-cursor → agent/standup/cursor fails; keep as agent-standup-cursor under parent)
  }
  return '';
}
const cwd = (id) => { const m = metaOf(id); if (m.cwd) return m.cwd; const r = row(id); return r ? cwdFromSlug(r.slug) : ''; };
const under = (cwd, key) => { for (let d = String(cwd || ''); d;) { if (dirKey(d) === key) return true; const up = path.dirname(d); if (up === d) return false; d = up; } return false; };
const inProject = (id, key) => { if (!row(id) || !key) return false; if (key === PROJ) return true; const c = cwd(id), d = dirKey(c); return d === key || (d.startsWith(key + '-') && under(c, key)); };
const projectLabel = (cwd) => { const h = os.homedir(), rel = cwd && cwd.startsWith(h + path.sep) ? cwd.slice(h.length + 1) : cwd; return 'Cursor' + (rel ? ' · ' + rel.split(path.sep).join('/') : ''); };

function sessions(limit = 80) {
  return scan().rows.slice(0, limit).map((r) => { const m = metaOf(r.id), c = m.cwd || cwdFromSlug(r.slug); return { ...r, cwd: c, dir: dirKey(c), mtime: Math.max(r.mtime, m.updated || 0) }; });
}

// ---- names: the title in meta.json, else the first <user_query>
const readPart = (file, from, len) => { let fd; try { fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(len), n = fs.readSync(fd, buf, 0, len, from); return buf.subarray(0, n).toString('utf8'); } catch { return ''; } finally { if (fd != null) fs.closeSync(fd); } };
const TS_RE = /<timestamp>\s*([^<]+?)\s*<\/timestamp>/i;
const QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i;
const parseTs = (s) => { const m = TS_RE.exec(String(s || '')); if (!m) return 0; const t = Date.parse(m[1].replace(/\s*\(UTC\)\s*$/i, ' UTC').replace(/\s+at\s+/i, ' ')); return Number.isFinite(t) ? t : 0; };
const queryOf = (s) => { const m = QUERY_RE.exec(String(s || '')); return m ? m[1].trim() : ''; };
function typed(s) {
  let t = String(s || ''); const q = queryOf(t); if (q) return q;
  t = t.replace(TS_RE, '').replace(/<\/?(?:user_info|rules|agent_skills|agent_transcripts|available_subagent_types|available_subagent_models|dynamic_tools|manually_attached_skills|system_reminder)[^>]*>[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<\/?[a-zA-Z_][\w:-]*[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}
const promptCache = new Map();
function firstPrompt(file, size) {
  const hit = promptCache.get(file); if (hit != null) return hit;
  let out = '';
  for (const l of readPart(file, 0, Math.min(1024 * 1024, size)).split('\n')) {
    if (!l.includes('"user"')) continue; let j; try { j = JSON.parse(l); } catch { continue; }
    if (j && j.role === 'user') { const blocks = (((j.message || {}).content) || []); const text = Array.isArray(blocks) ? blocks.map((b) => (b && b.type === 'text' ? b.text : '')).join('\n') : ''; const t = typed(text); if (t) { out = t.replace(/\s+/g, ' ').slice(0, 90); break; } }
  }
  if (out || size > 64 * 1024) { if (promptCache.size > 2000) promptCache.clear(); promptCache.set(file, out); }
  return out;
}
const brief = (s) => { const m = /^(.{8,70}?)[.!?](\s|$)/.exec(s); if (m) return m[1]; if (s.length <= 56) return s; const cut = s.slice(0, 56), sp = cut.lastIndexOf(' '); return (sp > 30 ? cut.slice(0, sp) : cut) + '…'; };
const title = (r) => metaOf(r.id).title || firstPrompt(r.file, r.size) || r.id;

// ---- sub-agents
function subFiles(id) {
  const out = []; out.dirs = []; out.journals = []; const r = row(id); if (!r) return out;
  const ad = path.join(r.dir, 'subagents'); out.dirs.push(ad);
  let names; try { names = fs.readdirSync(ad, { withFileTypes: true }); } catch { return out; }
  const links = taskLinks(r);   // Task / CallDynamicTool→Task calls of the lead, matched to a child by the prompt
  for (const e of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    const aid = e.name.replace(/\.jsonl$/i, ''); if (!SAFE.test(aid) && !UUID.test(aid)) continue;
    const file = path.join(ad, e.name), st = stat(file); if (!st) continue;
    const prompt = firstPrompt(file, st.size), link = links.find((c) => c.aid === aid) || links.find((c) => c.prompt && prompt && (prompt.startsWith(c.prompt.slice(0, 80)) || c.prompt.startsWith(prompt.slice(0, 80)))) || null;
    out.push({ file, aid, id0: aid, run: '', meta: { agentType: (link && link.type) || 'agent', description: brief((link && link.desc) || prompt) || (link && link.type) || 'agent', ...(link && link.tool ? { toolUseId: link.tool } : {}) } });
  }
  return out;
}
const subCount = (id) => subFiles(id).length;
const taskCache = new Map();   // main file → { sig, links }
function taskInput(b) {
  if (!b || b.type !== 'tool_use') return null;
  if (b.name === 'Task' || b.name === 'Agent') return b.input && typeof b.input === 'object' ? b.input : null;
  if (b.name === 'CallDynamicTool' && b.input && b.input.toolName === 'Task') {
    const a = b.input.arguments; return a && typeof a === 'object' ? a : null;
  }
  return null;
}
function taskLinks(r) {
  const sig = r.mtime + ':' + r.size; const hit = taskCache.get(r.file); if (hit && hit.sig === sig) return hit.links;
  const links = [], text = readPart(r.file, 0, Math.min(2 * 1024 * 1024, r.size)); let n = 0;
  for (const l of text.split('\n')) {
    if (!l.includes('"tool_use"')) continue; let j; try { j = JSON.parse(l); } catch { continue; }
    const blocks = Array.isArray(((j.message || {}).content)) ? j.message.content : [];
    blocks.forEach((b, i) => {
      if (!b || b.type !== 'tool_use') return;
      const task = taskInput(b); if (!task) return;
      links.push({ tool: idOf(b, 'cu' + n + '_' + i), aid: '', prompt: norm(task.prompt || ''), desc: String(task.description || '').trim(), type: String(task.subagent_type || task.subagentType || 'agent') });
    });
    n++;
  }
  // Match each link to a subagent file whose first prompt overlaps (whitespace normalised: the JSONL keeps newlines, firstPrompt collapses them)
  const kids = []; try { for (const e of fs.readdirSync(path.join(r.dir, 'subagents'))) if (e.endsWith('.jsonl')) { const f = path.join(r.dir, 'subagents', e), st = stat(f); if (st) kids.push({ aid: e.replace(/\.jsonl$/i, ''), prompt: norm(firstPrompt(f, st.size)) }); } } catch {}
  for (const c of links) {
    const p = norm(c.prompt); if (!p) continue;
    const k = kids.find((x) => x.prompt && (x.prompt.startsWith(p.slice(0, 80)) || p.startsWith(x.prompt.slice(0, 80))));
    if (k) { c.aid = k.aid; kids.splice(kids.indexOf(k), 1); }
  }
  if (taskCache.size > 500) taskCache.clear(); taskCache.set(r.file, { sig, links }); return links;
}
const watch = (id) => { const r = row(id); if (!r) return []; const m = metaOf(r.id), root = chatsRoot(); return m.hash && root ? [path.join(root, 'chats', m.hash, r.id, 'meta.json')] : []; };

// ---- the board
const tailCache = new Map();
function boardRow(r, now) {
  const sig = r.mtime + ':' + r.size; let t = tailCache.get(r.file);
  if (!t || t.sig !== sig) {
    const was = t; t = { sig, turn: '', asked: (was && was.asked) || 0, ask: '', askTs: 0 };
    const n = Math.min(256 * 1024, r.size), text = readPart(r.file, Math.max(0, r.size - n), n);
    tailOf(text, t, r);
    if (tailCache.size > 200) tailCache.delete(tailCache.keys().next().value); tailCache.set(r.file, t);
  }
  const kids = subFiles(r.id), newest = Math.max(r.mtime, metaOf(r.id).updated || 0, ...kids.map((k) => (stat(k.file) || {}).mtimeMs || 0));
  const age = now - newest, live = kids.filter((k) => now - ((stat(k.file) || {}).mtimeMs || 0) < 10 * 60e3).length;
  let state = 'idle';
  if (t.ask && age < 4 * 3600e3) state = 'blocked';
  else if (age >= 30 * 60e3) state = 'idle';
  else if (t.turn === 'closed') state = 'turn';
  else if (age < 10 * 60e3 || live) state = live && t.turn === 'closed' ? 'waiting' : 'working';
  const open = t.ask ? { id: 'ask' + (t.askTs || newest), tool: 'AskUserQuestion', kind: 'question', questions: [{ q: t.ask }], sure: 1 } : null;
  return { proj: PROJ, id: r.id, title: title(r), mtime: newest, state, tool: t.ask ? 'AskUserQuestion' : '', ageMs: age, subActive: state === 'idle' || state === 'turn' ? 0 : live, subTotal: kids.length, asked: t.asked || 0, dir: dirKey(cwd(r.id)), source: SOURCE, ...(state === 'blocked' ? { sure: 1, since: t.askTs || newest, ask: t.ask } : {}), ...(open ? { menu: open } : {}) };
}
function tailOf(text, t, r) {
  let lastRole = '', lastTools = [], ended = false, endTs = 0;
  for (const l of text.split('\n')) {
    if (!l) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j && j.type === 'turn_ended') { ended = true; lastTools = []; endTs = r.mtime; if (j.status === 'aborted' || j.status === 'error') t.cut = 1; continue; }
    if (!j || typeof j.role !== 'string') continue;
    ended = false; lastRole = j.role;
    const blocks = Array.isArray(((j.message || {}).content)) ? j.message.content : [];
    if (j.role === 'user') {
      const text = blocks.map((b) => (b && b.type === 'text' ? b.text : '')).join('\n'); const ts = parseTs(text) || r.mtime;
      if (typed(text)) t.asked = Math.max(t.asked, ts); lastTools = []; t.ask = ''; t.askTs = 0;
    } else if (j.role === 'assistant') {
      lastTools = blocks.filter((b) => b && b.type === 'tool_use');
      const ask = lastTools.find((b) => b.name === 'AskQuestion' || b.name === 'AskUserQuestion');
      if (ask) { t.ask = askQuestionText(ask); t.askTs = parseTs(blocks.map((b) => (b && b.type === 'text' ? b.text : '')).join('\n')) || r.mtime; }
      else { t.ask = ''; t.askTs = 0; }
    }
  }
  t.turn = ended || (lastRole === 'assistant' && !lastTools.length) ? 'closed' : 'open';
  return t;
}
function askQuestionText(b) {
  const i = (b && b.input) || {}, qs = Array.isArray(i.questions) ? i.questions : [];
  const q0 = qs[0]; if (!q0) return String(i.title || '').trim().slice(0, 200);
  return String(q0.prompt || q0.question || i.title || '').trim().slice(0, 200);
}

// ---- one JSONL record → the events of the call
const TOOLS = { Shell: 'Bash', AskQuestion: 'AskUserQuestion', StrReplace: 'Edit', Delete: 'Delete', Grep: 'Grep', Glob: 'Glob', Read: 'Read', Write: 'Write', WebFetch: 'WebFetch', WebSearch: 'WebSearch', EditNotebook: 'EditNotebook', TodoWrite: 'TodoWrite' };
function parser({ toolLabel, clip, resultMax = {} }) {
  function record(st, r) {
    const agent = st.agent, cx = st.cx || (st.cx = { n: 0, last: 0, batch: [] });
    const push = (e) => { e.ts = e.ts || 0; e.k = agent + ':' + st.raw.length; st.raw.push(e); cx.batch.push(e); if (e.ts > cx.last) cx.last = e.ts; return e; };
    const th = () => { const t = st.th; st.th = ''; return t ? { th: t } : {}; };
    if (r && r.type === 'turn_ended') {
      for (let i = st.raw.length - 1; i >= 0; i--) { const e = st.raw[i]; if (e.agent === agent && (e.kind === 'say' || e.kind === 'tool' || e.kind === 'agentcall')) { e.end = 1; break; } }
      if (r.status === 'aborted' || r.status === 'error') st.cut = 1;
      return;
    }
    if (!r || typeof r.role !== 'string') return;
    const blocks = Array.isArray(((r.message || {}).content)) ? r.message.content : typeof ((r.message || {}).content) === 'string' ? [{ type: 'text', text: r.message.content }] : [];
    const texts = blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
    const joined = texts.join('\n'), ts = parseTs(joined) || 0; cx.n++;
    if (r.role === 'user') {
      const text = typed(joined); if (!text) return;
      if (agent !== 'main') { if (!st.prompt && !st.raw.length) { st.prompt = { ts, text }; cx.batch.push(st.prompt); } return; }
      push({ ts, agent: 'user', kind: 'user', text });
      return;
    }
    if (r.role !== 'assistant') return;
    const tools = blocks.filter((b) => b && b.type === 'tool_use');
    const say = texts.map((t) => t.replace(TS_RE, '').trim()).filter(Boolean).join('\n').trim();
    if (say) { const e = push({ ts, agent, kind: 'say', text: say, ...th() }); if (!tools.length && agent === 'main') e.end = 1; }
    tools.forEach((b, i) => {
      const id = idOf(b, 'cu' + cx.n + '_' + i), task = taskInput(b);
      if (task) {
        st.toolName[id] = 'Task';
        push({ ts, agent, kind: 'agentcall', toolId: id, bg: !!(task.run_in_background === true || task.run_in_background === 'true'), text: String(task.prompt || task.description || ''), title: String(task.description || task.subagent_type || 'agent'), ...(task.description || task.subagent_type ? { nm: String(task.description || task.subagent_type) } : {}), ...th() });
        return;
      }
      let name = TOOLS[b.name] || b.name || 'tool', input = b.input && typeof b.input === 'object' ? { ...b.input } : {};
      if (b.name === 'CallDynamicTool' && input.toolName) { name = String(input.namespace ? input.namespace + '__' + input.toolName : input.toolName); input = input.arguments && typeof input.arguments === 'object' ? input.arguments : input; }
      if (name === 'AskUserQuestion' || b.name === 'AskQuestion') {
        const qs = Array.isArray(input.questions) ? input.questions : [];
        input = { questions: qs.map((q) => ({ question: (q && (q.prompt || q.question)) || '', header: (q && (q.header || input.title)) || '', options: (q && Array.isArray(q.options) ? q.options : []).map((o) => ({ label: (o && o.label) || '', description: (o && (o.description || o.id)) || '' })) })) };
        name = 'AskUserQuestion';
      }
      if (name === 'Bash' || b.name === 'Shell') input = { command: input.command || input.cmd || '', description: input.description, working_directory: input.working_directory };
      if (name === 'Edit' || b.name === 'StrReplace') input = { file_path: input.path || input.file_path || input.filePath, old_string: input.old_string || input.oldString, new_string: input.new_string || input.newString };
      if (name === 'Read') input = { file_path: input.path || input.file_path || input.filePath, offset: input.offset, limit: input.limit };
      if (name === 'Write') input = { file_path: input.path || input.file_path || input.filePath, content: input.contents != null ? input.contents : input.content };
      if (name === 'TodoWrite') return;   // same as Claude Code: listed only when useful; Cursor's shape varies
      st.toolName[id] = name; push({ ts, agent, kind: 'tool', tool: toolLabel({ id, name, input }, ts), ...th() });
    });
  }
  // Times: a line often has none. Spread each batch between the last known time (or meta.created / file start) and the file's mtime, like Vibe's earlier format.
  record.after = function after(st) {
    const cx = st.cx; if (!cx || !cx.batch.length || !st.file) return;
    const end = st.mtime || Date.now(); let start = cx.lastMarked || 0;
    if (!(start > 0)) { const id = path.basename(st.file, '.jsonl'), m = metaOf(id); start = m.created || (end - Math.min(60000, cx.batch.length * 1500)); }
    if (!(start > 0) || start >= end) start = end - Math.min(60000, cx.batch.length * 1500);
    const known = cx.batch.map((e, i) => (e.ts > 0 ? [i, e.ts] : null)).filter(Boolean);
    const marks = [[-1, start], ...known.filter((m) => m[1] > start && m[1] < end), [cx.batch.length - 1, end]];
    const at = (j) => { let k = 1; while (k < marks.length - 1 && marks[k][0] < j) k++; const [j0, t0] = marks[k - 1], [j1, t1] = marks[k]; return j1 === j0 ? t1 : t0 + ((t1 - t0) * (j - j0)) / (j1 - j0); };
    let seen = -1, off = 0;
    cx.batch.forEach((e, j) => { if (e.ts > 0) { seen = j; off = 0; return; } off = j === seen ? off + 1 : 0; seen = j; e.ts = Math.round(at(j)) + off; if (e.tool) e.tool.ts = e.ts; });
    cx.lastMarked = end; cx.batch = []; if (end > (st.lastTs || 0)) st.lastTs = end;
  };
  return record;
}

module.exports = { PROJ, SOURCE, home, dirKey, sessions, row, fileOf, cwd, inProject, projectLabel, title, boardRow, subFiles, subCount, watch, parser, chatsRoot, metaOf };
