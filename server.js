#!/usr/bin/env node
// Agent Standup: turns Claude Code session transcripts into a replayable "team call" timeline.
// No dependencies. Run: node server.js  → http://localhost:4747
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const codex = require('./codex.js');     // Codex sessions, read as the same call (see codex.js)
const vibe = require('./vibe.js');       // Mistral Vibe sessions, the same way (see vibe.js)
const SOURCES = [codex, vibe], sourceOf = (proj) => SOURCES.find((m) => m.PROJ === proj) || null;   // the tools other than Claude Code: each lists its sessions under one made-up project
const kokoro = require('./kokoro.js');   // natural voices, installed on demand (see kokoro.js)
const zlib = require('zlib');
const { execFileSync, execFile } = require('child_process');

const PORT = process.env.PORT || 4747;
// Same place Claude Code writes to: honours CLAUDE_CONFIG_DIR (custom config dirs are common on Linux); AGENT_STANDUP_PROJECTS overrides it.
const ROOT = process.env.AGENT_STANDUP_PROJECTS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const PUBLIC = path.join(__dirname, 'public');

const blocks = (rec) => {
  const c = rec.message && rec.message.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c : [];
};
const clip = (x, n = 700) => String(x == null ? '' : x).slice(0, n);
// What each tool call looks like on a screen ("d"), plus its id/timestamp so the result can be matched later.
const toolLabel = (b, ts) => {
  const i = b.input || {};
  const q0 = Array.isArray(i.questions) && i.questions[0] ? i.questions[0] : null, mcp = /^mcp__/.test(b.name) ? b.name.split('__') : null, firstStr = mcp ? Object.values(i).find((v) => typeof v === 'string') : '';
  const arg = i.file_path || i.notebook_path || i.path || i.pattern || i.command || i.url || i.query || i.skill || (q0 && q0.question) || i.description || firstStr || '';
  const out = { id: b.id, ts, name: b.name, arg: String(arg).slice(0, 90) };
  switch (b.name) {
    case 'Bash': out.d = { kind: 'cmd', text: clip(i.command, 1200), note: clip(i.description, 140) }; break;
    case 'Read': out.d = { kind: 'read', file: i.file_path, offset: i.offset, limit: i.limit }; break;
    case 'Edit': case 'MultiEdit': { const e = i.edits ? i.edits[0] || {} : i; out.d = { kind: 'edit', file: i.file_path, old: clip(e.old_string, 500), new: clip(e.new_string, 500) }; break; }
    case 'Write': out.d = { kind: 'write', file: i.file_path, text: clip(i.content, 800) }; break;
    case 'Grep': out.d = { kind: 'grep', pattern: clip(i.pattern, 100), path: i.path, glob: i.glob }; break;
    case 'Glob': out.d = { kind: 'glob', pattern: clip(i.pattern, 100), path: i.path }; break;
    case 'TodoWrite': out.d = { kind: 'todo', items: (i.todos || []).slice(0, 20).map((x) => ({ c: clip(x.content, 120), s: x.status })) }; break;
    case 'WebFetch': out.d = { kind: 'web', url: i.url }; break;
    case 'WebSearch': out.d = { kind: 'web', query: i.query }; break;
    case 'NotebookEdit': out.d = { kind: 'edit', file: i.notebook_path, old: '', new: clip(i.new_source, 500) }; break;
    case 'AskUserQuestion': out.d = { kind: 'text', what: 'question', text: clip((q0 ? q0.question + '\n' + (q0.options || []).map((o) => '• ' + (o.label || '')).join('\n') : ''), 500) }; break;
    case 'Skill': out.d = { kind: 'text', what: 'skill', v: i.skill, text: clip(i.skill + (i.args ? ' ' + i.args : ''), 200) }; break;
    case 'ToolSearch': out.d = { kind: 'text', what: 'toolsearch', text: clip(i.query, 200) }; break;
    default: out.d = mcp ? { kind: 'text', what: 'mcp', v: (mcp[1] || '') + ' · ' + (mcp.slice(2).join('__') || ''), text: clip(JSON.stringify(i), 400) } : { kind: 'text', text: clip(JSON.stringify(i), 300) };
  }
  return out;
};
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text || '').join('\n') : '');
// Pictures a tool returned (a screenshot, an image file that was read). They are served from the transcript itself, so nothing outside the session files is ever read, and only bitmap types are sent.
const IMG_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']), mediaMemo = new Map();
const isImg = (x) => !!x && x.type === 'image' && !!x.source && x.source.type === 'base64' && typeof x.source.data === 'string' && IMG_TYPES.has(x.source.media_type);
const resultImages = (c) => (Array.isArray(c) ? c.filter(isImg) : []);
const mtimeOf = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };   // 0 for a file that is gone, or a symlink that points nowhere: never an exception
// Every sub-agent transcript of a session: <id>/subagents/*.jsonl, plus the ones a workflow launched, one folder deeper in <id>/subagents/workflows/<run>/agent-*.jsonl (each run also keeps a journal.jsonl, which is not an agent).
function subFiles(proj, id) {
  const sd = path.join(ROOT, proj, id, 'subagents'), out = [], seen = new Set(['main', 'user']); out.dirs = [sd]; out.journals = [];
  const add = (dir, f, run) => { let aid = f.replace(/^agent-/, '').replace(/\.jsonl$/, '').replace(/[^\w.-]/g, '_'); const id0 = aid; if (seen.has(aid)) aid = (run || 'agent').replace(/[^\w.-]/g, '_') + '.' + aid; seen.add(aid); out.push({ file: path.join(dir, f), aid, id0, run }); };   // an id is the file name; the same name in two folders gets its run in front
  let names; try { names = fs.readdirSync(sd); } catch { return out; }
  for (const f of names) if (f.endsWith('.jsonl')) add(sd, f, '');
  if (!names.includes('workflows')) return out;
  const wd = path.join(sd, 'workflows'); let runs = []; try { runs = fs.readdirSync(wd).sort(); } catch {} out.dirs.push(wd);
  for (const run of runs) {
    const dir = path.join(wd, run); let fl; try { fl = fs.readdirSync(dir).sort(); } catch { continue; } out.dirs.push(dir);
    for (const f of fl) { if (/^agent-.*\.jsonl$/.test(f)) add(dir, f, run); else if (f === 'journal.jsonl') out.journals.push({ file: path.join(dir, f), run }); }
  }
  return out;
}
const subFilesOf = (proj, id) => { const sx = sourceOf(proj); return sx && sx.subFiles ? sx.subFiles(id) : subFiles(proj, id); };   // Mistral Vibe keeps its sub-agents its own way
function mediaFile(proj, sid, agent) {
  if (agent === 'main') return path.join(ROOT, proj, sid + '.jsonl');
  const hit = subFiles(proj, sid).find((x) => x.aid === agent);
  return hit ? hit.file : null;
}
function toolImage(file, toolId, n) {   // looks for the tool's result line in the transcript, 8 MB at a time; the few pictures asked last are kept in memory
  const key = file + '|' + toolId + '|' + n, memo = mediaMemo.get(key); if (memo && memo.buf) return memo;
  const needle = Buffer.from('"' + toolId + '"'), mark = Buffer.from('"image"'), until = Date.now() + 2000; let fd, found = null, carry = Buffer.alloc(0), pos = 0, size = 0;   // the id between its quotes, so a made-up one-letter id does not match on every line; and never more than 2 s of searching
  try {
    fd = fs.openSync(file, 'r'); size = fs.fstatSync(fd).size; if (memo && memo.miss === size) return null;   // already searched in vain, and nothing was written since
    while (pos < size && !found && Date.now() < until) {
      const buf = Buffer.alloc(Math.min(8 * 1024 * 1024, size - pos)); fs.readSync(fd, buf, 0, buf.length, pos); pos += buf.length;
      const all = carry.length ? Buffer.concat([carry, buf]) : buf; let from = 0;
      for (let hit; !found && (hit = all.indexOf(needle, from)) >= 0 && Date.now() < until;) {
        const a = all.lastIndexOf(10, hit) + 1, b = all.indexOf(10, hit); if (b < 0) break;   // the line goes on in the next chunk
        from = b + 1; if (all.subarray(a, b).indexOf(mark) < 0) continue;
        let r; try { r = JSON.parse(all.subarray(a, b).toString('utf8')); } catch { continue; }
        for (const blk of blocks(r)) if (blk.type === 'tool_result' && blk.tool_use_id === toolId) { const im = resultImages(blk.content)[n]; if (im) found = { type: im.source.media_type, buf: Buffer.from(im.source.data, 'base64') }; }
      }
      carry = all.subarray(all.lastIndexOf(10) + 1);
    }
  } catch {} finally { if (fd != null) fs.closeSync(fd); }
  mediaMemo.delete(key); mediaMemo.set(key, found || { miss: size }); if (mediaMemo.size > 12) mediaMemo.delete(mediaMemo.keys().next().value);
  return found;
}
const RESULT_MAX = { AskUserQuestion: 900, Skill: 300, ToolSearch: 500, Read: 1900, Bash: 1300, Grep: 900, Glob: 800, WebFetch: 800, WebSearch: 800, Edit: 200, MultiEdit: 200, Write: 200 };
const NO_RESULT = new Set(['Agent', 'Task', 'SendMessage', 'TodoWrite']);   // internal bookkeeping, nothing to show
const HARNESS = /<(system-reminder|browser_instruction|ide_selection|ide_opened_file|task-notification|command-name|command-message|command-args|local-command-stdout|local-command-caveat)>[\s\S]*?<\/\1>\s*/g;   // blocks the harness wraps around what the human typed


