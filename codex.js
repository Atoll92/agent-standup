// Codex sessions (OpenAI's Codex: the desktop app and the command line) shown as the same call as Claude Code sessions.
// Codex writes one "rollout" file per thread in <home>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl, and the desktop app later compresses a thread nobody uses (…jsonl.zst, read whole: see
// "compressed threads" below). Nothing is ever written there, and nothing else in the Codex folder is read
// but session_index.jsonl (the names of the threads). server.js reads the files with its own incremental reader and hands each record to parser() below, which turns it into the
// events a Claude Code record gives (say, user, tool, results, usage, compact), so everything after that is shared: the timeline, the live feed, the page.
// All Codex sessions are listed under one made-up project, PROJ. No Claude Code project folder can have that name: theirs are paths with every other character turned into "-".
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const PROJ = '_codex', SOURCE = 'codex';
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
const NAME = /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(\.zst)?$/i;
const zstd = () => (typeof zlib.zstdDecompressSync === 'function' ? zlib.zstdDecompressSync : null);   // Node 22.15 / 23.8 and later. With an older one (some VS Code and Electron versions) the compressed threads are left out, as before they were read
let memo = { at: 0, home: undefined, rows: [], byId: new Map() };
function scan() {   // every rollout file with its date and size, newest first; shared by all the polls of two seconds
  const h = home(), now = Date.now(); if (memo.home === h && now - memo.at < 2000) return memo;
  const byId = new Map(), z = !!zstd();
  const walk = (dir, depth) => {
    let names; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4) walk(fp, depth + 1); continue; }
      const m = NAME.exec(e.name); if (!m || (m[2] && !z)) continue;
      const id = m[1].toLowerCase(), was = byId.get(id); if (was && (!was.zst || m[2])) continue;   // a thread in both forms for a moment (being compressed, or opened again): the plain file is the live one
      let st; try { st = fs.statSync(fp); } catch { continue; }
      byId.set(id, { id, file: fp, mtime: st.mtimeMs, size: st.size, ...(m[2] ? { zst: true } : {}) });
    }
  };
  if (h) walk(path.join(h, 'sessions'), 0);
  const rows = [...byId.values()]; rows.sort((a, b) => b.mtime - a.mtime);
  memo = { at: now, home: h, rows, byId }; return memo;
}
const row = (id) => scan().byId.get(String(id).toLowerCase()) || null;
const fileOf = (id) => { let r = row(id); if (r && !fs.existsSync(r.file)) { memo.at = 0; r = row(id); } return r ? r.file : null; };   // a file that is gone (Codex compressed the thread while it was open): looked for again at once

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
  if (/\.zst$/i.test(file)) { const z = zFacts(file); if (!z) return { ok: false, cwd: '', dir: '', child: false }; if (headCache.size > 5000) headCache.clear(); headCache.set(file, z.head); return z.head; }   // the first line of a compressed thread never changes either
  const { text, whole, capped } = firstLine(file), out = headOf(text, capped);
  if (text && (whole || capped)) { if (headCache.size > 5000) headCache.clear(); headCache.set(file, out); }   // a first line still being written is read again next time
  return out;
}
function headOf(text, capped) {
  let out = { ok: false, cwd: '', dir: '', child: false };
  if (!text) return out;   // not written yet: looked at again next time
  let p = null; try { const r = JSON.parse(text); if (r && r.type === 'session_meta' && r.payload && typeof r.payload === 'object') p = r.payload; } catch {}
  if (p) {
    const sub = p.source && typeof p.source === 'object' && p.source.subagent, spawn = sub && typeof sub.thread_spawn === 'object' && sub.thread_spawn;
    out = { ok: true, cwd: typeof p.cwd === 'string' ? p.cwd : '', child: !!p.parent_thread_id || !!sub };
    if (spawn) Object.assign(out, { parent: String(spawn.parent_thread_id || p.parent_thread_id || '').toLowerCase(), born: Date.parse(p.timestamp) || 0,
      name: String(p.agent_nickname || spawn.agent_nickname || ''), role: String(p.agent_role || spawn.agent_role || 'agent'), task: String(spawn.agent_path || '').split('/').pop() || '' });
  }
  else if (capped && /^\{"timestamp":"[^"]*","(?:ordinal":\d+,")?type":"session_meta"/.test(text)) {   // a first line longer than what was read: the two facts, without the rest
    const cwd = text.match(/"cwd":"((?:[^"\\]|\\.)*)"/); let c = ''; try { c = cwd ? JSON.parse('"' + cwd[1] + '"') : ''; } catch {}
    out = { ok: true, cwd: c, child: /"parent_thread_id":"[^"]+"/.test(text) || /"source":\{"subagent"/.test(text) };
  }
  out.dir = dirKey(out.cwd);
  return out;
}
// Only explicit thread_spawn relationships are team members. Guardian/approval reviews and unrelated sessions never join a call.
let familyMemo = { scan: null, children: new Map() };
function descendants(id) {
  const s = scan();
  if (familyMemo.scan !== s) {
    const children = new Map();
    for (const r of s.rows) { const h = head(r.file); if (!h.parent || h.parent === r.id) continue; const list = children.get(h.parent) || []; list.push({ ...r, h }); children.set(h.parent, list); }
    familyMemo = { scan: s, children };
  }
  const out = [], seen = new Set([id]), pending = [id];
  for (let i = 0; i < pending.length; i++) for (const r of familyMemo.children.get(pending[i]) || []) {
    if (seen.has(r.id)) continue; seen.add(r.id); pending.push(r.id); out.push(r);
  }
  return out.sort((a, b) => a.h.born - b.h.born || a.id.localeCompare(b.id));
}
function subFiles(id) {
  const out = descendants(id).map((r) => ({ file: r.file, aid: r.id, mtime: r.mtime,
    meta: { agentType: r.h.role, description: r.h.task || r.h.role, name: r.h.name || r.h.task, parent: r.h.parent === id ? 'main' : r.h.parent, startedAt: r.h.born },
    ...(r.zst ? { st: state(r.id, r.id) } : {}) }));
  out.dirs = []; out.journals = []; return out;
}
// The threads a person started, newest first. A thread started by another thread (Codex's review of a command before it runs, a sub-agent) is not a session of its own.
function sessions(limit = 80) {
  const out = []; for (const r of scan().rows) { const h = head(r.file); if (!h.ok || h.child) continue; out.push({ ...r, mtime: Math.max(r.mtime, ...descendants(r.id).map((k) => k.mtime)), cwd: h.cwd, dir: h.dir }); }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}