let sessionsMemo = { at: 0, rows: [] };
function listSessions() {
  if (Date.now() - sessionsMemo.at < 2000) return sessionsMemo.rows;
  const out = listSessions0(); sessionsMemo = { at: Date.now(), rows: out }; return out;
}
function listSessions0() {
  const rows = [];
  for (const m of SOURCES) for (const r of m.sessions(30)) rows.push({ proj: m.PROJ, id: r.id, mtime: r.mtime, size: r.size, agents: m.subFiles ? m.subFiles(r.id).length : 0, cx: r, src: m });
  for (const proj of fs.existsSync(ROOT) ? fs.readdirSync(ROOT) : []) {
    const dir = path.join(ROOT, proj);
    let files;
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const id = f.replace(/\.jsonl$/, '');
      let st; try { st = fs.statSync(path.join(dir, f)); } catch { continue; }   // a link to a transcript that is gone
      rows.push({ proj, id, mtime: st.mtimeMs, size: st.size, agents: subFiles(proj, id).length });
    }
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  const top = rows.filter((r) => !r.cx).slice(0, 60).concat(rows.filter((r) => r.cx)).sort((a, b) => b.mtime - a.mtime);   // the 60 most recent Claude Code sessions as always, and up to 30 of each other tool beside them: none pushes another out
  for (const r of top) {
    if (r.cx) { const c = r.cx, m = r.src; delete r.cx; delete r.src; r.title = m.title(c); r.project = m.projectLabel(c.cwd); r.source = m.SOURCE; continue; }
    // titles come from the cached tail read (custom title, then AI title, then first prompt): no whole-file reads
    let t = null; try { const f = path.join(ROOT, r.proj, r.id + '.jsonl'); t = parseTail(f, fs.statSync(f)).title; } catch {}
    r.title = t || r.id; r.project = r.proj.replace(/^-Users-[^-]+-/, '').replace(/-/g, '/');
  }
  return top;
}

function stamp(proj, id) {
  const base = path.join(ROOT, proj); let n = 0;
  const add = (f) => { try { const s = fs.statSync(f); n += s.mtimeMs + s.size; } catch {} };
  const sx = sourceOf(proj); add(sx ? sx.fileOf(id) || '' : path.join(base, id + '.jsonl')); if (sx && sx.watch) for (const f of sx.watch(id)) add(f);
  const subs = subFilesOf(proj, id);   // the transcripts and the folders they are in (a folder changes when a file appears in it, e.g. an agent's meta file), not every file around them
  for (const x of subs) add(x.file); for (const x of subs.journals) add(x.file); for (const d of subs.dirs) n += mtimeOf(d);
  return n;
}
const tlCache = new Map();   // "proj/id" → { st (file stamp), tl, at, ms, files[], feed, sq, json?, gz?, idle? }
const MAX_CACHED_SESSIONS = 3;
function timelineEntry(proj, id) {
  const key = proj + '/' + id, st = stamp(proj, id), hit = tlCache.get(key), now = Date.now();
  if (hit && ((hit.st === st && !(hit.recentUntil && now > hit.recentUntil)) || now - hit.at < Math.max(250, hit.ms * 2))) {   // nothing was written (a sub-agent's 4-minute silence rule can flip without any file change); or a very big session, which is not rebuilt on every poll
    tlCache.delete(key); tlCache.set(key, hit); return hit;   // asked for again: the last one to be dropped
  }
  const t0 = Date.now(), files = [], tl = buildTimeline(proj, id, files), feed = feedStep(hit && hit.feed, tl, files);
  const entry = { st, tl, at: Date.now(), ms: Date.now() - t0, files, feed, sq: feed.sq, recentUntil: tl.recentUntil || 0 };
  tlCache.delete(key); tlCache.set(key, entry);
  while (tlCache.size > MAX_CACHED_SESSIONS) {   // free the memory of sessions nobody is looking at any more (their live feed goes with them: a page still on one of them is told to load it again)
    const [oldKey, old] = tlCache.entries().next().value; tlCache.delete(oldKey);
    for (const f of old.files) fileStates.delete(f);
  }
  return entry;
}
// ---- Live feed. The timeline is sorted again at each build and events already sent can change (an order typed mid-turn is stamped at typing time and lands before what the page has; a sub-agent's last line becomes its report; a tool call joins an earlier beat),
// so a page cannot ask for "what comes after index n". Every event has a key `k` that never changes, each build that changes something gets the next sequence number, and a page asks for the events that are new or different since the number it holds.
// `ep` names this memory: it is a new one after a restart, after the session left the cache, or when a transcript was rewritten, and the page then loads the whole session again.
const sigOf = (e) => e.kind + '|' + e.agent + '|' + (e.to || '') + '|' + (e.end || '') + '|' + (e.kind === 'tools' ? e.tools.length + ':' + e.tools[e.tools.length - 1].id : e.kind === 'usage' ? e.u.i + ',' + e.u.o + ',' + e.u.r + ',' + e.u.w + ',' + e.model : e.kind === 'order' ? e.toolId + ',' + e.bg + ',' + e.title : e.kind === 'finish' ? e.ts : '');   // everything about an event that can differ from one build to the next. Its text, its tool calls, its results and its time never do: they come from one transcript record (same key = same record); and `t` moves only when time zero does, which feedStep looks at once for all
function feedStep(prev, tl, files) {
  let f = prev && files.every((x) => { const was = prev.gens.get(x); return was === undefined || was === (fileStates.get(x) || {}).gen; }) ? prev : null;   // a transcript read again from its start numbers its events again: the keys no longer mean the same thing
  for (let pass = 0; ; pass++) {
    if (!f) f = { ep: crypto.randomBytes(6).toString('hex'), seq: 0, known: new Map(), gens: new Map() };
    const n = tl.events.length, sq = new Uint32Array(n), seq = f.seq + 1, before = f.known.size, z = tl.events.find((e) => e.kind !== 'usage' && e.kind !== 'finish' && e.kind !== 'compact'), t0 = z ? z.ts : 0, moved = f.t0 !== t0; let hits = 0, changed = false; f.t0 = t0;   // time zero moved (something now comes before the first line): every `t` is different
    for (let i = 0; i < n; i++) {
      const e = tl.events[i], s = sigOf(e), was = f.known.get(e.k);
      if (was) { hits++; if (was.s !== s || moved) { was.s = s; was.q = seq; changed = true; } sq[i] = was.q; } else { f.known.set(e.k, { s, q: seq }); sq[i] = seq; changed = true; }
    }
    if (hits < before && !pass) { f = null; continue; }   // an event the page may hold no longer exists: nothing can tell it to drop it, so everything starts over
    if (changed) f.seq = seq;
    for (const x of files) f.gens.set(x, (fileStates.get(x) || {}).gen);
    f.sq = sq; tl.ep = f.ep; tl.seq = f.seq; return f;
  }
}
const timeline = (proj, id) => timelineEntry(proj, id).tl;
const demoEntry = () => { const tl = require('./demo.js')(); tl.events.forEach((e, i) => { e.k = 'd:' + i; }); tl.ep = 'demo'; tl.seq = 1; return { tl }; };   // the built-in session never changes: one sequence number for all of it
const feedSince = (entry, after) => { const ev = entry.tl.events, sq = entry.sq, out = []; if (after < entry.tl.seq) for (let i = 0; i < ev.length; i++) if ((sq ? sq[i] : 1) > after) out.push(ev[i]); return out; };   // in timeline order; nothing to scan when the page is up to date

// ---- Board: one cheap row per recent session (state from the tail of its transcript), so many parallel sessions can be watched at once.
const readTail = (file, bytes) => { const fd = fs.openSync(file, 'r'); try { const sz = fs.fstatSync(fd).size, n = Math.min(bytes, sz), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, sz - n); return { text: buf.toString('utf8'), cut: sz > bytes }; } finally { fs.closeSync(fd); } };
const readHead = (file, bytes) => { const fd = fs.openSync(file, 'r'); try { const n = Math.min(bytes, fs.fstatSync(fd).size), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, 0); return buf.toString('utf8'); } finally { fs.closeSync(fd); } };
const APPROVAL = /^(Edit|Write|MultiEdit|NotebookEdit)/, ASKS = /^(AskUserQuestion|ExitPlanMode)/, SUBTOOL = /^(Task|Agent)$/;
const boardCache = new Map();   // file → { sig, parsed, title }
let boardMemo = { at: 0, rows: [] };
function parseTail(file, st) {
  const sig = st.mtimeMs + ':' + st.size, hit = boardCache.get(file); if (hit && hit.sig === sig) return hit;
  const { text, cut } = readTail(file, 192 * 1024), lines = text.split('\n'); if (cut) lines.shift();
  const pend = new Map(); let lastType = null, lastTool = false, lastTs = 0, custom = (hit && hit.custom) || null, ai = (hit && hit.ai) || null, first = hit ? hit.first : undefined;
  for (const l of lines) {
    if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    if (r.type === 'custom-title' && typeof r.customTitle === 'string') custom = r.customTitle; else if (r.type === 'ai-title' && typeof r.aiTitle === 'string') ai = r.aiTitle;   // a session is renamed, or named, long after its row was first shown: the latest one read wins
    const t = Date.parse(r.timestamp) || 0, bl = blocks(r);
    if (r.type === 'assistant' || r.type === 'user') { lastType = r.type; lastTool = bl.some((b) => b.type === 'tool_use'); if (t) lastTs = t; }
    for (const b of bl) { if (b.type === 'tool_use') pend.set(b.id, { name: b.name, ts: t }); else if (b.type === 'tool_result') pend.delete(b.tool_use_id); }
  }
  if (!hit && !custom) {   // first look at this file: a little further back than the lines read above, and without needing whole lines
    const big = readTail(file, 256 * 1024).text, un = (m) => { try { return m ? JSON.parse('"' + m[1] + '"') : null; } catch { return null; } };
    custom = un([...big.matchAll(/"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/g)].pop()); if (!ai) ai = un([...big.matchAll(/"type":"ai-title","aiTitle":"((?:[^"\\]|\\.)*)"/g)].pop());
  }
  if (!custom && !ai && first == null) first = firstPrompt(file) || (st.size > 64 * 1024 ? '' : null);   // '' = looked for and not there; a file that has just been created is looked at again
  const out = { sig, title: custom || ai || first || null, custom, ai, first, lastType, lastTool, lastTs, pending: [...pend.values()] };   // a title the person typed wins over the generated one, and both over the first prompt
  boardCache.set(file, out); if (boardCache.size > 200) boardCache.delete(boardCache.keys().next().value); return out;
}
function firstPrompt(file) {   // the first thing the person typed, read record by record: a pattern over the raw text ran from a user record into the assistant's first answer and took that as the title
  const ONE = (t) => t.replace(/\s+/g, ' ').trim().slice(0, 90);
  for (const l of readHead(file, 64 * 1024).split('\n')) {
    if (!l) continue; let r; try { r = JSON.parse(l); } catch { r = null; }
    if (r) { if (r.type !== 'user' || r.isMeta || r.isCompactSummary) continue; const t = ONE(blocks(r).filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').replace(HARNESS, '')); if (t && t[0] !== '<' && !/^\[Request interrupted/i.test(t)) return t; continue; }
    const u = /"type":"user"/.test(l) && l.match(/"role":"user","content":(?:\[\{"type":"text","text":)?"(?!<)((?:[^"\\]|\\.){1,200})/);   // a first prompt too long to be whole in what was read: its start, from that same line only
    if (u) { try { const t = ONE(JSON.parse('"' + u[1].replace(/\\u[0-9a-fA-F]{0,3}$/, '') + '"')); if (t) return t; } catch {} }
  }
  return null;
}
function boardRows() {
  if (Date.now() - boardMemo.at < 1200) return boardMemo.rows;   // several windows polling at once share one scan
  const out = boardRows0(); boardMemo = { at: Date.now(), rows: out }; return out;
}
function boardRows0() {
  const now = Date.now(), rows = [];
  for (const m of SOURCES) for (const r of m.sessions()) if (now - r.mtime < 12 * 3600e3) rows.push({ proj: m.PROJ, id: r.id, st: { mtimeMs: r.mtime, size: r.size }, cx: r, src: m });
  for (const proj of fs.existsSync(ROOT) ? fs.readdirSync(ROOT) : []) {
    const dir = path.join(ROOT, proj); let files; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) { try { const st = fs.statSync(path.join(dir, f)); if (now - st.mtimeMs < 12 * 3600e3) rows.push({ proj, id: f.slice(0, -6), st }); } catch {} }
  }
  rows.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  return rows.filter((r) => !r.cx).slice(0, 40).concat(...SOURCES.map((m) => rows.filter((r) => r.src === m).slice(0, 20))).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs).map(({ proj, id, st, cx, src }) => {
    if (cx) return src.boardRow(cx, now);
    const file = path.join(ROOT, proj, id + '.jsonl'); let p; try { p = parseTail(file, st); } catch { p = { pending: [] }; }
    const age = now - st.mtimeMs, lp = (p.pending || [])[(p.pending || []).length - 1]; let state = 'idle', tool = '', ageMs = age;
    if (age < 30 * 60e3) {
      if (lp) { ageMs = now - (lp.ts || st.mtimeMs); tool = lp.name;
        state = SUBTOOL.test(lp.name) ? 'waiting' : (ASKS.test(lp.name) && ageMs > 4000) || (APPROVAL.test(lp.name) && ageMs > 15000) ? 'blocked' : 'working'; }
      else if (p.lastType === 'assistant' && !p.lastTool) state = 'turn';
      else state = age < 10 * 60e3 ? 'working' : 'idle';
    }
    let subActive = 0, subTotal = 0;
    for (const x of subFiles(proj, id)) { subTotal++; if (now - mtimeOf(x.file) < 90e3) subActive++; }
    return { proj, id, title: p.title || id, mtime: st.mtimeMs, state, tool, ageMs, subActive, subTotal };
  });
}
// Settings live in a file, not only in the page's localStorage: the port changes between VS Code windows and reloads, and localStorage is per origin (port included).
const PREFS = process.env.AGENT_STANDUP_PREFS || (process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'agent-standup', 'prefs.json') : path.join(os.homedir(), '.config', 'agent-standup', 'prefs.json'));
function readPrefs() { try { const v = JSON.parse(fs.readFileSync(PREFS, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } }
function writePrefs(v) { fs.mkdirSync(path.dirname(PREFS), { recursive: true }); const tmp = PREFS + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 1)); fs.renameSync(tmp, PREFS); }
// Most recently active session (optionally limited to one project dir) — drives the live feed.
const STICK_MS = 90000;   // a session written to in the last 90 s keeps the call, so another session writing elsewhere does not steal it mid-line
function sessionMtime(proj, id) {
  const sx = sourceOf(proj), r = sx ? sx.row(id) : null; if (sx && (!r || !sx.subFiles)) return r ? r.mtime : 0;
  let m = sx ? r.mtime : mtimeOf(path.join(ROOT, proj, id + '.jsonl')); if (!m) return 0; const subs = subFilesOf(proj, id);
  for (const x of subs) m = Math.max(m, mtimeOf(x.file)); for (const d of subs.dirs) m = Math.max(m, mtimeOf(d)); return m;   // the folders too: a new file in them is activity, as when every file around the transcripts was looked at
}
function currentSession(projFilter, idFilter, stick) {
  const safe = (x) => typeof x === 'string' && /^[\w.\-]+$/.test(x) && x !== '..';
  if (stick && safe(stick.id) && safe(stick.proj) && (!projFilter || stick.proj === projFilter || stick.proj.startsWith(projFilter + '-') || (sourceOf(stick.proj) && sourceOf(stick.proj).inProject(stick.id, projFilter))) && Date.now() - sessionMtime(stick.proj, stick.id) < STICK_MS) return { proj: stick.proj, id: stick.id, mtime: sessionMtime(stick.proj, stick.id) };
  if (idFilter && projFilter && projFilter !== '..' && idFilter !== '..' && /^[\w.\-]+$/.test(idFilter) && /^[\w.\-]+$/.test(projFilter) && (sourceOf(projFilter) ? !!sourceOf(projFilter).fileOf(idFilter) : fs.existsSync(path.join(ROOT, projFilter, idFilter + '.jsonl')))) return { proj: projFilter, id: idFilter, mtime: Date.now() };   // pinned from the board
  let best = null;
  const consider = (proj, id, m) => { if (!best || m > best.mtime) best = { proj, id, mtime: m }; };
  for (const m of SOURCES) for (const r of m.sessions()) if (!projFilter || m.inProject(r.id, projFilter)) consider(m.PROJ, r.id, r.mtime);   // a Codex or Vibe session counts for a project when it was started in that folder
  for (const proj of fs.existsSync(ROOT) ? fs.readdirSync(ROOT) : []) {
    if (projFilter && proj !== projFilter && !proj.startsWith(projFilter + '-')) continue;   // the folder itself, or a folder inside it
    const dir = path.join(ROOT, proj); let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const m = sessionMtime(proj, f.slice(0, -6)); if (m) consider(proj, f.slice(0, -6), m);   // 0: a link to a transcript that is gone
    }
  }
  if (!best && projFilter) return currentSession('', '', stick);
  return best || {};
}