const under = (cwd, key) => { for (let d = String(cwd || ''); d;) { if (dirKey(d) === key) return true; const up = path.dirname(d); if (up === d) return false; d = up; } return false; };   // key is the folder itself or one above it: a dashed name alone cannot tell app/old (inside app) from app-old (beside it)
const inProject = (id, key) => { const r = row(id); if (!r || !key) return false; if (key === PROJ) return true; const h = head(r.file), d = h.dir; return d === key || (d.startsWith(key + '-') && under(h.cwd, key)); };
const cwd = (id) => { const r = row(id); return r ? head(r.file).cwd : ''; };   // the folder the session was started in: where a file it names by a relative path is
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
// ---- pictures: those a call brought back, and those the person pasted, each { type, data (base64) }. The call counts them (img) and /api/media serves them (image, below), from the rollout itself.
// An MCP call's own (computer use: a screenshot, and the one its browser keeps of the page), a picture made (image_gen), and the parts of a raw output ("input_image", a data: address).
const DATA_IMG = /^data:(image\/(?:png|jpeg|gif|webp));base64,/;
const partImages = (c) => (Array.isArray(c) ? c : []).map((x) => { const m = x && x.type === 'input_image' && typeof x.image_url === 'string' ? DATA_IMG.exec(x.image_url.slice(0, 40)) : null; return m ? { type: m[1], data: x.image_url.slice(m[0].length) } : null; }).filter(Boolean);
function mcpImages(it) {
  const res = it && it.result && typeof it.result === 'object' ? it.result : {}, out = (Array.isArray(res.content) ? res.content : []).filter((x) => x && x.type === 'image' && typeof x.data === 'string' && /^image\/(png|jpeg|gif|webp)$/.test(x.mimeType)).map((x) => ({ type: x.mimeType, data: x.data }));
  const shot = res._meta && res._meta['codex/toolSurface'] && res._meta['codex/toolSurface'].screenshot, m = shot && typeof shot.url === 'string' ? DATA_IMG.exec(shot.url.slice(0, 40)) : null;
  if (m) out.push({ type: m[1], data: shot.url.slice(m[0].length) });
  return out;
}
const genImages = (it) => (it && typeof it.result === 'string' && it.result.length > 64 ? [{ type: 'image/png', data: it.result }] : []);   // image_gen: the picture itself, base64
const localImages = (c) => (Array.isArray(c) ? c.filter((x) => x && x.type === 'local_image').length : 0);   // what the person pasted, named by its path; the raw message of the same turn carries the pictures
const filePath = (p) => { if (typeof p !== 'string' || !/^file:\/\//i.test(p)) return p; try { return require('url').fileURLToPath(p); } catch { return p; } };   // an ImageView names its picture by a file: address
const hunksOf = (d) => { const out = []; let h = null; for (const l of String(d || '').split('\n')) { const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l); if (m) out.push((h = { oldStart: +m[1], newStart: +m[2], lines: [] })); else if (h && /^[ +\-]/.test(l)) h.lines.push(l); } return out; };   // the parts of a unified diff, as Claude Code notes them (structuredPatch)
// A script of the model that looks at pictures (view_image) writes an ImageView item for each, then its output carries them, in the same order: they are matched when there are as many of each.
const viewMatch = (views, parts) => { const im = partImages(parts); return views.length && im.length === views.length ? im : null; };
const promptCache = new Map();   // file → the first prompt ('' = looked for in the first megabyte and not there)
function firstPrompt(r) {
  if (r.zst) { const z = zFacts(r.file); return z ? z.prompt : ''; }
  const hit = promptCache.get(r.file); if (hit != null) return hit;
  let text = ''; try { const fd = fs.openSync(r.file, 'r'); try { const buf = Buffer.alloc(Math.min(1024 * 1024, r.size)); fs.readSync(fd, buf, 0, buf.length, 0); text = buf.toString('utf8'); } finally { fs.closeSync(fd); } } catch {}
  const out = promptOf(text);
  if (out || r.size > 64 * 1024) { if (promptCache.size > 2000) promptCache.clear(); promptCache.set(r.file, out); }   // a file that has just been created is looked at again
  return out;
}
function promptOf(text) {   // the first thing the person typed in the first megabyte of a file
  let out = '';
  for (const l of text.split('\n')) {
    if (!l.includes('"UserMessage"') && !l.includes('"user_message"')) continue; let j; try { j = JSON.parse(l); } catch { continue; }
    const p = (j && j.payload) || {}, t = p.type === 'user_message' ? typed(p.message) : p.type === 'item_completed' && p.item && p.item.type === 'UserMessage' ? typed(partsText(p.item.content)) : '';
    if (t) { out = t.replace(/\s+/g, ' ').slice(0, 90); break; }
  }
  return out;
}
const title = (r) => threadNames().get(r.id) || firstPrompt(r) || r.id;

// ---- the board: is the agent in the middle of a turn, or is it the person's turn? Read from the end of the file.
const tailCache = new Map();
function tailState(r) {
  const sig = r.mtime + ':' + r.size; let t = r.zst ? zFacts(r.file) || { turn: 'closed', asked: 0 } : tailCache.get(r.file);   // a compressed thread not read yet: Codex compresses only a thread nobody uses
  if (!r.zst && (!t || t.sig !== sig)) {
    t = { sig, turn: '', asked: (t && t.asked) || 0 };   // asked: when the person last typed something there, which is what moves the live call (see currentSession in server.js)
    try {
      const fd = fs.openSync(r.file, 'r'); let text = ''; try { const n = Math.min(128 * 1024, r.size), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, r.size - n); text = buf.toString('utf8'); } finally { fs.closeSync(fd); }
      tailOf(text, t);
    } catch {}
    if (tailCache.size > 200) tailCache.delete(tailCache.keys().next().value); tailCache.set(r.file, t);
  }
  return t;
}
function boardRow(r, now) {
  const t = tailState(r), kids = descendants(r.id), subActive = kids.filter((k) => now - k.mtime < 10 * 60e3 && tailState(k).turn !== 'closed').length;
  const mtime = Math.max(r.mtime, ...kids.map((k) => k.mtime)), age = now - mtime, state = subActive ? 'working' : age >= 30 * 60e3 ? 'idle' : t.turn === 'closed' ? 'turn' : age < 10 * 60e3 ? 'working' : 'idle';
  return { proj: PROJ, id: r.id, title: title(r), mtime, state, tool: '', ageMs: age, subActive, subTotal: kids.length, asked: t.asked, dir: r.dir, source: 'codex' };
}
function tailOf(text, t) {   // the end of a file: whether the last turn is open or over (t.turn), and when the person last typed something (t.asked)
  for (const l of text.split('\n')) { const m = /"type":"(task_started|task_complete|turn_started|turn_complete|turn_aborted)"/.exec(l.slice(0, 400)); if (m && l.includes('"event_msg"')) t.turn = /started/.test(m[1]) ? 'open' : 'closed';
    if (l.includes('"UserMessage"') || l.includes('"user_message"')) { try { const j = JSON.parse(l), p = (j && j.payload) || {}; if (p.type === 'user_message' ? typed(p.message) : p.type === 'item_completed' && p.item && p.item.type === 'UserMessage' && typed(partsText(p.item.content))) t.asked = Math.max(t.asked, Date.parse(j.timestamp) || 0); } catch {} } }   // a first line cut in two does not parse
  return t;
}

// ---- compressed threads (…jsonl.zst). Codex no longer writes to them. What the list and the board need of one (zFacts) is read once in the background, from a stream that
// keeps only its first megabyte and its last 128 KB: a thread can be 78 MB uncompressed, and the first look at the list would otherwise hold every thread in memory and the server
// with it. Until then the thread is not listed (a second at most). The events of a thread opened in a call are read whole, at once (state(), which server.js asks before
// reading a file line by line), and kept for the last two only.
const ZMAX = 512 * 1024 * 1024, MB = 1024 * 1024, ZTAIL = 128 * 1024;   // ZMAX: more than that uncompressed is not a thread: left out rather than filling the memory
const unzst = (file) => { const z = zstd(); return z ? z(fs.readFileSync(file), { maxOutputLength: ZMAX }) : null; };
const zCache = new Map();   // compressed file → { sig, head, prompt, turn, asked }, or { sig, bad } for one that could not be read (looked at again once it changes)
const zQueue = [], zQueued = new Set(); let zBusy = false;
function zFacts(file) {   // null while it is being read
  let sig; try { const s = fs.statSync(file); sig = s.mtimeMs + ':' + s.size; } catch { return null; }
  const hit = zCache.get(file); if (hit && hit.sig === sig) return hit.bad ? null : hit;
  if (!zQueued.has(file) && typeof zlib.createZstdDecompress === 'function') { zQueued.add(file); zQueue.push(file); zNext(); }
  return null;
}
function zNext() {   // one file at a time
  if (zBusy || !zQueue.length) return; zBusy = true;
  const file = zQueue.shift(), first = [], tail = []; let sig = '', n = 0, tn = 0, over = false, src, z;
  const end = (ok) => {
    if (over) return; over = true; zBusy = false; zQueued.delete(file); try { src.destroy(); z.destroy(); } catch {}
    let out = { sig, bad: true };
    if (ok) { const f = Buffer.concat(first), nl = f.indexOf(10); out = { sig, head: headOf(f.toString('utf8', 0, nl >= 0 ? nl : f.length), nl < 0 && n > MB), prompt: promptOf(f.toString('utf8')), ...tailOf(Buffer.concat(tail).subarray(-ZTAIL).toString('utf8'), tailOf(f.toString('utf8'), { turn: '', asked: 0 })) }; }   // asked from both ends: a long command output can push the last thing typed out of the last 128 KB
    if (sig) { if (zCache.size > 2000) zCache.clear(); zCache.set(file, out); }
    setImmediate(zNext);
  };
  try { const s = fs.statSync(file); sig = s.mtimeMs + ':' + s.size; src = fs.createReadStream(file); z = zlib.createZstdDecompress(); } catch { return end(false); }   // the stat before the read: a file changed meanwhile is read again
  src.on('error', () => end(false)); z.on('error', () => end(false)); z.on('end', () => end(true));
  z.on('data', (c) => {
    if (n < MB) first.push(Buffer.from(c.subarray(0, MB - n)));
    tail.push(c); tn += c.length; while (tail.length > 1 && tn - tail[0].length >= ZTAIL) tn -= tail.shift().length;
    n += c.length; if (n > ZMAX) end(false);
  });
  src.pipe(z);
}
let made = null;   // the record reader server.js made with parser(): a compressed thread goes through it here, whole
const zStates = new Map();   // compressed file → { sig, st }: the events of the last two threads read
function state(id, agent = 'main') {   // null: a plain file, which server.js reads line by line itself
  const r = row(id); if (!r || !r.zst || !made) return null;
  const sig = r.mtime + ':' + r.size, key = r.file + ':' + agent, hit = zStates.get(key); if (hit && hit.sig === sig) { zStates.delete(key); zStates.set(key, hit); return hit.st; }
  const st = { agent, file: r.file, journal: false, raw: [], toolName: {}, msgUsage: new Map() };   // what server.js's own reader would make of the plain file
  let buf = null; try { buf = unzst(r.file); } catch {} if (!buf) return st;   // unreadable for now: an empty session, never the compressed bytes taken for lines
  for (let at = 0; at < buf.length;) {
    let nl = buf.indexOf(10, at); if (nl < 0) nl = buf.length;
    if (nl > at) { let j = null; try { j = JSON.parse(buf.toString('utf8', at, nl)); } catch {} if (j && typeof j === 'object') { try { made(st, j); } catch {} } }   // one odd record must not take the whole timeline down
    at = nl + 1;
  }
  zStates.set(key, { sig, st }); while (zStates.size > 2) zStates.delete(zStates.keys().next().value);
  return st;
}