// ---- Incremental transcript reader: each .jsonl is parsed once, then only the bytes appended since are read.
// A session is merged from its main file and one file per sub-agent; the per-file results are cached and re-assembled cheaply.
const fileStates = new Map();   // path → { agent, gen, offset, mtime, fp, tail, raw[], toolName{}, msgUsage Map }
let fileGen = 0;   // each time a transcript is read from its start it gets a new number, which is how the live feed knows its events were numbered again
const sameBytes = (file, st) => {   // are the last bytes we read still where we read them? If not, the file was rewritten and not appended to
  let fd; try { fd = fs.openSync(file, 'r'); const b = Buffer.alloc(st.fp.length); fs.readSync(fd, b, 0, b.length, st.offset - b.length); return b.equals(st.fp); } catch { return false; } finally { if (fd != null) fs.closeSync(fd); }
};
function readNew(file, agent, journal, record = parseRecord) {
  let size, mtime; try { const s = fs.statSync(file); size = s.size; mtime = s.mtimeMs; } catch { fileStates.delete(file); return null; }
  let st = fileStates.get(file);
  if (st && size >= st.offset && mtime !== st.mtime && st.fp.length && !sameBytes(file, st)) st = null;   // rewritten in place and not shorter: checked only when the file was written to, with one small read
  if (!st || size < st.offset) { st = { agent, file, journal: !!journal, gen: ++fileGen, offset: 0, mtime: 0, fp: Buffer.alloc(0), tail: Buffer.alloc(0), raw: [], toolName: {}, msgUsage: new Map() }; fileStates.set(file, st); }
  st.mtime = mtime;
  while (size > st.offset) {   // read in chunks of at most 16 MB so a huge transcript never needs one giant buffer
    const fd = fs.openSync(file, 'r'); let buf;
    try { buf = Buffer.alloc(Math.min(16 * 1024 * 1024, size - st.offset)); fs.readSync(fd, buf, 0, buf.length, st.offset); } finally { fs.closeSync(fd); }
    st.offset += buf.length; st.fp = Buffer.from(buf.length >= 64 ? buf.subarray(buf.length - 64) : Buffer.concat([st.fp, buf]).subarray(-64));   // a copy: a view would keep the whole chunk in memory
    const all = st.tail.length ? Buffer.concat([st.tail, buf]) : buf, cut = all.lastIndexOf(10);   // only complete lines; a half-written last line waits for the next read
    if (cut < 0) { st.tail = all; continue; }
    st.tail = Buffer.from(all.subarray(cut + 1));   // a copy, for the same reason
    for (const line of all.subarray(0, cut).toString('utf8').split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (!r || typeof r !== 'object') continue;
      try { record(st, r); } catch {}   // one odd record must not take the whole timeline down
    }
  }
  if (record.after) { try { record.after(st); } catch {} }   // a format without a time on each line (Mistral Vibe) dates what was just read, once it has all of it
  return st;
}
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
        if (b.name === 'Agent' || b.name === 'Task') push({ ts, agent, kind: 'agentcall', toolId: b.id, bg: !!(b.input && b.input.run_in_background), text: (b.input && b.input.prompt) || '', title: (b.input && b.input.description) || '', ...(b.input && typeof b.input.name === 'string' && b.input.name.trim() ? { nm: b.input.name.trim() } : {}) });
        else { push({ ts, agent, kind: 'tool', tool: toolLabel(b, ts), ...th() }); st.act = st.raw.length - 1; }
      }
    }
    if (agent === 'main' && m.stop_reason === 'end_turn') {   // the lead's turn is over: Claude Code writes one record per content block, each with the message's stop reason, so the mark goes on the line this record carries (a thinking block carries none)
      if (!said && m.id && st.sayOf === m.id) said = st.raw[st.sayAt];   // ...or on the line the same message brought in an earlier record
      if (said) said.end = 1;
    }
  }
}
const codexRecord = codex.parser({ toolLabel, clip, resultMax: RESULT_MAX }), vibeRecord = vibe.parser({ toolLabel, clip, resultMax: RESULT_MAX });
const recordOf = (sx) => (sx === codex ? codexRecord : sx === vibe ? vibeRecord : parseRecord);
// A sub-agent the person named keeps that name on screen: the name given when it was launched, or else its type when that type is the person's own (.claude/agents/code-reviewer.md → "Code Reviewer").
// The types Claude Code ships are not names: those agents get a first name from the page, as before.
const STOCK_AGENT = /^(general-purpose|explore|plan|claude|agent|task|fork|main|default|worker|subagent|workflow-subagent|statusline-setup|output-style-setup|claude-code-guide|verification|magic-docs)$/i;
function ownName(s, type) {
  const raw = String(s || '').split(':').pop().trim(); if (!raw || (type && STOCK_AGENT.test(raw))) return '';   // a plugin's agent is written plugin:agent
  let n = raw.replace(/[_\-]+/g, ' ').replace(/[^\p{L}\p{N} .'’&+]/gu, ' ').replace(/\s+/g, ' ').trim(); if (!/[\p{L}\p{N}]/u.test(n)) return '';
  if (n === n.toLowerCase()) n = n.replace(/(^|\s)\p{Ll}/gu, (m) => m.toUpperCase());
  return n.length > 26 ? n.slice(0, 25).trimEnd() + '…' : n;
}
const metaCache = new Map();   // meta file path → { mtime, value }
function readMeta(f) {
  try { const mt = fs.statSync(f).mtimeMs, c = metaCache.get(f); if (c && c.mtime === mt) return c.value; const v = JSON.parse(fs.readFileSync(f, 'utf8')); if (metaCache.size > 3000) metaCache.clear(); metaCache.set(f, { mtime: mt, value: v }); return v; } catch { return {}; }
}

function buildTimeline(proj, id, files = []) {
  const sx = sourceOf(proj), rec = recordOf(sx), base = path.join(ROOT, proj), mainFile = sx ? sx.fileOf(id) || '' : path.join(base, id + '.jsonl');   // a Codex or Vibe session is kept somewhere else, in another format (rec); from here on it is a session like any other (Codex without sub-agents)
  if (!fs.existsSync(mainFile)) throw new Error('session not found');
  const agents = { main: { id: 'main', role: 'Lead', type: 'main' } };   // the lead has the same name whatever tool runs the session: the page gives it
  const states = [(sx && sx.state && sx.state(id)) || readNew(mainFile, 'main', false, rec)], subs = subFilesOf(proj, id), runs = {}; files.push(mainFile);   // sx.state: a format that is not read line by line hands over the events of the session whole   // runs: workflow run → { agents (file name → agent id), by (who launched it), toolId, done }
  for (const x of subs) {
    const aid = x.aid, m = x.meta || readMeta(x.file.replace(/\.jsonl$/, '.meta.json'));
    agents[aid] = { id: aid, role: m.description || m.workflowPhase || m.agentType || 'Agent', type: m.agentType || 'agent', toolUseId: m.toolUseId };
    if (x.run) { agents[aid].wf = x.run; if (m.workflowPhase) agents[aid].phase = m.workflowPhase; (runs[x.run] = runs[x.run] || { agents: {}, done: new Set() }).agents[x.id0] = aid; }   // launched by a workflow: no Agent call of the lead points at it
    agents[aid].mtime = x.mtime || mtimeOf(x.file) || undefined;
    const st = x.st || readNew(x.file, aid, false, rec); if (st) states.push(st); files.push(x.file);
  }
  for (const j of subs.journals) { const st = readNew(j.file, 'wf:' + j.run, true), run = runs[j.run]; files.push(j.file); if (st && run) for (const e of st.raw) if (run.agents[e.child]) run.done.add(run.agents[e.child]); }
  const childByTool = {};   // Agent tool_use id → the sub-agent it created, so we know who ordered whom
  for (const a of Object.values(agents)) if (a.toolUseId) childByTool[a.toolUseId] = a.id;
  const called = {}, born = {}; for (const st of states) if (st) { if (st.raw.length) born[st.agent] = st.raw[0].ts; for (const e of st.raw) if (e.kind === 'agentcall' && e.nm && childByTool[e.toolId]) called[childByTool[e.toolId]] = e.nm; }
  const sameName = {}; for (const a of Object.values(agents).filter((x) => x.id !== 'main').sort((x, y) => (born[x.id] || Infinity) - (born[y.id] || Infinity) || (x.id < y.id ? -1 : 1))) {   // in the order they started, so that a second agent of the same name is the one numbered 2 and stays so
    const n = ownName(called[a.id]) || ownName(a.type, true); if (n) { const k = n.toLowerCase(); sameName[k] = (sameName[k] || 0) + 1; a.own = sameName[k] > 1 ? n + ' ' + sameName[k] : n; }
  }
  const runByTool = {}; for (const st of states) if (st) for (const e of st.raw) if (e.kind === 'wfrun' && runs[e.run] && !runs[e.run].by) { runs[e.run].by = e.agent; runs[e.run].toolId = e.toolId; runByTool[e.toolId] = runs[e.run]; }   // Workflow tool_use id → the run it started

  const finished = new Set(), now0 = Date.now(); for (const st of states) if (st) for (const e of st.raw) if (e.kind === 'agentdone') { if (childByTool[e.toolId]) finished.add(childByTool[e.toolId]); else if (runByTool[e.toolId]) for (const a of Object.values(runByTool[e.toolId].agents)) finished.add(a); }   // a run that stopped: so did every agent in it
  for (const run of Object.values(runs)) for (const a of run.done) finished.add(a);
  let recentUntil = 0; for (const a of Object.values(agents)) if (a.id !== 'main' && a.mtime && now0 - a.mtime <= 240000) recentUntil = Math.max(recentUntil, a.mtime + 241000);
  for (const a of Object.values(agents)) if (a.id !== 'main' && now0 - (a.mtime || 0) > 240000) finished.add(a.id);   // old transcripts without a completion record: silent for 4 min counts as finished
  const events = [], parent = {}, doneSeen = new Set(), lastTs = {}; for (const st of states) if (st) lastTs[st.agent] = st.lastTs || 0;
  const finish = (to, ts, by) => { if (!doneSeen.has(to)) { doneSeen.add(to); events.push({ ts, agent: to, kind: 'finish', to: by, k: 'f/' + to }); } };   // one per agent, whichever record says it first: the key is the agent, not the record
  for (const st of states) {
    if (!st) continue;
    let lastSay = -1;   // the last thing a sub-agent says is its report back to the lead
    if (st.agent !== 'main' && finished.has(st.agent)) for (let i = st.raw.length - 1; i >= 0; i--) if (st.raw[i].kind === 'say') { lastSay = i; break; }
    const run = agents[st.agent] && agents[st.agent].wf ? runs[agents[st.agent].wf] : null;
    if (run && st.prompt) { parent[st.agent] = run.by || 'main'; events.push({ ts: st.prompt.ts, agent: parent[st.agent], to: st.agent, kind: 'order', ...(run.toolId ? { toolId: run.toolId } : {}), bg: true, wf: agents[st.agent].wf, text: st.prompt.text, title: agents[st.agent].role, k: 'o/' + st.agent }); }   // the order a workflow gave is the first message of the agent's own file: shown as an order from whoever launched the workflow (the lead when nothing says who), given in the background, when the agent started
    st.raw.forEach((e, i) => {
      if (e.kind === 'agentdone') { const to = childByTool[e.toolId], wr = runByTool[e.toolId]; if (to) finish(to, e.ts, e.agent); else if (wr) for (const a of Object.values(wr.agents)) if (!wr.done.has(a)) finish(a, Math.max(e.ts, lastTs[a] || 0), e.agent); }   // the agents the journal knows about are finished below, at their own time
      else if (e.kind === 'agentcall') { const to = childByTool[e.toolId]; if (to) { parent[to] = e.agent; events.push({ ts: e.ts, agent: e.agent, to, kind: 'order', toolId: e.toolId, bg: e.bg, text: e.text, title: e.title, k: e.k }); } }
      else if (e.kind === 'wfrun' || e.kind === 'wfdone') return;
      else if (i === lastSay) events.push({ ...e, kind: 'report', to: null });   // `to` filled below, once every order is known
      else events.push(e);
    });
    if (run && run.done.has(st.agent) && st.lastTs) finish(st.agent, st.lastTs, parent[st.agent] || 'main');   // the journal has no times: the agent finished when it last wrote
    for (const [mid, mu] of st.msgUsage) events.push({ ts: mu.ts, agent: st.agent, kind: 'usage', u: mu.u, model: mu.model, ...(mu.cw ? { cw: mu.cw } : {}), k: 'u/' + st.agent + '/' + mid });
  }
  for (const e of events) if (e.kind === 'report' && e.to === null) e.to = parent[e.agent] || 'main';

  events.sort((a, b) => a.ts - b.ts);
  const merged = []; let lastReal = -1;   // consecutive tool calls of one agent become one activity beat; usage events are transparent to that rule
  for (const e of events) {
    const p = lastReal >= 0 ? merged[lastReal] : null;
    if (e.kind === 'usage' || e.kind === 'finish' || e.kind === 'compact') { merged.push(e); continue; }
    if (e.kind === 'tool' && p && p.kind === 'tools' && p.agent === e.agent && !p.end) { p.tools.push(e.tool); if (e.end) p.end = 1; }   // a beat keeps the key of its first call; one that closed a turn takes no more calls
    else { merged.push(e.kind === 'tool' ? { ts: e.ts, agent: e.agent, kind: 'tools', tools: [e.tool], ...(e.end ? { end: 1 } : {}), ...(e.th ? { th: e.th } : {}), k: e.k } : e); lastReal = merged.length - 1; }
  }
  const real = merged.find((e) => e.kind !== 'usage' && e.kind !== 'finish' && e.kind !== 'compact'), first = real ? real.ts : 0, last = merged.length ? merged[merged.length - 1].ts : 0;   // time zero = the first thing said or done
  return { id, proj, agents: Object.values(agents), events: merged.map((e) => ({ ...e, t: Math.max(0, e.ts - first) })), durationMs: last - first, recentUntil };
}

// Ask the local `claude` CLI (uses the user's existing login) to map a JSON array of strings to another array. Cached.
const { spawn } = require('child_process');
const cache = new Map();
// Find a usable `claude` binary: explicit setting → PATH → usual install spots → the one bundled with the VS Code Claude Code extension.
let lastTrError = '', claudeCache = null;
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
function bundledClaude() {
  const home = os.homedir(); let best = null;
  for (const dir of ['.vscode', '.vscode-insiders', '.cursor', '.windsurf', '.vscode-oss']) {
    let names; try { names = fs.readdirSync(path.join(home, dir, 'extensions')); } catch { continue; }
    for (const d of names.filter((x) => x.startsWith('anthropic.claude-code-')))
      for (const n of ['claude', 'claude.exe']) { const f = path.join(home, dir, 'extensions', d, 'resources', 'native-binary', n); if (exists(f) && (!best || d.localeCompare(best.d, undefined, { numeric: true }) > 0)) best = { d, f }; }
  }
  return best && best.f;
}
function findClaude() {
  if (claudeCache && exists(claudeCache)) return claudeCache;
  const home = os.homedir(), win = process.platform === 'win32', names = win ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude'], cands = [];
  if (process.env.AGENT_STANDUP_CLAUDE) cands.push(process.env.AGENT_STANDUP_CLAUDE);
  for (const d of (process.env.PATH || '').split(path.delimiter)) for (const n of names) cands.push(path.join(d, n));
  const dirs = win ? [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude')]
    : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.claude/local'), path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), path.join(home, '.bun/bin'), path.join(home, '.volta/bin')];
  try { const nvm = path.join(home, '.nvm', 'versions', 'node'); for (const v of fs.readdirSync(nvm)) dirs.push(path.join(nvm, v, 'bin')); } catch {}
  for (const d of dirs) for (const n of names) cands.push(path.join(d, n));
  const found = cands.find(exists) || bundledClaude() || null;
  return (claudeCache = found);
}
function spawnClaude(args, opts) {
  const bin = findClaude(); if (!bin) { lastTrError = 'not-found'; return null; }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) return spawn('"' + bin + '"', args, { ...opts, shell: true, windowsHide: true });   // npm's Windows shims need a shell
  return spawn(bin, args, { ...opts, windowsHide: true });
}
let running = 0; const queue = [];
const pump = () => { while (running < 3 && queue.length) { running++; queue.shift()(); } };
const schedule = (fn) => new Promise((res, rej) => { queue.push(() => fn().then(res, rej).finally(() => { running--; pump(); })); pump(); });
// Fast path (~1-2 s instead of ~6 s): if the user has an Anthropic API key in the environment, call the API directly.
async function apiMap(prompt, need) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error('no key');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }) });
  const j = await r.json(); const out = j.content[0].text, arr = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1));
  if (arr.length !== need.length) throw new Error('bad length'); return arr;
}
function claudeMap(kind, instruction, texts) {
  const need = [...new Set(texts.filter((t) => !cache.has(kind + '|' + t)))];
  const done = (ok) => ({ texts: texts.map((t) => cache.get(kind + '|' + t) || t), ok });
  if (!need.length) return Promise.resolve(done(true));
  const prompt = instruction + ' Output ONLY a JSON array of strings, same length and order, no markdown.\n' + JSON.stringify(need);
  return apiMap(prompt, need).then((arr) => { need.forEach((t, i) => cache.set(kind + '|' + t, String(arr[i]))); return done(true); }).catch(() => schedule(() => new Promise((resolve) => {
    const p = spawnClaude(['-p', '--model', 'haiku', '--no-session-persistence', '--tools', ''], { cwd: os.tmpdir() }); if (!p) return resolve(done(false));
    let out = ''; const timer = setTimeout(() => p.kill(), 60000);
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(done(false)));
    p.on('close', () => {
      clearTimeout(timer);
      let ok = false;
      try {
        const arr = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1));
        if (arr.length === need.length) { need.forEach((t, i) => cache.set(kind + '|' + t, String(arr[i]))); ok = true; }
      } catch {}
      resolve(done(ok));
    });
    p.stdin.end(prompt);
  })));
}
const translate = (texts) => translateFast(texts);

// Warm `claude` workers: after a slow first call each translation takes ~2-3 s (a cold `claude -p` costs ~6 s).
const TR_INSTR = 'Translate each string of this JSON array into natural spoken French, as a teammate would say it in a meeting. Keep code identifiers, file paths, library names and numbers unchanged.';
const TR_SYS = 'You are a translation engine. Translate the user message into natural spoken French, as a colleague would say it in a meeting. Keep code identifiers, file paths, library names and numbers unchanged. Reply with ONLY the translation, nothing else.';
class TrWorker {
  constructor() { this.q = []; this.busy = false; this.n = 0; this.p = null; this.cur = null; this.buf = ''; }
  start() {
    const p = spawnClaude(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--no-session-persistence', '--tools', '', '--system-prompt', TR_SYS], { cwd: os.tmpdir() });
    if (!p) return;
    this.p = p; this.buf = ''; this.n = 0;
    p.stderr.on('data', (d) => { lastTrError = String(d).slice(-300); });
    p.stdout.on('data', (d) => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const l = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        try { const m = JSON.parse(l); if (m.type === 'result' && this.cur) { if (m.is_error) lastTrError = String(m.result || '').slice(0, 200); else lastTrError = ''; this.finish(m.is_error ? null : String(m.result || '').trim()); } } catch {}
      }
    });
    const dead = () => { if (this.p !== p) return; this.p = null; this.finish(null); };
    p.on('close', dead); p.on('error', dead);
  }
  finish(res) { const c = this.cur; this.cur = null; this.busy = false; if (c) { clearTimeout(c.timer); c.res(res); } this.pump(); }
  ask(text) { return new Promise((res) => { this.q.push({ text, res }); this.pump(); }); }
  kill() { clearTimeout(this.idle); if (this.p) { const p = this.p; this.p = null; try { p.kill(); } catch {} } }
  pump() {
    if (this.busy || !this.q.length) return;
    if (!this.p || this.n >= 30) { if (this.p) { const old = this.p; this.p = null; old.kill(); } this.start(); if (!this.p) { while (this.q.length) this.q.shift().res(null); return; } }   // restart now and then: the conversation context grows
    clearTimeout(this.idle); this.idle = setTimeout(() => { if (!this.busy && !this.q.length) this.kill(); }, 10 * 60 * 1000);   // free the process when nothing was translated for 10 min
    const job = this.q.shift(); this.busy = true; this.n++; this.cur = job;
    job.timer = setTimeout(() => { if (this.cur === job && this.p) this.p.kill(); }, 45000);
    this.p.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: job.text } }) + '\n');
  }
}
const trWorkers = [new TrWorker(), new TrWorker()];
const shutdown = () => { trWorkers.forEach((w) => w.kill()); kokoro.shutdown(); };
process.on('exit', shutdown);
const pickWorker = () => trWorkers.reduce((a, b) => (a.q.length + a.busy <= b.q.length + b.busy ? a : b));
async function translateFast(texts) {
  const need = [...new Set(texts.filter((t) => !cache.has('fr|' + t)))];
  if (need.length && need.length <= 3 && !process.env.ANTHROPIC_API_KEY) {   // a few lines: warm workers in parallel; many lines: one batched call
    await Promise.all(need.map(async (t) => { const r = await pickWorker().ask(t); if (r) cache.set('fr|' + t, r); }));
    return { texts: texts.map((t) => cache.get('fr|' + t) || t), ok: texts.every((t) => cache.has('fr|' + t)) };
  }
  return claudeMap('fr', TR_INSTR, texts);
}
const quips = (texts, lang) => claudeMap('q' + lang, `Each string is a work report from a software agent. For each, write ONE short, deadpan, funny reaction (max 12 words) from a grumpy teammate in a South Park-style cartoon meeting, in ${lang === 'fr' ? 'French' : 'English'}. No emojis.`, texts);