// ---- one record of a rollout file → the events of the call
// Two generations of the format are read. The current one (2026) writes an "item_completed" line for everything that happened: what was typed, what the agent said,
// each command with its output, each file it changed, each search. The earlier one wrote the messages as "user_message" / "agent_message" events and the tool calls as
// raw "function_call" records. A file of the current kind also carries those raw records (the script the model wrote around its commands), which would say everything twice:
// once the first item is seen, the raw tool calls are left alone.
function parser({ toolLabel, clip, clipOut = clip, testsOf = () => null, diffOf = () => null, resultMax = {} }) {   // clipOut: clip for an output (without the codes of a terminal) · testsOf: a test run's summary · diffOf: a change as a diff (server.js)
  const shellText = (c) => (Array.isArray(c) ? (c.length === 3 && /^-l?c$/.test(c[1]) ? c[2] : c.join(' ')) : String(c == null ? '' : c));
  const diffSides = (d) => { const add = [], del = []; for (const l of String(d || '').split('\n')) { if (/^(\+\+\+ |--- |@@|diff |index |\*\*\* )/.test(l)) continue; if (l[0] === '+') add.push(l.slice(1)); else if (l[0] === '-') del.push(l.slice(1)); } return { add: add.join('\n'), del: del.join('\n') }; };
  const patchFiles = (text) => {   // the "*** Update File: x" blocks of an apply_patch call
    const out = []; let cur = null;
    for (const l of String(text || '').split('\n')) { const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(l); if (m) { cur = { type: m[1].toLowerCase(), file: m[2].trim(), body: [] }; out.push(cur); } else if (cur && !/^\*\*\* (Begin|End) Patch/.test(l)) cur.body.push(l); }
    return out.map((x) => ({ type: x.type, file: x.file, ...diffSides(x.body.join('\n')) }));
  };
  const NO_RESULT = new Set(['TodoWrite']);
  return (made = function record(st, r) {
    if (r.type === 'session_meta') { const h = headOf(JSON.stringify(r)); if (st.agent !== 'main' && h.parent) st.birth = h.born; return; }
    if (r.type !== 'event_msg' && r.type !== 'response_item' && r.type !== 'turn_context' && r.type !== 'compacted') return;
    if (st.birth && Date.parse(r.timestamp) < st.birth) return;   // a fork may include its parent's earlier history: it is not work this child did
    const agent = st.agent, p = r.payload && typeof r.payload === 'object' ? r.payload : {}, cx = st.cx || (st.cx = { items: false, model: '', n: 0, tot: null, last: 0, userAt: -1 });
    const ts = Math.max(Date.parse(r.timestamp) || 0, st.lastTs || 0); st.lastTs = ts;   // the lines of one file are in order; a line without a time takes the last one
    const push = (e) => { e.k = agent + ':' + st.raw.length; st.raw.push(e); if (e.ts > cx.last) cx.last = e.ts; return e; };
    const th = () => { const t = st.th; st.th = ''; return t ? { th: t } : {}; };
    const say = (text, final) => { const t = String(text == null ? '' : text).trim(); if (!t) return; const e = push({ ts, agent, kind: 'say', text: t, ...th() }); st.act = st.raw.length - 1; if (final && agent === 'main') e.end = 1; };
    const user = (text, img, iid) => { const t = typed(text); if (!t) return; if (agent !== 'main') { if (!st.prompt && !/^gAAAAA[\w=-]+$/.test(t)) st.prompt = { ts, text: t }; return; } push({ ts, agent: 'user', kind: 'user', text: t, ...(img > 0 && typeof iid === 'string' && /^[\w.\-]{6,200}$/.test(iid) ? { img, iid } : {}) }); cx.userAt = st.raw.length - 1; };
    const call = (id, name, input, at) => { const when = Math.max(Math.min(at || ts, ts), cx.last); st.toolName[id] = name; push({ ts: when, agent, kind: 'tool', tool: toolLabel({ id, name, input: input || {} }, when), ...th() }); st.act = st.raw.length - 1; };   // a command is placed when it started, never before what the file already said
    const result = (id, out, err, more) => { const n = st.toolName[id]; if (!n || NO_RESULT.has(n)) return; push({ ts, agent, kind: 'results', items: [{ id, err: !!err, out: clipOut(String(out == null ? '' : out).trimEnd(), resultMax[n] || (/^mcp__/.test(n) ? 900 : 600)), ...more }] }); };   // more: what else the screen shows of it (img, tests, diff, search)
    const views = () => { const v = cx.views || []; cx.views = []; return v; };   // the pictures looked at (ImageView) whose output has not come yet
    const viewed = (parts) => { const v = views(), im = viewMatch(v, parts); v.forEach((id) => result(id, '', false, im ? { img: 1 } : {})); };
    const endTurn = () => { if (agent === 'main' && st.act > cx.userAt && st.raw[st.act]) st.raw[st.act].end = 1; };   // the turn is over (or was stopped): the last thing the lead said or did closes it

    if (r.type === 'turn_context') { if (typeof p.model === 'string') cx.model = p.model; return; }
    if (r.type === 'compacted') { push({ ts, agent, kind: 'compact' }); return; }
    if (r.type === 'event_msg') {
      if (p.type === 'task_started' || p.type === 'turn_started') { st.completed = false; return; }
      if (p.type === 'item_completed' && p.item && typeof p.item === 'object') {
        const it = p.item, id = String(it.id || 'cx' + st.raw.length), at = +p.started_at_ms || 0; cx.items = true;
        if (it.type === 'UserMessage') { viewed(null); user(partsText(it.content), localImages(it.content), it.id); }
        else if (it.type === 'AgentMessage') say(partsText(it.content), it.phase === 'final_answer');
        else if (it.type === 'CommandExecution') { call(id, 'Bash', { command: shellText(it.command) }, at); const o = it.aggregated_output != null ? String(it.aggregated_output) : [it.stdout, it.stderr].filter(Boolean).join('\n'), t = testsOf(o); result(id, o, it.status === 'failed' || (typeof it.exit_code === 'number' && it.exit_code !== 0), t ? { tests: t } : {}); }
        else if (it.type === 'FileChange') Object.entries(it.changes && typeof it.changes === 'object' ? it.changes : {}).forEach(([file, c], i) => {
          const cid = i ? id + ':' + i : id, kind = c && c.type, d = diffSides(c && c.unified_diff);
          if (kind === 'add') call(cid, 'Write', { file_path: file, content: c.content != null ? String(c.content) : d.add }, at);
          else call(cid, 'Edit', { file_path: file, old_string: kind === 'delete' && c.content != null ? String(c.content) : d.del, new_string: d.add }, at);
          const df = kind !== 'add' && kind !== 'delete' ? diffOf([{ file, hunks: hunksOf(c && c.unified_diff) }], 0) : null; result(cid, '', it.status === 'failed', df ? { diff: df } : {});   // the line is written once the change is made: without an answer the call would look like it is still waiting (for an approval, on a file change)
        });
        else if (it.type === 'McpToolCall') { call(id, 'mcp__' + (it.server || 'mcp') + '__' + (it.tool || 'tool'), it.arguments && typeof it.arguments === 'object' ? it.arguments : {}, at); const n = mcpImages(it).length; result(id, partsText(it.result && it.result.content), it.status === 'failed' || !!(it.result && it.result.isError), n ? { img: n } : {}); }
        else if (it.type === 'ImageView') { call(id, 'Read', { file_path: filePath(it.path) }, at); (cx.views = cx.views || []).push(id); }   // answered with the output that carries its picture (viewed)
        else if (it.type === 'Extension' && /^image_gen\./.test(it.kind || '')) { call(id, 'image_gen', { prompt: clip(it.revisedPrompt || it.prompt || '', 300) }, at); const n = genImages(it).length; result(id, typeof it.savedPath === 'string' ? it.savedPath : '', it.status === 'failed' || !!it.failure, n ? { img: n } : {}); }
        else if (it.type === 'Extension' && /^web\./.test(it.kind || '')) {
          const a = it.action && typeof it.action === 'object' ? it.action : {}, q = it.query || a.query || (Array.isArray(a.queries) && a.queries[0]) || '';
          if (a.url) call(id, 'WebFetch', { url: a.url }, at); else call(id, 'WebSearch', { query: q }, at);
          const found = (Array.isArray(it.results) ? it.results : []).filter((x) => x && typeof x === 'object'), search = found.filter((x) => typeof x.url === 'string').slice(0, 8).map((x) => ({ t: clip(x.title, 120), u: clip(x.url, 300) }));
          result(id, found.slice(0, 6).map((x) => (x.title || '') + (x.url ? ' · ' + x.url : '')).join('\n'), false, search.length ? { search } : {});
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
      if (p.type === 'task_complete' || p.type === 'turn_complete' || p.type === 'turn_aborted') { viewed(null); endTurn(); st.completed = true; st.completedAt = ts; }
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
      if (cx.items && (cx.views || []).length) viewed(p.output);   // the output of a script that looked at pictures
      if (cx.items && st.toolName[id] !== 'AskUserQuestion') return;   // in the current format the item already carried the output (an MCP call has the same id in both: it would be answered twice, the second time without its failure)
      let out = p.output, err = false;
      if (typeof out === 'string' && out[0] === '{') { try { const j = JSON.parse(out); if (j && typeof j === 'object' && ('output' in j || 'metadata' in j)) { err = !!(j.metadata && typeof j.metadata.exit_code === 'number' && j.metadata.exit_code !== 0); out = j.output != null ? j.output : ''; } } catch {} }
      else if (out && typeof out === 'object' && !Array.isArray(out)) { err = out.success === false; out = out.content != null ? out.content : ''; }
      const n = partImages(out).length; result(id, partsText(out), err, n ? { img: n } : {}); for (let i = 1; i < ((cx.more || {})[id] || 0); i++) result(id + ':' + i, '', err);
      return;
    }
    if (p.type === 'web_search_call' && !cx.items && id) call(id, 'WebSearch', { query: (p.action && p.action.query) || '' });
  });
}
// ---- /api/media for a Codex session: the n-th picture of a call (an MCP call, a picture looked at, one made, a raw output) or of a message the person sent (user: toolId is the message's item id),
// read from the rollout, plain or compressed, by the same rules as the count the call shows (img, above). The rollout read last is kept 20 s: a page asks for its pictures one after the other.
let imgBuf = { file: '', sig: '', buf: null, timer: null };
function rollout(r) {
  const sig = r.mtime + ':' + r.size; if (imgBuf.file === r.file && imgBuf.sig === sig) return imgBuf.buf;
  const buf = r.zst ? unzst(r.file) : fs.readFileSync(r.file); if (!buf) return null;
  clearTimeout(imgBuf.timer); imgBuf = { file: r.file, sig, buf, timer: setTimeout(() => { imgBuf = { file: '', sig: '', buf: null, timer: null }; }, 20e3) }; if (imgBuf.timer.unref) imgBuf.timer.unref();
  return buf;
}
function findImage(buf, toolId, n, user) {   // { type, data } or null
  const needle = Buffer.from('"' + toolId + '"'), VIEW = Buffer.from('"ImageView"'), OUT = Buffer.from('_call_output"'), PART = Buffer.from('"input_image"'), MSG = Buffer.from('"role":"user"'), pasted = new Map();   // pasted: turn → the raw message of the person that carries pictures
  const parse = (line) => { try { const j = JSON.parse(line.toString('utf8')); return j && j.payload && typeof j.payload === 'object' ? j.payload : null; } catch { return null; } };
  let views = [];
  for (let a = 0; a < buf.length;) {
    let b = buf.indexOf(10, a); if (b < 0) b = buf.length; const line = buf.subarray(a, b), hit = line.indexOf(needle) >= 0; a = b + 1;
    if (user) {
      if (line.indexOf(MSG) >= 0 && line.indexOf(PART) >= 0) { const p = parse(line); if (p && p.type === 'message' && p.role === 'user') { const m = p.internal_chat_message_metadata_passthrough; pasted.set(String((m && m.turn_id) || ''), p.content); if (pasted.size > 8) pasted.delete(pasted.keys().next().value); } }
      else if (hit) { const p = parse(line), it = p && p.type === 'item_completed' && p.item; if (it && it.type === 'UserMessage' && it.id === toolId) return partImages(pasted.get(String(p.turn_id || '')))[n] || null; }
      continue;
    }
    if (line.indexOf(VIEW) >= 0) { const p = parse(line), it = p && p.type === 'item_completed' && p.item; if (it && it.type === 'ImageView') { views.push(String(it.id)); continue; } }
    if (line.indexOf(OUT) >= 0 && (views.length || hit)) {
      const p = parse(line); if (!p || !/_call_output$/.test(String(p.type))) continue;
      const v = views; views = []; const at = v.indexOf(toolId);
      if (at >= 0) { const im = viewMatch(v, p.output); return im && n === 0 ? im[at] : null; }
      if (hit && String(p.call_id) === toolId) { const im = partImages(p.output)[n]; if (im) return im; }   // the earlier format: the call's own output
      continue;
    }
    if (hit) { const p = parse(line), it = p && p.type === 'item_completed' && p.item; if (it && String(it.id) === toolId && (it.type === 'McpToolCall' || it.type === 'Extension')) return (it.type === 'McpToolCall' ? mcpImages(it) : genImages(it))[n] || null; }
  }
  return null;
}
const sniff = (b, type) => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.toString('latin1', 0, 4) === 'GIF8' ? 'image/gif' : b.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : type);   // the bytes say what they are: a computer-use screenshot written image/png is often a JPEG
const imgMemo = new Map();
function image(id, toolId, n, user, agent = 'main') {   // { type, buf } or null
  if (agent !== 'main' && agent !== 'user') { if (!descendants(id).some((r) => r.id === agent)) return null; id = agent; }
  const r = row(id); if (!r || typeof toolId !== 'string' || toolId.length < 4 || !(n >= 0)) return null;
  const key = r.file + '|' + r.mtime + '|' + toolId + '|' + n + (user ? '|u' : ''); if (imgMemo.has(key)) return imgMemo.get(key);
  let found = null; try { const buf = rollout(r); found = buf ? findImage(buf, toolId, n, !!user) : null; } catch {}
  const b = found ? Buffer.from(found.data, 'base64') : null, out = b && b.length ? { type: sniff(b, found.type), buf: b } : null;
  imgMemo.set(key, out); if (imgMemo.size > 12) imgMemo.delete(imgMemo.keys().next().value);
  return out;
}
module.exports = { PROJ, SOURCE, home, dirKey, sessions, row, fileOf, cwd, inProject, projectLabel, title, boardRow, subFiles, state, parser, image };