// ---- text-to-speech, generated on the machine and cached as wav:
//      macOS → `say`, Windows → System.Speech (SAPI voices) through PowerShell, Linux → espeak-ng.
let sayVoices = null, sayVoicesJob = null;
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
const VOICES_CMD = MAC ? ['say', ['-v', '?'], 5000] : WIN ? ['powershell.exe', [...PS, "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }"], 20000] : ['espeak-ng', ['--voices'], 5000];
function parseVoices(out) {
  const voices = [];
  if (MAC) { for (const line of out.split('\n')) { const m = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#/); if (m) voices.push({ name: m[1].trim(), locale: m[2] }); } }
  else if (WIN) { for (const line of out.split(/\r?\n/)) { const [name, loc] = line.trim().split('|'); if (name && loc) voices.push({ name, locale: loc.replace('-', '_') }); } }
  else for (const line of out.split('\n').slice(1)) { const c = line.trim().split(/\s+/); if (c[1] && /^(fr|en)/.test(c[1])) voices.push({ name: c[1], locale: c[1].replace('-', '_').replace(/^(\w{2})$/, (m) => m + '_' + m.toUpperCase()) }); }
  return { available: voices.length > 0, voices, platform: process.platform };
}
function listVoices() {
  if (sayVoices) return sayVoices;
  let out = ''; try { out = execFileSync(VOICES_CMD[0], VOICES_CMD[1], { encoding: 'utf8', timeout: VOICES_CMD[2], windowsHide: true }); } catch {}
  return (sayVoices = parseVoices(out));
}
function loadVoices() {   // the same list for the page, asked without waiting: the first answer of the system takes a second or more, and the session the page asks for at the same moment must not wait behind it
  if (sayVoices) return Promise.resolve(sayVoices);
  return sayVoicesJob || (sayVoicesJob = new Promise((resolve) => { try { execFile(VOICES_CMD[0], VOICES_CMD[1], { encoding: 'utf8', timeout: VOICES_CMD[2], windowsHide: true }, (err, out) => resolve(sayVoices || (sayVoices = parseVoices(err ? '' : String(out))))); } catch { resolve(sayVoices || (sayVoices = parseVoices(''))); } }));
}
const ttsDir = path.join(os.tmpdir(), 'agent-standup-tts-' + (process.getuid ? process.getuid() : 'user'));
try { fs.mkdirSync(ttsDir, { recursive: true, mode: 0o700 }); } catch {}
const ttsJobs = new Map();
try { for (const f of fs.readdirSync(ttsDir)) { const p = path.join(ttsDir, f); if (Date.now() - fs.statSync(p).mtimeMs > 864e5) fs.unlinkSync(p); } } catch {}   // drop cached audio older than a day
function synthesize(voice, wpm, text, out) {
  return new Promise((resolve, reject) => {
    let p; text = text.replace(/\[\[[^\]]*\]\]/g, ' ').replace(/\[(?=\[)/g, '[ ').replace(/\](?=\])/g, '] ');   // macOS `say` obeys commands written between [[ and ]] (a 30-second silence, another voice, another speed) and this text comes from a transcript: they are taken out, and no two brackets are left side by side
    if (MAC) p = spawn('say', ['-v', voice, '-r', String(wpm), '--data-format=LEI16@22050', '-o', out, '--', text]);
    else if (WIN) {
      const rate = Math.max(-6, Math.min(8, Math.round((wpm - 175) / 12)));   // SAPI rate: -10..10
      p = spawn('powershell.exe', [...PS, '$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice($env:AS_VOICE); $s.Rate = [int]$env:AS_RATE; $s.SetOutputToWaveFile($env:AS_OUT); $s.Speak($env:AS_TEXT); $s.Dispose()'],
        { env: { ...process.env, AS_VOICE: voice, AS_RATE: String(rate), AS_OUT: out, AS_TEXT: text }, windowsHide: true });
    } else p = spawn('espeak-ng', ['-v', voice, '-s', String(wpm), '-w', out, '--', text]);
    p.on('error', reject); p.on('close', (code) => (code === 0 && fs.existsSync(out) ? resolve() : reject(new Error('tts failed'))));
  });
}
function tts(text, voice, rate, engine, fb) {
  const kk = engine === 'kokoro';
  if (kk) { if (!kokoro.hasVoice(voice)) return Promise.reject(new Error('unknown voice')); }
  else { const vs = listVoices(); if (!vs.available || !vs.voices.some((v) => v.name === voice)) return Promise.reject(new Error('unknown voice')); }
  text = String(text).slice(0, kk ? 1500 : 700); rate = Math.max(90, Math.min(360, Math.round(+rate || 180)));
  const key = crypto.createHash('sha1').update([kk ? 'kokoro2' : 'system', voice, rate, text].join('|')).digest('hex'), file = path.join(ttsDir, key + '.wav');   // kokoro2: clips made before 1.25.10 could be cut short and must not be played again
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (ttsJobs.has(key)) return ttsJobs.get(key);
  fs.mkdirSync(ttsDir, { recursive: true });
  const tmp = file + '.part.wav';
  const job = (kk ? kokoro.synth(text, voice, kokoro.speedFor(rate), tmp).catch((e) => { const vs = listVoices(), v = vs.voices.find((x) => x.name === fb) || vs.voices.find((x) => x.locale.startsWith('en_')); if (!v) throw e; return synthesize(v.name, rate, text, tmp); }) : synthesize(voice, rate, text, tmp))   // a line Kokoro cannot make goes to a system voice instead of being dropped: the one the page names (fb, its best system voice for this character), or else the first English one
    .then(() => { fs.renameSync(tmp, file); return file; }).finally(() => ttsJobs.delete(key));
  ttsJobs.set(key, job); return job;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

// ---- Custom characters: the person's own pixel art replaces the drawn characters. Plain image files in one folder, nothing else is ever served from it.
//   lead.png / claude.png → the lead · you.png → the human · any other image → a pool for the sub-agents · name-talk.png → optional open-mouth frame of name.png
const CHAR_NAME = /^[\w][\w .()\-]{0,78}\.(png|gif|webp|jpe?g)$/i, CHAR_MAX = 300 * 1024, CHAR_TYPES = { png: 'image/png', gif: 'image/gif', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const charactersDir = () => process.env.AGENT_STANDUP_CHARACTERS || path.join(os.homedir(), '.agent-standup', 'characters');
// lstat, not stat: a symlink is not a regular file, so it is skipped and never served
// Built-in character packs, shipped with the app (examples/<folder>): picked in ⚙ → Characters. examples/characters stays in the repository as a model for one's own folder; it is not shipped
const PACKS = { cats: 'cats' }, packDir = (name) => (Object.prototype.hasOwnProperty.call(PACKS, name) ? path.join(__dirname, 'examples', PACKS[name]) : null);   // its own names only: 'constructor' or 'toString' is not a pack (they answered 500)
function listCharacters(pack) {
  const dir = pack ? packDir(pack) : charactersDir(); let names = []; if (!dir) return { dir: '', max: CHAR_MAX, chars: [] }; try { names = fs.readdirSync(dir); } catch {}
  const ok = names.filter((f) => CHAR_NAME.test(f)).filter((f) => { try { const st = fs.lstatSync(path.join(dir, f)); return st.isFile() && st.size <= CHAR_MAX; } catch { return false; } }).slice(0, 80);
  const stem = (f) => f.replace(/\.[^.]+$/, ''), by = new Map(ok.map((f) => [stem(f).toLowerCase(), f]));
  const chars = ok.filter((f) => !/-talk$/i.test(stem(f))).map((f) => { const st = stem(f), l = st.toLowerCase();
    return { stem: st, file: f, talk: by.get(l + '-talk') || null, role: /^(lead|claude)$/.test(l) ? 'lead' : /^(you|human|user)$/.test(l) ? 'you' : 'agent' }; }).sort((a, b) => a.stem.localeCompare(b.stem));
  return { dir, max: CHAR_MAX, chars };
}
let audioOwner = { id: null, seen: 0 };
function start(port = PORT) {
  return http.createServer((req, res) => {
  let url; try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end('bad request'); }   // "GET //" is not an address: answered, where it used to stop the whole server
  req.on('error', () => {}); res.on('error', () => {});   // a browser that goes away mid-request is not our problem
  // Only the local machine may talk to this server: blocks other websites (cross-site requests) and DNS-rebinding attempts.
  const local = (h) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h || '');
  let originOk = true; try { originOk = !req.headers.origin || local(new URL(req.headers.origin).host); } catch { originOk = false; }
  if (!local(req.headers.host) || !originOk) { res.writeHead(403); return res.end('forbidden'); }
  const json = (o, code = 200) => { try { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); } catch { res.destroy(); } };   // also called from callbacks that run later, where nothing would catch an exception
  const sendFile = (fp) => { const s = fs.createReadStream(fp); s.on('error', () => res.destroy()); s.pipe(res); };   // a file that vanished between the check and the read ends this answer, not the server
  // Endpoints with side effects (they spawn programs or claim the sound), and the one that serves pictures from a session, refuse requests that a browser marks as coming from another site, e.g. an <img> on a web page.
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && sfs !== 'same-origin' && sfs !== 'none' && (req.method !== 'GET' || ['/api/translate', '/api/quips', '/api/warm', '/api/audio', '/api/tts', '/api/prefs', '/api/prefs.js', '/api/voices', '/api/kokoro', '/api/kokoro/install', '/api/media'].includes(url.pathname))) { res.writeHead(403); return res.end('forbidden'); }
  const readBody = (cb) => {   // request bodies are small JSON: stop reading beyond 256 KB and give up after 10 s
    const chunks = []; let size = 0, over = false; req.setTimeout(10000, () => req.destroy());
    if (+req.headers['content-length'] > 262144) { res.writeHead(413); res.end('too large'); return req.destroy(); }
    req.on('data', (d) => { if (over) return; size += d.length; if (size > 262144) { over = true; res.writeHead(413); res.end('too large'); req.destroy(); } else chunks.push(d); });   // bytes, not characters
    req.on('end', () => { if (!over) cb(Buffer.concat(chunks).toString('utf8')); });
  };
  const textList = (x) => (Array.isArray(x) ? x : []).slice(0, 200).map((t) => String(t).slice(0, 2000));
  try {
    if (url.pathname === '/api/translate' && req.method === 'POST') return readBody(async (body) => { try { json(await translate(textList(JSON.parse(body).texts))); } catch (e) { json({ error: String(e) }, 400); } });
    if (url.pathname === '/api/quips' && req.method === 'POST') return readBody(async (body) => { try { const b = JSON.parse(body); json(await quips(textList(b.texts), b.lang === 'fr' ? 'fr' : 'en')); } catch (e) { json({ error: String(e) }, 400); } });
    if (url.pathname === '/api/sessions') return json(listSessions());
    if (url.pathname === '/api/projects') {   // projects (working folders) ordered by latest activity — lets the live view follow one of them
      const m = new Map(); for (const r of listSessions()) { const p = m.get(r.proj) || { proj: r.proj, mtime: 0, sessions: 0 }; p.mtime = Math.max(p.mtime, r.mtime); p.sessions++; m.set(r.proj, p); }
      return json([...m.values()].sort((a, b) => b.mtime - a.mtime));
    }
    if (url.pathname === '/api/audio') {   // only one window at a time plays sound: the last one that claimed it (expires if that window stops answering)
      const cid = url.searchParams.get('cid') || '', ok = /^[\w-]{4,40}$/.test(cid);
      if (ok && url.searchParams.get('claim')) audioOwner = { id: cid, seen: Date.now() };
      else if (ok && audioOwner.id === cid) audioOwner.seen = Date.now();
      if (audioOwner.id && Date.now() - audioOwner.seen > 6000) audioOwner = { id: null, seen: 0 };
      return json({ owner: audioOwner.id });
    }
    if (url.pathname === '/api/health') return json({ claude: findClaude(), apiKey: !!process.env.ANTHROPIC_API_KEY, trError: lastTrError, platform: process.platform });
    if (url.pathname === '/api/warm') { trWorkers.forEach((w) => { if (!w.p) w.start(); }); return json({ ok: true }); }
    if (url.pathname === '/api/voices') {
      if (url.searchParams.get('engine') === 'kokoro') { const st = kokoro.status(); if (st.installed && !st.gaveUp) kokoro.warm(); return json({ available: st.installed && !st.gaveUp, ready: st.ready, voices: kokoro.voices(), platform: process.platform, engine: 'kokoro' }); }
      return loadVoices().then((v) => json(v));
    }
    if (url.pathname === '/api/kokoro/install' && req.method === 'POST') return json(kokoro.install());
    if (url.pathname === '/api/kokoro') return json(kokoro.status());
    if (url.pathname === '/api/tts') {
      return tts(url.searchParams.get('text') || '', url.searchParams.get('voice'), url.searchParams.get('rate'), url.searchParams.get('engine'), url.searchParams.get('fb'))
        .then((f) => { res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'max-age=86400' }); sendFile(f); })
        .catch((e) => json({ error: String(e.message) }, 400));
    }
    if (url.pathname === '/api/prefs.js') { res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' }); return res.end('window.SAVED_PREFS = ' + JSON.stringify(readPrefs()).replace(/</g, '\\u003c') + ';'); }
    if (url.pathname === '/api/prefs' && req.method === 'PUT') return readBody((body) => { try { const v = JSON.parse(body); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('prefs must be an object'); writePrefs(v); json({ ok: true }); } catch (e) { json({ error: String(e.message || e) }, 400); } });
    if (url.pathname === '/api/prefs') return json(readPrefs() || {});
    if (url.pathname === '/api/current') return json(currentSession(url.searchParams.get('proj') || '', url.searchParams.get('id') || '', { proj: url.searchParams.get('sproj') || '', id: url.searchParams.get('sid') || '' }));
    if (url.pathname === '/api/board') return json(boardRows());
    if (url.pathname === '/api/characters') return json(listCharacters(url.searchParams.get('pack') || ''));
    if (url.pathname === '/api/packs') return json(Object.keys(PACKS).map((name) => ({ name, n: listCharacters(name).chars.length })));
    if (url.pathname === '/api/media') {
      const q = (k) => url.searchParams.get(k) || '', SAFE = /^[\w.\-]+$/, n = +q('n') || 0, bad = [q('proj'), q('id'), q('agent'), q('tool')].some((v) => !SAFE.test(v) || v === '..' || v.length > 200) || q('tool').length < 6;   // no tool call has an id that short, and looking for one meant reading the whole transcript
      const file = bad || !Number.isInteger(n) || n < 0 || n > 9 ? null : mediaFile(q('proj'), q('id'), q('agent')), im = file && toolImage(file, q('tool'), n);
      if (!im) { res.writeHead(bad ? 400 : 404); return res.end(bad ? 'bad request' : 'not found'); }
      res.writeHead(200, { 'content-type': im.type, 'content-length': im.buf.length, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' }); return res.end(im.buf);
    }
    if (url.pathname === '/api/session') {
      const proj = url.searchParams.get('proj') || '', sid = url.searchParams.get('id') || '', SAFE = /^[\w.\-]+$/;
      if (!SAFE.test(proj) || !SAFE.test(sid) || proj === '..' || sid === '..' || proj.length > 200 || sid.length > 200) { res.writeHead(400); return res.end('bad request'); }
      if (proj !== '_demo' && !(sourceOf(proj) ? sourceOf(proj).fileOf(sid) : fs.existsSync(path.join(ROOT, proj, sid + '.jsonl')))) return json({ error: 'session not found' }, 404);
      const entry = proj === '_demo' ? demoEntry() : timelineEntry(proj, sid), tl = entry.tl;   // built-in fictional session
      const after = url.searchParams.get('after'), ep = url.searchParams.get('ep');
      if (after == null) {   // the whole timeline: serialize once per version, send gzip-compressed when the browser allows it (12 MB → ~1.5 MB)
        const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
        if (!entry.json) entry.json = JSON.stringify(tl);
        if (gz && !entry.gz) entry.gz = zlib.gzipSync(entry.json, { level: 5 });
        res.writeHead(200, { 'content-type': 'application/json', ...(gz ? { 'content-encoding': 'gzip' } : {}), vary: 'accept-encoding' });
        return res.end(gz ? entry.gz : entry.json);
      }
      if (ep == null) return json({ id: tl.id, agents: tl.agents, total: tl.events.length, events: tl.events.slice(+after) });   // a page loaded before 1.25.7 still asks by position
      const a = +after; if (ep !== tl.ep || !(a >= 0 && a <= tl.seq)) return json({ resync: true });   // not the feed this page was following (restart, session dropped from memory, transcript rewritten): it loads the session again
      if (a === tl.seq) { if (!entry.idle) entry.idle = JSON.stringify({ id: tl.id, agents: tl.agents, ep: tl.ep, seq: tl.seq, events: [] }); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(entry.idle); }   // nothing new, which is the answer to nearly every poll: written once
      return json({ id: tl.id, agents: tl.agents, ep: tl.ep, seq: tl.seq, events: feedSince(entry, a) });   // new events and changed ones alike, whole, under the key they always had
    }
    const pk = url.pathname.match(/^\/packs\/([a-z]+)\/(.*)$/);
    if (url.pathname.startsWith('/characters/') || (pk && packDir(pk[1]))) {   // only plain image files of the characters folder (or of a built-in pack), by exact name
      let f = ''; try { f = decodeURIComponent(pk ? pk[2] : url.pathname.slice('/characters/'.length)); } catch {}
      const dir = pk ? packDir(pk[1]) : charactersDir(), fp = path.join(dir, f);
      try { const ls = fs.lstatSync(fp); if (!CHAR_NAME.test(f) || !fp.startsWith(dir + path.sep) || !ls.isFile() || ls.size > CHAR_MAX) throw 0; } catch { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': CHAR_TYPES[f.split('.').pop().toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' }); return sendFile(fp);
    }
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
    let fst = null; try { fst = fs.statSync(file); } catch {}
    if (!file.startsWith(PUBLIC + path.sep) || !fst || !fst.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  } catch (e) { if (res.headersSent) return res.destroy(); json({ error: String(e.message || e) }, 500); }
  }).listen(port, '127.0.0.1', function () { console.log(`Agent Standup → http://localhost:${this.address().port}`); });
}
module.exports = { start, currentSession, shutdown, findClaude, bundledClaude, boardRows, charactersDir, listCharacters };
if (require.main === module) {
  start().on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use (maybe Agent Standup is already running, e.g. inside VS Code). Try: PORT=4790 node server.js` : String(e));
    process.exit(1);
  });
}
