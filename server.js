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
const reply = require('./reply.js');     // the human's line, typed into the session's tmux pane (see reply.js); off unless AGENT_STANDUP_REPLY=on
const SOURCES = [codex, vibe], sourceOf = (proj) => SOURCES.find((m) => m.PROJ === proj) || null, guard = (fn, or) => { try { return fn(); } catch (e) { logError('reader', e); return or; } };   // guard: a session of another tool that cannot be read costs that session, never the list   // the tools other than Claude Code: each lists its sessions under one made-up project
const kokoro = require('./kokoro.js');   // natural voices, installed on demand (see kokoro.js)
const zlib = require('zlib');
const { execFileSync, execFile } = require('child_process');

const PORT = process.env.PORT || 4747;
const REPLY_TOKEN = crypto.randomBytes(24).toString('hex'), replyTokenOk = (t) => { if (typeof t !== 'string') return false; const a = Buffer.from(t), b = Buffer.from(REPLY_TOKEN); return a.length === b.length && crypto.timingSafeEqual(a, b); };   // made at each start, given only to the page through /api/prefs.js
// Same place Claude Code writes to: honours CLAUDE_CONFIG_DIR (custom config dirs are common on Linux); AGENT_STANDUP_PROJECTS overrides it.
const ROOT = process.env.AGENT_STANDUP_PROJECTS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const PUBLIC = path.join(__dirname, 'public');
// Cowork, a tab of the Claude desktop app, keeps each of its sessions in the app's own folder, in the format of Claude Code: <folder>/<account>/<organisation>/<session>/.claude/projects/<project>/<id>.jsonl.
// They are listed under one made-up project, as the sessions of the other tools are, and read like any Claude Code session from there on.
// Where: AGENT_STANDUP_COWORK (a folder; "0" or "off" turns them off), else where the desktop app keeps its files on this system. When AGENT_STANDUP_PROJECTS points the app at one folder (--projects, the tests), only if asked for.
const COWORK = '_cowork';
function coworkHomes() {
  const v = process.env.AGENT_STANDUP_COWORK, home = os.homedir(), sub = 'local-agent-mode-sessions';
  if (v != null) return /^(0|off|no|false)?$/i.test(v.trim()) ? [] : [v];
  if (process.env.AGENT_STANDUP_PROJECTS) return [];
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Claude', sub)];
  if (process.platform !== 'win32') return [path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude', sub)];
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), out = [path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', sub)];
  try { for (const p of fs.readdirSync(path.join(local, 'Packages'))) if (/claude/i.test(p)) out.push(path.join(local, 'Packages', p, 'LocalCache', 'Roaming', 'Claude', sub)); } catch {}   // installed as a Windows package, the app has its folder there
  return out;
}
let coworkMemo = { at: 0, key: null, map: new Map() };
function coworkMap() {   // session id → the folder its transcript is in; looked up again every 3 s, and at once when the place to look changes
  const homes = coworkHomes(), key = homes.join('\n'), now = Date.now(); if (coworkMemo.key === key && now - coworkMemo.at < 3000) return coworkMemo.map;
  const map = new Map(), ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
  for (const h of homes) for (const a of ls(h)) for (const o of ls(path.join(h, a))) for (const s of ls(path.join(h, a, o))) {
    if (s.endsWith('.json')) continue;   // what the app notes about a session, next to its folder
    const pd = path.join(h, a, o, s, '.claude', 'projects');
    for (const p of ls(pd)) for (const f of ls(path.join(pd, p))) if (/^[\w.\-]+\.jsonl$/.test(f) && !map.has(f.slice(0, -6))) map.set(f.slice(0, -6), path.join(pd, p));
  }
  coworkMemo = { at: now, key, map }; return map;
}
const coworkNotes = new Map();   // note file → { sig, title }
function coworkTitle(proj, id) {   // the name the desktop app gave the session, the one its own list shows: kept in a note beside the session's folder, of which the title alone is taken
  const dir = proj === COWORK && coworkMap().get(id); if (!dir) return '';
  const f = path.resolve(dir, '..', '..', '..') + '.json'; let st; try { st = fs.statSync(f); } catch { return ''; }
  const sig = st.mtimeMs + ':' + st.size, c = coworkNotes.get(f); if (c && c.sig === sig) return c.title;
  let title = ''; try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (typeof j.title === 'string') title = j.title.trim().slice(0, 200); } catch {}
  coworkNotes.set(f, { sig, title }); return title;
}
const projDir = (proj, id) => (proj === COWORK && coworkMap().get(id)) || path.join(ROOT, proj);   // the folder that holds <id>.jsonl and the sub-agents of that session
const projects = () => { let names = []; try { names = fs.readdirSync(ROOT); } catch {} return coworkMap().size ? names.concat(COWORK) : names; };
function transcripts(proj) {   // the sessions of a project: { id, file }
  const cw = proj === COWORK ? coworkMap() : null; if (cw && cw.size) return [...cw].map(([id, dir]) => ({ id, file: path.join(dir, id + '.jsonl') }));
  const dir = path.join(ROOT, proj); let files; try { files = fs.readdirSync(dir); } catch { return []; }
  return files.filter((f) => f.endsWith('.jsonl')).map((f) => ({ id: f.slice(0, -6), file: path.join(dir, f) }));
}

const blocks = (rec) => {
  const c = rec.message && rec.message.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c : [];
};
const clip = (x, n = 700) => String(x == null ? '' : x).slice(0, n);
// The documents a command names, in its text or in what it printed: an export, a report, a picture, a package. The call shows one under it when the lead names it too
// and it was written since (see sessionFile): a name is all that is taken here, nothing is read. cd: a command, where "cd dir &&" says from which folder the names that follow are given.
const OUT_EXT = /\.(html?|md|markdown|txt|rtf|pdf|docx?|pptx?|xlsx?|csv|tsv|png|jpe?g|gif|webp|svg|zip|tgz|vsix|mp4|mov|webm|mp3|wav|epub)$/i, ROOTED = /^([~\/\\]|[A-Za-z]:[\\/])/;
function noHere(t) {   // a command without what its here-documents hold: that is a file's content, not the command (the rest of the line that opens one is: "> list.txt"). Read once from left to right, a few of them at most: a text full of "<<" (C++, shifts) costs nothing
  let out = '', i = 0; const open = /<<-?[ \t]*(['"]?)(\w+)\1/y;
  for (let n = 0; n < 8; n++) {
    const j = t.indexOf('<<', i); if (j < 0) break; open.lastIndex = j; const m = t[j - 1] !== '<' && t[j + 2] !== '<' && open.exec(t); if (!m) { out += t.slice(i, j + 2); i = j + 2; continue; }
    const eol = t.indexOf('\n', open.lastIndex); if (eol < 0) return out + t.slice(i, j) + ' ' + t.slice(open.lastIndex);
    out += t.slice(i, j) + ' ' + t.slice(open.lastIndex, eol); i = t.length;   // to the line that closes it, or to the end when none does
    for (let a = eol + 1; a <= t.length;) { const b = t.indexOf('\n', a), line = t.slice(a, b < 0 ? t.length : b); if (line.trim() === m[2]) { i = b < 0 ? t.length : b; break; } if (b < 0) break; a = b + 1; }
  }
  return out + t.slice(i);
}
function docPaths(text, cd) {
  const out = []; let dir = '';
  const cmd = cd ? noHere(String(text || '').slice(0, 20000)) : String(text || '').slice(0, 20000);
  for (const seg of cmd.split(cd ? /&&|\|\||;|\n/ : /\n/)) {
    const m = cd && seg.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/); if (m) { const d = m[1] || m[2] || m[3]; dir = ROOTED.test(d) ? d : path.join(dir, d); continue; }
    for (const t of seg.matchAll(/"([^"\n]+)"|'([^'\n]+)'|([^\s"'`|&;<>()=,]+)/g)) {
      const f = (t[1] || t[2] || t[3]).replace(/[.:;!?)\]]+$/, ''); if (!OUT_EXT.test(f) || /:\/\/|[*?{}$\[]|^(\\\\|\/\/)/.test(f) || f.length > 400) continue;   // not a link, a pattern or a variable, nor a path on another machine (the server would go and look there)
      const full = dir && !ROOTED.test(f) ? path.join(dir, f) : f; if (!out.includes(full)) out.push(full); if (out.length >= 16) return out;
    }
  }
  return out;
}
const absPath = (f, cwd) => (/^~([\\/]|$)/.test(f) ? path.join(os.homedir(), f.slice(1)) : path.isAbsolute(f) ? path.normalize(f) : cwd ? path.resolve(cwd, f) : f);   // cwd: the folder the session was in when it wrote that record
// What each tool call looks like on a screen ("d"), plus its id/timestamp so the result can be matched later.
const toolLabel = (b, ts) => {
  const i = b.input || {};
  const q0 = Array.isArray(i.questions) && i.questions[0] ? i.questions[0] : null, mcp = /^mcp__/.test(b.name) ? b.name.split('__') : null, firstStr = mcp ? Object.values(i).find((v) => typeof v === 'string') : '';
  const arg = i.file_path || i.notebook_path || i.path || i.pattern || i.command || i.url || i.query || i.skill || (q0 && q0.question) || i.description || firstStr || '';
  const out = { id: b.id, ts, name: b.name, arg: String(arg).slice(0, 90) };
  switch (b.name) {
    case 'Bash': { out.d = { kind: 'cmd', text: clip(i.command, 1200), note: clip(i.description, 140) }; const outs = docPaths(i.command, true); if (outs.length) out.d.outs = outs; break; }
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
    case 'Artifact': if ((!i.action || i.action === 'publish') && !i.asset) { out.d = { kind: 'artifact', file: typeof i.file_path === 'string' ? i.file_path : '', title: clip(i.title, 120), note: clip(i.description, 240) }; const sent = i.files ? artSentOf(i) : [], pg = !/\.html?$/i.test(out.d.file) && sent.find((f) => /\.html?$/i.test(f)); if (sent.length > 1) out.d.sent = sent; if (pg) out.d.page = pg; break; }   // a page published on claude.ai: the call shows it in a browser window (see artifactPage). Any other use of the tool (a read, a list, an upload) is a call like any other
    if (i.action === 'open') { out.d = { kind: 'artifact', file: '', title: '', note: '', open: 1 }; break; }   // a page put on the person's screen: in the line of files when this session did not make it (see artOf)
    // falls through
    default: if (mcp && /(^|_)Claude_Docs$/.test(mcp[1] || '') && mcp[2] === 'batch' && i.container && i.container.create && typeof i.container.create.name === 'string') { out.d = { kind: 'artifact', file: '', title: clip(i.container.create.name, 120), note: '', doc: 1 }; break; }   // a doc of the Claude Docs connector being born (its later edits are calls like any other)
      out.d = mcp ? { kind: 'text', what: 'mcp', v: (mcp[1] || '') + ' · ' + (mcp.slice(2).join('__') || ''), text: clip(JSON.stringify(i), 400) } : { kind: 'text', text: clip(JSON.stringify(i), 300) };
  }
  return out;
};
// What a publish answered: the link of the page on claude.ai, its title and which version this is. typed: made from an Artifact type (a deck, a design, a document), whose page is the type's and not the file that was sent.
// What a publish sent along with its files (the artboards of a design, its canvas.json), as absolute paths, the way the Write calls that made them name them. page: the page of a publish whose main file is not one.
function artSentOf(i) {
  const out = [], root = typeof i.root === 'string' && path.isAbsolute(i.root) ? i.root : '', add = (f) => { const p = typeof f !== 'string' || !f ? '' : path.isAbsolute(f) ? f : root ? path.join(root, f) : ''; if (p && !out.includes(p) && out.length < 60) out.push(p); };
  add(i.file_path); for (const v of Array.isArray(i.files) ? i.files : i.files && typeof i.files === 'object' ? Object.values(i.files) : []) add(typeof v === 'string' ? v : v && (v.from || v.path));
  return out;
}
const ART_URL = /^https:\/\/claude\.ai\/(code\/)?artifact\/[\w-]{6,80}$/;
const artifactOf = (u) => (u && typeof u === 'object' && typeof u.url === 'string' && ART_URL.test(u.url) ? { url: u.url, title: clip(u.title, 120), ...(u.seq > 0 ? { v: +u.seq } : {}), ...(u.type || u.created_from_type ? { typed: 1 } : {}) } : null);
// What a call that put an artifact in front of the person answered, for the line of files: a publish (above); a doc the Claude Docs connector created, whose answer names the doc and its address;
// an artifact opened on the person's screen, only when this session did not publish or create it already (the same artifact under its other address would show twice, and an open would take the place of the publish that has the preview).
const DOC_ID = /"created":\{[^{}]*"minted":"([\w-]{6,80})"/, DOC_URL = /"frame":\{[^{}]*"url":"(https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]{6,80})"/;
function artOf(st, how, u, text) {
  const seen = (st.artIds = st.artIds || new Set()), note = (id, url) => { if (id) seen.add('id ' + id); seen.add('url ' + url); };   // known by its id and by its address: a publish may answer without an id
  if (how === 'doc') { const id = DOC_ID.exec(text), m = DOC_URL.exec(text); if (!id || !m || !ART_URL.test(m[1])) return null; note(id[1], m[1]); return { url: m[1], title: '', typed: 1 }; }
  const a = artifactOf(u), id = a && typeof u.artifact_id === 'string' ? u.artifact_id : ''; if (!a) return null;
  if (how === 'open') { if ((id && seen.has('id ' + id)) || seen.has('url ' + a.url)) return null; note(id, a.url); return { ...a, typed: 1 }; }   // opened, not made here: the window gives its title and its link
  note(id, a.url); return a;
}
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text || '').join('\n') : '');
// Pictures a tool returned (a screenshot, an image file that was read). They are served from the transcript itself, so nothing outside the session files is ever read, and only bitmap types are sent.
const IMG_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']), mediaMemo = new Map();
const isImg = (x) => !!x && x.type === 'image' && !!x.source && x.source.type === 'base64' && typeof x.source.data === 'string' && IMG_TYPES.has(x.source.media_type);
const resultImages = (c) => (Array.isArray(c) ? c.filter(isImg) : []);
const mtimeOf = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };   // 0 for a file that is gone, or a symlink that points nowhere: never an exception
// Every sub-agent transcript of a session: <id>/subagents/*.jsonl, plus the ones a workflow launched, one folder deeper in <id>/subagents/workflows/<run>/agent-*.jsonl (each run also keeps a journal.jsonl, which is not an agent).
function subFiles(proj, id) {
  const sd = path.join(projDir(proj, id), id, 'subagents'), out = [], seen = new Set(['main', 'user']); out.dirs = [sd]; out.journals = [];
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
const subFilesOf = (proj, id) => { const sx = sourceOf(proj); return sx && sx.subFiles ? guard(() => sx.subFiles(id), Object.assign([], { dirs: [], journals: [] })) : subFiles(proj, id); };   // Mistral Vibe keeps its sub-agents its own way
function mediaFile(proj, sid, agent) {
  if (agent === 'main') return path.join(projDir(proj, sid), sid + '.jsonl');
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
// ---- Artifacts: a page a session published on claude.ai is shown in the call, in a browser window on the shared screen. claude.ai lets no other page frame it, and the file that was published
// is most often in a temporary folder that is emptied later: the page is put together again from the session file, which keeps in full the Write call that created it and the Edit calls that followed,
// up to the publish that is asked for (so an old session shows each version as it was). Nothing outside the session files is read, as for the pictures. An artifact made from a type (a design) shows the page
// that publish sent, an artboard, without the type's own page around it, which only claude.ai has: its scripts do not run, the rest of it reads as it is. A page made another way (by a command,
// or written by another agent) has no preview: the call shows its title and its link. The page is served to a frame that can reach neither this server nor, unless the person asked, the network (see /api/artifact).
const artMemo = new Map(), ART_MAX = 8 * 1024 * 1024;
const editOnce = (text, e) => { const a = e && typeof e.old_string === 'string' ? e.old_string : '', b = e && typeof e.new_string === 'string' ? e.new_string : ''; if (!a) return text; if (e.replace_all) return text.split(a).join(b); const i = text.indexOf(a); return i < 0 ? text : text.slice(0, i) + b + text.slice(i + a.length); };
function artifactFiles(file, wants) {   // wants: [{ fp, until }] → for each, the text of the file at fp as it was when the publish until sent it, or null. One pass over the session file for them all
  const key = file + '|' + wants.map((w) => w.fp + '@' + w.until).join('|'), memo = artMemo.get(key); if (memo && memo.found) return memo.found;
  const W = wants.map((w) => ({ fp: w.fp, until: w.until, path: Buffer.from(JSON.stringify(w.fp).slice(1, -1)), id: Buffer.from('"' + w.until + '"'), ops: [], seen: false }));
  const errMark = Buffer.from('"is_error":true'), until = Date.now() + 2000, failed = new Set(); let fd, carry = Buffer.alloc(0), pos = 0, size = 0;
  try {
    fd = fs.openSync(file, 'r'); size = fs.fstatSync(fd).size; if (memo && memo.miss === size) return W.map(() => null);   // already looked for in vain, and nothing was written since
    while (pos < size && Date.now() < until) {
      const buf = Buffer.alloc(Math.min(8 * 1024 * 1024, size - pos)); fs.readSync(fd, buf, 0, buf.length, pos); pos += buf.length;
      const all = carry.length ? Buffer.concat([carry, buf]) : buf; let a = 0;
      for (let b; (b = all.indexOf(10, a)) >= 0; a = b + 1) {
        const line = all.subarray(a, b), mine = W.some((w) => !w.seen && (line.indexOf(w.path) >= 0 || line.indexOf(w.id) >= 0)); if (!mine && line.indexOf(errMark) < 0) continue;
        let r; try { r = JSON.parse(line.toString('utf8')); } catch { continue; }
        for (const blk of blocks(r)) {
          if (blk.type === 'tool_result' && blk.is_error) failed.add(blk.tool_use_id);   // a write or an edit that was refused changed nothing (its answer may come after the publish, when both were asked at once)
          if (blk.type !== 'tool_use') continue; const i = blk.input || {}, op = blk.name === 'Write' || blk.name === 'Edit' || blk.name === 'MultiEdit';
          for (const w of W) { if (w.seen) continue; if (blk.id === w.until) w.seen = true; else if (op && i.file_path === w.fp) w.ops.push({ id: blk.id, name: blk.name, i }); }   // what was written after that publish belongs to the next one
        }
      }
      carry = Buffer.from(all.subarray(a));
    }
  } catch {} finally { if (fd != null) fs.closeSync(fd); }
  const found = W.map((w) => {
    let html = null; if (!w.seen || pos < size) return null;
    for (const op of w.ops) {
      if (failed.has(op.id)) continue;
      if (op.name === 'Write') html = typeof op.i.content === 'string' ? op.i.content : null;
      else if (html != null) for (const e of op.name === 'MultiEdit' ? (Array.isArray(op.i.edits) ? op.i.edits : []) : [op.i]) html = editOnce(html, e);
    }
    return html != null && html.length <= ART_MAX ? { html, net: /<script\b[^>]*\bsrc\s*=\s*["']?https?:/i.test(html) } : null;   // net: it names a library kept on another server, which the frame does not load unless asked
  });
  artMemo.delete(key); artMemo.set(key, found.some(Boolean) ? { found } : { miss: size }); if (artMemo.size > 24) artMemo.delete(artMemo.keys().next().value);
  return found;
}
const artifactPage = (file, toolId, fp) => artifactFiles(file, [{ fp, until: toolId }])[0];   // the text of the page at fp as it was when the call toolId published it, or null
// What the call shows for a publish of that very session, published without error: the page it sent. For an artifact made from a type that was sent several pages (the artboards of a design),
// also each page as its last publish up to this one sent it, and the canvas.json that places them, if one was sent: the whole document, once it is made, since claude.ai cannot be shown here.
const CANVAS = /(^|[\\/])canvas\.json$/i;
const ART_LS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');   // the two line ends JSON keeps and a script does not
function artifactPlan(proj, id, agent, toolId) {
  const d = new Map(), ok = new Map(); let url = '', typed = false;
  for (const e of timeline(proj, id).events) {
    if (e.agent !== agent) continue;
    if (e.kind === 'tools') { for (const t of e.tools) if (t.d && t.d.kind === 'artifact') d.set(t.id, t.d); }
    else if (e.kind === 'results') { for (const it of e.items) if (it.art && d.has(it.id)) { ok.set(it.id, it.art.url); if (it.id === toolId) { url = it.art.url; typed = !!it.art.typed; } } }
  }
  const me = d.get(toolId), fp = me ? (typed && me.page) || me.file : ''; if (!url || !/\.html?$/i.test(fp)) return null;   // the page sent beside a canvas.json counts for a template only: a plain artifact is its main file
  const plan = { fp, pages: [], canvas: null }; if (!typed) return plan;
  const last = new Map(); for (const [tid, u] of ok) { if (u === url) for (const f of d.get(tid).sent || [d.get(tid).file]) if (/\.html?$/i.test(f) || CANVAS.test(f)) last.set(f, tid); if (tid === toolId) break; }   // in the order they were first sent
  for (const [f, tid] of last) { if (CANVAS.test(f)) plan.canvas = { fp: f, until: tid }; else plan.pages.push({ fp: f, until: tid }); }
  return plan;
}
function artifactBuild(file, toolId, plan, whole) {   // the page to show, or null. pages, label: how many pages the document has so far, and the name the canvas gives this one
  const one = artifactPage(file, toolId, plan.fp); if (!plan.pages.length) return one;
  const got = artifactFiles(file, plan.canvas ? [...plan.pages, plan.canvas] : plan.pages), list = plan.pages.map((w, k) => ({ fp: w.fp, page: got[k] })).filter((x) => x.page);
  let canvas = null; try { canvas = plan.canvas && got[plan.pages.length] ? JSON.parse(got[plan.pages.length].html) : null; } catch {}
  const boards = canvas && canvas.boards && typeof canvas.boards === 'object' ? canvas.boards : {}, keyOf = (fp) => Object.keys(boards).find((k) => fp === k || fp.endsWith('/' + k)), board = (fp) => (keyOf(fp) ? boards[keyOf(fp)] : null);
  const name = (fp) => clip((board(fp) || {}).title, 80) || path.basename(fp).replace(/(\.dc)?\.html?$/i, ''), label = name(plan.fp);
  if (!whole || list.length < 2) return one && { ...one, pages: list.length, label };
  const order = canvas && Array.isArray(canvas.order) ? canvas.order : [], rank = (x) => { const n = order.indexOf(keyOf(x.fp)); return n < 0 ? 1e6 : n; }; list.sort((a, b) => rank(a) - rank(b));
  const num = (v, dflt) => (Number.isFinite(+v) && +v > 0 ? Math.min(+v, 20000) : dflt), pos = (v) => (Number.isFinite(+v) ? Math.max(-1e5, Math.min(1e5, +v)) : 0), PREV = /"\$preview"\s*:\s*\{\s*"width"\s*:\s*(\d+)\s*,\s*"height"\s*:\s*(\d+)/;
  const items = list.map((x) => { const b = board(x.fp), pv = PREV.exec(x.page.html); return { html: x.page.html, title: name(x.fp), x: b ? pos(b.x) : null, y: b ? pos(b.y) : null, w: num(b && b.w, pv ? +pv[1] : 1100), h: num(b && b.h, pv ? +pv[2] : 800) }; });
  const notes = canvas && canvas.notes && typeof canvas.notes === 'object' ? Object.values(canvas.notes).filter((n) => n && typeof n.text === 'string').slice(0, 40).map((n) => ({ text: clip(n.text, 120), x: pos(n.x), y: pos(n.y), big: /^title/.test(n.kind || '') })) : [];
  const data = JSON.stringify({ items, notes }).replace(/</g, '\\u003c').replace(ART_LS, (ch) => '\\u' + ch.charCodeAt(0).toString(16));
  return { html: ARTIFACT_WHOLE.replace('%DATA%', () => data), net: list.some((x) => x.page.net), pages: list.length, label };
}
// The whole document: each page in a shadow root of its own (its styles stay its own; its script tags do not run, its inline handlers do, in the same sandbox as the frame of one page). Shared, every page at once in the grid that shows them
// largest; pinned (fit=w), where the canvas puts them (or three to a row), to the width of the window, to scroll through. No backslash in this script: the template literal would eat it.
const ARTIFACT_WHOLE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#e8e8ec}#o{position:relative;margin:0 auto;overflow:hidden}#c{position:absolute;left:0;top:0;transform-origin:0 0}.b{position:absolute;overflow:hidden;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.18);font:initial;color:initial}.t,.n{position:absolute;white-space:nowrap;font:600 22px system-ui,sans-serif;color:#666}.n{font-size:30px;color:#333}.n.big{font-size:44px;font-weight:700}</style><div id="o"><div id="c"></div></div><script type="application/json" id="d">%DATA%</script><script>
(function () {
  var D = JSON.parse(document.getElementById('d').textContent), c = document.getElementById('c'), o = document.getElementById('o'), M = 60, wide = /[?&]fit=w(&|$)/.test(location.search);
  var placed = D.items.filter(function (it) { return it.x != null; }), gy = placed.length ? Math.max.apply(null, placed.map(function (it) { return it.y + it.h; })) + 160 : 0, gx = 0, col = 0, rowH = 0;
  D.items.forEach(function (it) { if (it.x != null) return; if (col === 3) { col = 0; gx = 0; gy += rowH + 120; rowH = 0; } it.x = gx; it.y = gy; gx += it.w + 80; rowH = Math.max(rowH, it.h); col++; });   // pages the canvas does not place: three to a row, below it
  var els = D.items.map(function (it) {
    var b = document.createElement('div'), t = document.createElement('div'); b.className = 'b'; b.attachShadow({ mode: 'open' }).innerHTML = it.html; t.className = 't'; t.textContent = it.title; c.appendChild(t); c.appendChild(b); return { it: it, b: b, t: t };
  });
  var notes = D.notes.map(function (n) { var e = document.createElement('div'); e.className = 'n' + (n.big ? ' big' : ''); e.textContent = n.text; c.appendChild(e); return { n: n, e: e }; });
  var fit = function () {   // pinned (fit=w): where the canvas puts each page, to the width of the window, to scroll through; shared: every page at once, in the grid that shows them largest
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, box = function (x, y, w, h) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); };
    var put = function (e, x, y) { e.b.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + e.it.w + 'px;height:' + e.it.h + 'px'; e.t.style.cssText = 'left:' + x + 'px;top:' + (y - 38) + 'px'; box(x, y - 44, e.it.w, e.it.h + 44); };
    if (wide) { els.forEach(function (e) { put(e, e.it.x, e.it.y); }); notes.forEach(function (n) { n.e.style.cssText = 'left:' + n.n.x + 'px;top:' + n.n.y + 'px'; box(n.n.x, n.n.y, 400, 60); }); }
    else {
      var n = els.length, cw = Math.max.apply(null, els.map(function (e) { return e.it.w; })) + 60, ch = Math.max.apply(null, els.map(function (e) { return e.it.h; })) + 84, k = 1, best = 0;
      for (var j = 1; j <= n; j++) { var r = Math.ceil(n / j), s0 = Math.min(innerWidth / (j * cw + 2 * M), innerHeight / (r * ch + 2 * M)); if (s0 > best) { best = s0; k = j; } }
      els.forEach(function (e, i) { put(e, (i % k) * cw, Math.floor(i / k) * ch + 44); }); notes.forEach(function (n) { n.e.style.cssText = 'display:none'; });
    }
    var bw = x1 - x0 + 2 * M, bh = y1 - y0 + 2 * M, s = wide ? innerWidth / bw : Math.min(innerWidth / bw, innerHeight / bh);
    o.style.width = bw * s + 'px'; o.style.height = bh * s + 'px'; o.style.marginTop = wide ? '0' : Math.max(0, (innerHeight - bh * s) / 2) + 'px'; c.style.transform = 'scale(' + s + ') translate(' + (M - x0) + 'px,' + (M - y0) + 'px)';
  };
  fit(); addEventListener('resize', fit);
})();
</script>`;
// What the frame of an artifact may do: run the page's own scripts, and nothing else. "sandbox" without allow-same-origin gives the page an origin of its own, also when its address is opened in a tab:
// it cannot read this server (which refuses what does not come from its own page), keep anything, open a window or send a form. Without net, nothing is fetched from anywhere. With net (the person
// asked for the libraries of the pages, ⚙ or the button in the window), scripts and fonts come from the servers claude.ai itself lets an artifact use, and from nowhere else; the page still cannot send anything out.
const ART_LIBS = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com';
const artifactCsp = (net) => "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'" + (net ? ' ' + ART_LIBS : '') + "; style-src 'unsafe-inline'" + (net ? ' https://fonts.googleapis.com' : '') + '; font-src data:' + (net ? ' https://fonts.gstatic.com' : '') + "; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
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
  for (const m of SOURCES) for (const r of guard(() => m.sessions(30), [])) rows.push({ proj: m.PROJ, id: r.id, mtime: r.mtime, size: r.size, agents: guard(() => (m.subCount ? m.subCount(r.id) : m.subFiles ? m.subFiles(r.id).length : 0), 0), cx: r, src: m });
  for (const proj of projects()) {
    for (const { id, file } of transcripts(proj)) {
      let st; try { st = fs.statSync(file); } catch { continue; }   // a link to a transcript that is gone
      rows.push({ proj, id, mtime: st.mtimeMs, size: st.size, agents: subFiles(proj, id).length });
    }
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  const own = (r) => !r.cx && r.proj !== COWORK, top = rows.filter(own).slice(0, 60).concat(rows.filter((r) => r.cx), rows.filter((r) => r.proj === COWORK).slice(0, 30)).sort((a, b) => b.mtime - a.mtime);   // the 60 most recent Claude Code sessions as always, and up to 30 of each other tool beside them, Cowork included: none pushes another out
  for (const r of top) {
    if (r.cx) { const c = r.cx, m = r.src; delete r.cx; delete r.src; r.title = guard(() => m.title(c), '') || r.id; r.project = guard(() => m.projectLabel(c.cwd), '') || m.SOURCE; r.source = m.SOURCE; continue; }
    // titles come from the cached tail read (custom title, then AI title, then first prompt): no whole-file reads
    let t = null; try { const f = path.join(projDir(r.proj, r.id), r.id + '.jsonl'); t = parseTail(f, fs.statSync(f)).title; } catch {}
    r.title = coworkTitle(r.proj, r.id) || t || r.id; r.project = r.proj === COWORK ? 'Cowork' : r.proj.replace(/^-Users-[^-]+-/, '').replace(/-/g, '/');
  }
  return top;
}

function stamp(proj, id) {
  const base = projDir(proj, id); let n = 0;
  const add = (f) => { try { const s = fs.statSync(f); n += s.mtimeMs + s.size; } catch {} };
  const sx = sourceOf(proj); add(sx ? guard(() => sx.fileOf(id), '') || '' : path.join(base, id + '.jsonl')); if (sx && sx.watch) for (const f of guard(() => sx.watch(id), [])) add(f);
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
const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;   // nothing else is given to the page as a link to open
const askOf = (b) => { const q = b.name === 'AskUserQuestion' && b.input && Array.isArray(b.input.questions) && b.input.questions[0] && b.input.questions[0].question; return typeof q === 'string' ? clip(q.trim(), 200) : ''; };   // the question a session stopped on, for its card
// When the person last did something in a session: an order, a slash command, a "!" command, an order typed while the lead was working. It is what moves the live call (see currentSession).
// Not what the harness writes as a user record: the result of a tool, a reminder, the news that a background task ended, the summary of a compaction, an Esc.
// Nor the prompt of a task Cowork runs on a schedule (it opens with <scheduled-task …>): nobody typed it, so it does not take the call from the session you are in.
const NOT_TYPED = /<(system-reminder|browser_instruction|ide_selection|ide_opened_file|task-notification|local-command-stdout|local-command-caveat)>[\s\S]*?<\/\1>\s*/g;
function typedAt(r) {
  if (!r || r.isSidechain) return 0;
  if (r.type === 'attachment') { const q = r.attachment; return q && q.type === 'queued_command' && (q.origin ? q.origin.kind === 'human' : q.commandMode === 'prompt') ? Date.parse(r.timestamp) || 0 : 0; }
  if (r.type !== 'user' || r.isMeta || r.isCompactSummary) return 0; const bl = blocks(r); if (bl.some((b) => b && b.type === 'tool_result')) return 0;
  const t = bl.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').replace(NOT_TYPED, '').trim();
  return (t ? !/^(\[Request interrupted|<scheduled-task[\s>])/i.test(t) : bl.some((b) => b && b.type === 'image')) ? Date.parse(r.timestamp) || 0 : 0;   // a picture sent alone is an order too
}
function typedBefore(file) {   // the first look at a session whose last order is further back than what the list reads (a long turn, large outputs): looked for once, in its last megabytes
  const { text, cut } = readTail(file, 4 * 1024 * 1024), lines = text.split('\n');
  for (let i = lines.length - 1; i >= (cut ? 1 : 0); i--) { if (!lines[i].includes('"type":"user"') && !lines[i].includes('"queued_command"')) continue; try { const a = typedAt(JSON.parse(lines[i])); if (a) return a; } catch {} }
  return 0;
}
function parseTail(file, st) {
  const sig = st.mtimeMs + ':' + st.size, hit = boardCache.get(file); if (hit && hit.sig === sig) return hit;
  const { text, cut } = readTail(file, 192 * 1024), lines = text.split('\n'); if (cut) lines.shift();
  const pend = new Map(); let lastType = null, lastTool = false, lastStop = null, stops = false, esc = false, lastTs = 0, custom = (hit && hit.custom) || null, ai = (hit && hit.ai) || null, first = hit ? hit.first : undefined, pr = (hit && hit.pr) || null, asked = (hit && hit.asked) || 0;
  for (const l of lines) {
    if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    const a = typedAt(r); if (a > asked) asked = a;
    if (r.type === 'custom-title' && typeof r.customTitle === 'string') custom = r.customTitle; else if (r.type === 'ai-title' && typeof r.aiTitle === 'string') ai = r.aiTitle;   // a session is renamed, or named, long after its row was first shown: the latest one read wins
    if (r.type === 'pr-link' && PR_URL.test(r.prUrl)) pr = { n: +r.prUrl.slice(r.prUrl.lastIndexOf('/') + 1), url: r.prUrl };   // the pull request Claude Code noted for the session: the latest one, shown on its card
    const t = Date.parse(r.timestamp) || 0, bl = blocks(r);
    if (r.type === 'assistant' || r.type === 'user') { lastType = r.type; lastTool = bl.some((b) => b.type === 'tool_use'); lastStop = (r.type === 'assistant' && r.message && r.message.stop_reason) || null; if (lastStop) stops = true; if (t) lastTs = t;
      esc = r.type === 'user' && bl.some((b) => b.type === 'text' && /^\s*\[Request interrupted/i.test(b.text || '')); if (esc) pend.clear(); }   // Esc: the turn stops there, and no call is waited for any more
    for (const b of bl) { if (b.type === 'tool_use') pend.set(b.id, { name: b.name, ts: t, q: askOf(b) }); else if (b.type === 'tool_result') pend.delete(b.tool_use_id); }
  }
  if (!hit && !custom) {   // first look at this file: a little further back than the lines read above, and without needing whole lines
    const big = readTail(file, 256 * 1024).text, un = (m) => { try { return m ? JSON.parse('"' + m[1] + '"') : null; } catch { return null; } };
    custom = un([...big.matchAll(/"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/g)].pop()); if (!ai) ai = un([...big.matchAll(/"type":"ai-title","aiTitle":"((?:[^"\\]|\\.)*)"/g)].pop());
  }
  if (!custom && !ai && first == null) first = firstPrompt(file) || (st.size > 64 * 1024 ? '' : null);   // '' = looked for and not there; a file that has just been created is looked at again
  if (!hit && !asked && cut) asked = typedBefore(file);
  const out = { sig, title: custom || ai || first || null, custom, ai, first, pr, lastType, lastTool, lastStop, stops, esc, lastTs, pending: [...pend.values()] };   // a title the person typed wins over the generated one, and both over the first prompt
  out.asked = asked; boardCache.set(file, out); if (boardCache.size > 200) boardCache.delete(boardCache.keys().next().value); return out;
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
  const out = withDone(boardRows0()); boardMemo = { at: Date.now(), rows: out }; return out;
}
function boardRows0() {
  const now = Date.now(), rows = [];
  for (const m of SOURCES) for (const r of guard(() => m.sessions(), [])) if (now - r.mtime < 12 * 3600e3) rows.push({ proj: m.PROJ, id: r.id, st: { mtimeMs: r.mtime, size: r.size }, cx: r, src: m });
  for (const proj of projects()) {
    for (const { id, file } of transcripts(proj)) { try { const st = fs.statSync(file); if (now - st.mtimeMs < 12 * 3600e3) rows.push({ proj, id, st }); } catch {} }
  }
  rows.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  return rows.filter((r) => !r.cx && r.proj !== COWORK).slice(0, 40).concat(...SOURCES.map((m) => rows.filter((r) => r.src === m).slice(0, 20)), rows.filter((r) => r.proj === COWORK).slice(0, 20)).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs).map(({ proj, id, st, cx, src }) => {
    if (cx) { const r = guard(() => src.boardRow(cx, now), null); if (r && tmpKey(r.dir)) r.tmp = 1; return r; }   // tmp: started in the temporary folder (see tmpKey)
    const file = path.join(projDir(proj, id), id + '.jsonl'); let p; try { p = parseTail(file, st); } catch { p = { pending: [] }; }
    const age = now - st.mtimeMs, lp = (p.pending || [])[(p.pending || []).length - 1]; let state = 'idle', tool = '', ageMs = age;
    if (age < 30 * 60e3) {
      if (lp) { ageMs = now - (lp.ts || st.mtimeMs); tool = lp.name;
        state = SUBTOOL.test(lp.name) ? 'waiting' : (ASKS.test(lp.name) && ageMs > 4000) || (APPROVAL.test(lp.name) && ageMs > 15000) ? 'blocked' : 'working'; }
      else if (p.esc) state = 'turn';   // you stopped it (Esc): it is your turn there, not "working" for the next ten minutes
      else if (p.lastType === 'assistant' && !p.lastTool && p.lastStop !== 'tool_use' && !(p.lastStop == null && p.stops && age < 45000)) state = 'turn';   // a line whose message goes on with a tool call is not the end of the turn: the call is written after it, a long one many seconds after.
      // Claude Code up to 2.1.87 writes that line without saying why it stopped: in a transcript that does say it elsewhere, such a line is given 45 s for its call to come (1 in 100 takes longer than 25 s)
      else state = age < 10 * 60e3 ? 'working' : 'idle';
    }
    let subActive = 0, subTotal = 0;
    for (const x of subFiles(proj, id)) { subTotal++; if (now - mtimeOf(x.file) < 90e3) subActive++; }
    return { proj, id, title: coworkTitle(proj, id) || p.title || id, mtime: st.mtimeMs, state, tool, ageMs, subActive, subTotal, asked: p.asked || 0, ...(p.pr ? { pr: p.pr } : {}), ...(state === 'blocked' && lp && lp.q ? { ask: lp.q } : {}), ...(p.esc ? { cut: 1 } : {}), ...(tmpKey(proj) ? { tmp: 1 } : {}) };   // cut: stopped by you, which is no news to tell you
  }).filter(Boolean);
}
// Settings live in a file, not only in the page's localStorage: the port changes between VS Code windows and reloads, and localStorage is per origin (port included).
const PREFS = process.env.AGENT_STANDUP_PREFS || (process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'agent-standup', 'prefs.json') : path.join(os.homedir(), '.config', 'agent-standup', 'prefs.json'));
// The sessions you put away as done (✓ on a card of the Sessions view): "project/id" → when the session had last moved at that time. Kept in a file of its own beside the settings and read again when it changes,
// so that every window agrees at once, whichever server it talks to. A session that moves again is no longer put away.
const DONE = path.join(path.dirname(PREFS), 'done.json'); let doneMemo = { sig: null, map: new Map() };
function doneMarks() {
  let sig = ''; try { const st = fs.statSync(DONE); sig = st.mtimeMs + ':' + st.size; } catch {} if (sig === doneMemo.sig) return doneMemo.map;
  const map = new Map(); try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(DONE, 'utf8')))) if (typeof v === 'number') map.set(k, v); } catch {}
  doneMemo = { sig, map }; return map;
}
const canDone = (r) => r.state === 'turn' || r.state === 'idle';   // a session at work, or one that waits for you, is not put away
function withDone(rows) { const m = doneMarks(); for (const r of rows) { if (canDone(r) && m.get(r.proj + '/' + r.id) >= r.mtime) r.done = 1; else if (r.done) delete r.done; } return rows; }
function setDone(proj, id, on) {
  const rows = boardRows0(), row = rows.find((r) => r.proj === proj && r.id === id); if (!row || (on && !canDone(row))) return false;
  const m = new Map(doneMarks()), k = proj + '/' + id; if (on) m.set(k, row.mtime); else m.delete(k);
  for (const [key, at] of m) { const r = rows.find((x) => x.proj + '/' + x.id === key); if (!r || r.mtime > at) m.delete(key); }   // the marks of sessions that moved again, or left the board, are forgotten
  fs.mkdirSync(path.dirname(DONE), { recursive: true }); const tmp = DONE + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(m), null, 1)); fs.renameSync(tmp, DONE);
  doneMemo = { sig: null, map: m }; boardMemo.at = 0; return true;
}
function readPrefs() { try { const v = JSON.parse(fs.readFileSync(PREFS, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } }
function writePrefs(v) { fs.mkdirSync(path.dirname(PREFS), { recursive: true }); const tmp = PREFS + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 1)); fs.renameSync(tmp, PREFS); }
// The app's own errors, kept on this computer only, in errors.log beside the settings: what the page, a request, a reader or the process could not do. Nothing is sent anywhere:
// ⚙ › Report a problem shows them and opens the draft of an issue that the person reads and sends themselves. One JSON line each: when, which version, where, the message and the top of the stack.
// tidy: the home folder is written "~" (also in the form Claude Code names its project folders) and the address of the page, which carries the project in its query, is written "page".
// The same error is written once an hour at most, 60 lines an hour at most, and the file loses its older half past 256 KB. Logging never throws.
const ERRLOG = path.join(path.dirname(PREFS), 'errors.log'), errSeen = new Map(), errRate = { at: 0, n: 0 };
const VERSION = (() => { for (const p of ['package.json', '../package.json']) try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, p), 'utf8')); if (/agent-standup/.test(j.name)) return String(j.version || ''); } catch {} return ''; })();   // ../: the desktop app keeps this file in core/
// homeRe: the home folder in the forms a message or a stack writes it: as it is, with "/" for "\", with "\\" (inside JSON), and with "-" for every other character (a project folder of Claude Code).
// On Windows the case is not told apart: the editor writes the drive "c:" where the system says "C:". A home of a few letters ("/root") is not looked for in its dashed form, which would be found in any text.
function homeRe(home, win) {
  try {
    if (!home || home.length < 4) return null; const q = (f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), dashed = home.replace(/[^a-zA-Z0-9]/g, '-');
    const plain = [...new Set([home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')])].sort((a, b) => b.length - a.length).map((f) => q(f) + '(?!\\w)');
    return new RegExp(plain.concat(dashed.length >= 8 ? [q(dashed)] : []).join('|'), win ? 'gi' : 'g');
  } catch { return null; }
}
const HOME_RE = homeRe(os.homedir(), process.platform === 'win32');
function tidy(x, n, re = HOME_RE) {
  let t = String(x == null ? '' : x); if (re) t = t.replace(re, '~');
  t = t.replace(/(\/(?:Users|home)\/|[A-Za-z]:[\\\/]{1,2}Users[\\\/]{1,2})[^\/\\:*?"'<>|)\r\n]+/gi, '~');   // the home of anyone else, up to the next separator: a name may hold a space
  t = t.replace(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/[^\s)"']*?(?=:\d+:\d+|[\s)"']|$)/gi, 'page').slice(0, n);
  return t.replace(/[\uD800-\uDBFF]$/, '');   // a cut through the middle of an emoji leaves half a character, which a link cannot carry
}
function logError(where, e) {
  try {
    const msg = tidy(e && e.message != null ? e.message : e, 300), stack = tidy(String((e && e.stack) || '').split('\n').map((l) => l.trim()).filter((l) => /^at |@/.test(l)).slice(0, 8).join('\n'), 1500), now = Date.now();
    const key = where + '|' + msg + '|' + stack.split('\n')[0]; if (!msg || now - (errSeen.get(key) || 0) < 3600e3) return;
    if (now - errRate.at > 3600e3) { errRate.at = now; errRate.n = 0; } if (++errRate.n > 60) return;
    if (errSeen.size > 300) errSeen.clear(); errSeen.set(key, now);
    fs.mkdirSync(path.dirname(ERRLOG), { recursive: true });
    try { if (fs.statSync(ERRLOG).size > 262144) { const all = fs.readFileSync(ERRLOG, 'utf8').split('\n'); fs.writeFileSync(ERRLOG, all.slice(all.length >> 1).join('\n')); } } catch {}
    fs.appendFileSync(ERRLOG, JSON.stringify({ t: new Date().toISOString(), v: VERSION, where: tidy(where, 80), msg, stack }) + '\n');
  } catch {}
}
function errorReport() {   // what ⚙ › Report a problem shows: the app, the system and the last errors of the log
  let errors = []; try { errors = fs.readFileSync(ERRLOG, 'utf8').split('\n').filter(Boolean).slice(-40).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && typeof x === 'object'); } catch {}
  return { version: VERSION, host: String(process.env.AGENT_STANDUP_HOST || '').slice(0, 80), platform: `${process.platform} ${os.release()} ${process.arch}`, node: process.version, electron: process.versions.electron || '', file: tidy(ERRLOG, 300), errors };
}
// An exception nobody caught is written before the process does what it would have done anyway (the "monitor" event changes nothing to that). Inside an editor the process is shared with
// every other extension: there, only an error that went through this folder is ours. OWN: the process was started from this folder (node server.js, the command, the desktop app, a test).
const OWN = (() => { try { const m = require.main && require.main.filename; return !!m && (m.startsWith(__dirname + path.sep) || path.dirname(__dirname) === path.dirname(m)); } catch { return false; } })();   // the second: the desktop app, whose main file sits one folder above core/
process.on('uncaughtExceptionMonitor', (e, origin) => { try { if (OWN || String((e && e.stack) || '').includes(__dirname)) logError(origin === 'unhandledRejection' ? 'promise' : 'crash', e); } catch {} });
// The session the live call is in: the one you last touched. Typing in a session, or starting one, takes the call there. So does going to one by hand (pick: its tab, the visitor,
// the list, the tab of the editor), and that holds until you type somewhere. What the agents write moves nothing: with two sessions at work the call went back and forth, and there was a pin to stop it.
// One exception, so that the call is not left on an empty room: when the session you last typed in has finished and been quiet for STICK_MS while another one is at work, the call
// goes to that one. A session you went to by hand is not left that way.
const STICK_MS = 90000;
// Sessions started in the system's temporary folder: a program running Claude Code there for a moment (a test, a script, a tool that makes a folder per run), not a session someone works in.
// When the call looks everywhere it leaves them out, unless there is nothing else; they have no tab then and send no visitor. They stay in the Sessions view, and a window open on such a folder follows it.
// macOS: /var/folders/… (/private/… once resolved) and /tmp; Linux: /tmp; Windows: …\AppData\Local\Temp; and wherever TMPDIR points. A key is a folder as Claude Code names it, every other character a "-".
const TMP_KEYS = [...new Set([os.tmpdir(), (() => { try { return fs.realpathSync(os.tmpdir()); } catch { return ''; } })()].filter((d) => d && d.length > 4).map((d) => d.replace(/[^a-zA-Z0-9]/g, '-')))];
const tmpKey = (k) => !!k && (/^-(private-)?(tmp|var-folders)(-|$)/.test(k) || /-AppData-Local-Temp(-|$)/i.test(k) || TMP_KEYS.some((t) => k === t || k.startsWith(t + '-')));
const tmpSession = (proj, id) => { const sx = sourceOf(proj); return sx ? tmpKey(String(guard(() => sx.cwd(id), '') || '').replace(/[^a-zA-Z0-9]/g, '-')) : tmpKey(proj); };   // a Codex or Vibe session: the folder it was started in
function sessionMtime(proj, id) {
  const sx = sourceOf(proj), r = sx ? guard(() => sx.row(id), null) : null; if (sx && (!r || !sx.subFiles)) return r ? r.mtime : 0;
  let m = sx ? r.mtime : mtimeOf(path.join(projDir(proj, id), id + '.jsonl')); if (!m) return 0; const subs = subFilesOf(proj, id);
  for (const x of subs) m = Math.max(m, mtimeOf(x.file)); for (const d of subs.dirs) m = Math.max(m, mtimeOf(d)); return m;   // the folders too: a new file in them is activity, as when every file around the transcripts was looked at
}
function currentSession(projFilter, pick, stick, anyTmp) {   // pick: { proj, id, since } the session you went to by hand, and the latest order there was then · stick: the session the call is in · anyTmp: sessions in the temporary folder count too (see tmpKey)
  const safe = (x) => typeof x === 'string' && /^[\w.\-]+$/.test(x) && x !== '..', now = Date.now();
  const there = (c) => !!c && safe(c.id) && safe(c.proj) && (sourceOf(c.proj) ? !!guard(() => sourceOf(c.proj).fileOf(c.id), null) : fs.existsSync(path.join(projDir(c.proj, c.id), c.id + '.jsonl')));
  const inScope = (c) => (!projFilter ? anyTmp || !tmpSession(c.proj, c.id) : c.proj === projFilter || c.proj.startsWith(projFilter + '-') || !!(sourceOf(c.proj) && guard(() => sourceOf(c.proj).inProject(c.id, projFilter), false)));   // a Codex or Vibe session counts for a project when it was started in that folder
  const same = (a, b) => !!a && !!b && a.proj === b.proj && a.id === b.id, all = boardRows(), rows = all.filter(inScope), mine = there(pick) ? all.find((r) => same(r, pick)) : null;
  const asked = Math.max(0, (mine && mine.asked) || 0, ...rows.map((r) => r.asked || 0));   // the latest order, in the folder the call follows or in the session you went to
  const moved = pick && pick.pin ? Math.max(0, ...rows.filter((r) => !same(r, pick)).map((r) => r.asked || 0)) : asked;   // pick.pin: a call pinned by a click on its tab (📌) is left for an order typed in another session only; what you type in it keeps it there
  if (there(pick) && !(moved > pick.since)) return { proj: pick.proj, id: pick.id, mtime: now, asked, pick: 1 };   // no "since" on the first question after a pick: the answer gives it (asked), and the page sends it back from then on
  const live = rows.filter((r) => /^(working|waiting|blocked)$/.test(r.state) || r.subActive > 0 || now - r.mtime < STICK_MS), last = Math.max(0, ...live.map((r) => r.asked || 0)), top = live.filter((r) => (r.asked || 0) === last);
  const to = top.find((r) => same(r, stick)) || top.sort((a, b) => b.mtime - a.mtime)[0];   // two sessions whose last order is not known (or of the same instant): the call stays where it is
  if (to) return { proj: to.proj, id: to.id, mtime: to.mtime, asked };
  if (there(stick) && inScope(stick)) return { proj: stick.proj, id: stick.id, mtime: sessionMtime(stick.proj, stick.id), asked };   // nobody is at work: the call stays where it is
  let best = null;
  const consider = (proj, id, m) => { if (!best || m > best.mtime) best = { proj, id, mtime: m }; };
  for (const m of SOURCES) for (const r of guard(() => m.sessions(), [])) if (inScope({ proj: m.PROJ, id: r.id })) consider(m.PROJ, r.id, r.mtime);
  for (const proj of projects()) {
    if (projFilter ? proj !== projFilter && !proj.startsWith(projFilter + '-') : !anyTmp && tmpKey(proj)) continue;   // the folder itself, or a folder inside it (a Cowork session is in no folder of yours: it counts when the call looks everywhere, or at Cowork)
    for (const { id } of transcripts(proj)) { const m = sessionMtime(proj, id); if (m) consider(proj, id, m); }   // 0: a link to a transcript that is gone
  }
  if (!best && projFilter) return { ...currentSession('', null, stick), wide: 1 };
  if (!best && !projFilter && !anyTmp) return currentSession('', pick, stick, true);   // nothing but sessions in the temporary folder: one of them rather than an empty call   // nothing in that folder (an editor open on another one than the sessions): the latest of anywhere, and the page is told, so its tabs follow the same rule
  return best ? { ...best, asked } : {};   // a call that is opened while nobody is at work: the session that was written to last
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
    if (st.out) for (const b of blocks(r)) if (b.type === 'tool_result') st.out.delete(b.tool_use_id);
    for (const b of blocks(r)) if (b.type === 'tool_result' && wf) push({ ts, agent, kind: 'wfrun', toolId: b.tool_use_id, run: wf });   // the answer to a Workflow call names the run it started: its agents are in subagents/workflows/<run>/
    for (const b of blocks(r)) if (b.type === 'tool_result' && (st.toolName[b.tool_use_id] === 'Agent' || st.toolName[b.tool_use_id] === 'Task') && !(st.bg && st.bg[b.tool_use_id]) && !/^\s*Async agent launched/i.test(resultText(b.content))) push({ ts, agent, kind: 'agentdone', toolId: b.tool_use_id });   // a synchronous call: the lead got the sub-agent's answer back, so it has finished (async launches answer immediately and are not a completion)
    for (const b of blocks(r)) if (b.type === 'tool_result' && st.toolName[b.tool_use_id] && !NO_RESULT.has(st.toolName[b.tool_use_id])) {
      const n = st.toolName[b.tool_use_id], img = resultImages(b.content).length, files = n === 'Bash' && !b.is_error ? docPaths(resultText(b.content), false).map((f) => absPath(f, r.cwd)) : [], art = !b.is_error && st.pubs && st.pubs.has(b.tool_use_id) ? artOf(st, st.pubs.get(b.tool_use_id), r.toolUseResult, resultText(b.content)) : null;
      items.push({ id: b.tool_use_id, err: !!b.is_error, out: clip(resultText(b.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trimEnd(), RESULT_MAX[n] || (/^mcp__/.test(n) ? 900 : 600)), ...(img ? { img } : {}), ...(files.length ? { files } : {}), ...(art ? { art } : {}) });   // img: how many pictures came back; the page fetches them from /api/media · files: the documents a command says it made
    }
    if (items.length) push({ ts, agent, kind: 'results', items });
    const typed = blocks(r).filter((b) => b.type === 'text').map((b) => b.text).join('\n').replace(HARNESS, ''), cut = /^\s*\[Request interrupted[^\]]*\]/i.test(typed);   // what the human typed, without the blocks the harness wraps around it
    if (agent !== 'main') { if (!st.prompt && typed.trim() && !st.raw.length) st.prompt = { ts, text: typed.trim() }; return; }   // a sub-agent's first user message is the order, emitted from the parent's side (kept here for the agents of a workflow, whose order is in no other file)
    if (cut && st.out) st.out.clear(); if (cut && st.act >= 0) st.raw[st.act].end = 1;   // Esc: the turn stops there, without the end_turn mark. The last thing the lead said or did closes it
    const txt = typed.replace(/^\s*\[Request interrupted[^\]]*\]\s*/i, '').trim();
    if (txt && !/^<(system-reminder|command-|local-command|task-notification)/.test(txt) && !r.isMeta && !r.isCompactSummary) { if (st.out) st.out.clear(); push({ ts, agent: 'user', kind: 'user', text: txt }); }   // a call that never got its answer is not waited for across your next message · not the summary Claude Code writes when it compacts: thousands of characters the human never typed
  } else if (r.type === 'assistant') {
    const m = r.message || {}; let said = null;
    if (agent === 'main') { st.lead = 1; if (m.stop_reason) st.stops = 1; }   // this transcript says why each message stopped: its turns end with a mark, and until one comes the lead is at work (see marks, below)
    if (m.id && m.usage) {   // the same message is repeated once per content block with identical numbers: keep one per message id
      const u = m.usage, prev = st.msgUsage.get(m.id);
      st.msgUsage.set(m.id, { ts: prev ? prev.ts : ts, u: { i: u.input_tokens || 0, o: u.output_tokens || 0, r: u.cache_read_input_tokens || 0, w: u.cache_creation_input_tokens || 0 }, model: m.model });
    }
    const th = () => { const t = st.th; st.th = ''; return t ? { th: t } : {}; };   // what the agent was thinking before this line or call, when Claude Code kept it (most of the time it only keeps a signature): the call shows it as an inner thought
    for (const b of blocks(r)) {
      if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) st.th = clip(b.thinking.replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\n ]*/g, '\n').trim(), 900);   // line breaks are kept: each line of its notes is a thought of its own
      else if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) { said = push({ ts, agent, kind: 'say', text: b.text.trim(), ...th() }); st.act = st.raw.length - 1; st.sayOf = m.id; st.sayAt = st.act; }
      else if (b.type === 'tool_use' && b.name === 'SubagentHandback' && agent !== 'main' && b.input && typeof b.input.message === 'string' && b.input.message.trim()) { said = push({ ts, agent, kind: 'say', text: b.input.message.trim(), ...th() }); st.act = st.raw.length - 1; st.sayOf = m.id; st.sayAt = st.act; }   // since Claude Code 2.1.293 a sub-agent hands its report back through this call, and most write no sentence beside it: the message of the call is what it says last
      else if (b.type === 'tool_use') {
        st.toolName[b.id] = b.name; (st.out = st.out || new Set()).add(b.id); if (b.input && b.input.run_in_background) (st.bg = st.bg || {})[b.id] = true;   // out: the calls that have no answer yet
        if (b.name === 'Agent' || b.name === 'Task') push({ ts, agent, kind: 'agentcall', toolId: b.id, bg: !!(b.input && b.input.run_in_background), text: (b.input && b.input.prompt) || '', title: (b.input && b.input.description) || '', ...(b.input && typeof b.input.name === 'string' && b.input.name.trim() ? { nm: b.input.name.trim() } : {}) });
        else { const tool = toolLabel(b, ts); if (tool.d && tool.d.outs) tool.d.outs = tool.d.outs.map((f) => absPath(f, r.cwd)); if (tool.d && tool.d.kind === 'artifact') (st.pubs = st.pubs || new Map()).set(b.id, tool.d.open ? 'open' : tool.d.doc ? 'doc' : 'pub'); push({ ts, agent, kind: 'tool', tool, ...th() }); st.act = st.raw.length - 1; }
      }
    }
    if (agent === 'main' && (m.stop_reason === 'end_turn' || ((r.isApiErrorMessage || (m.model === '<synthetic>' && m.stop_reason === 'stop_sequence')) && !(st.out && st.out.size)))) {   // also a turn that ends on a message Claude Code writes itself, in the place of the model's: the API is down, the limit is reached, the request was refused, or there was nothing to answer. Nothing follows it, unless a call of the lead is still out: the connection dropped while its agents worked, and it goes on when they answer. (A message of the model that a safety check cuts is not the end either: Claude Code tells the model, which goes on.) The lead's turn is over: Claude Code writes one record per content block, each with the message's stop reason, so the mark goes on the line this record carries (a thinking block carries none)
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
  const sx = sourceOf(proj), rec = recordOf(sx), base = projDir(proj, id), mainFile = sx ? sx.fileOf(id) || '' : path.join(base, id + '.jsonl');   // a Codex or Vibe session is kept somewhere else, in another format (rec); from here on it is a session like any other (Codex without sub-agents)
  if (!fs.existsSync(mainFile)) throw new Error('session not found');
  const agents = { main: { id: 'main', role: 'Lead', type: 'main' } };   // the lead has the same name whatever tool runs the session: the page gives it
  const states = [(sx && sx.state && guard(() => sx.state(id), null)) || readNew(mainFile, 'main', false, rec)], subs = subFilesOf(proj, id), runs = {}; files.push(mainFile);   // sx.state: a format that is not read line by line hands over the events of the session whole   // runs: workflow run → { agents (file name → agent id), by (who launched it), toolId, done }
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
  const marks = !sx && states[0] && (states[0].stops || !states[0].lead) ? { marks: 1 } : {};   // a Claude Code session whose turns end with a mark, also before the lead has written anything: a session that has not closed a turn yet is not one without marks, and its lead is not "done" each time it thinks for a while
  return { id, proj, agents: Object.values(agents), events: merged.map((e) => ({ ...e, t: Math.max(0, e.ts - first) })), durationMs: last - first, recentUntil, ...marks };
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
const translate = (texts, lang) => translateFast(texts, lang);

// Warm `claude` workers: after a slow first call each translation takes ~2-3 s (a cold `claude -p` costs ~6 s).
// The languages a call can be held in besides English (the page asks for one with `lang`; French when it says nothing, as it always was).
const TR_LANG = { fr: 'French', es: 'Spanish', pt: 'Brazilian Portuguese' }, trLang = (l) => (Object.hasOwn(TR_LANG, l) ? l : 'fr');
const trInstr = (lang) => `Translate each string of this JSON array into natural spoken ${TR_LANG[lang]}, as a teammate would say it in a meeting. Keep code identifiers, file paths, library names and numbers unchanged.`;
const trSys = (lang) => `You are a translation engine. Translate the user message into natural spoken ${TR_LANG[lang]}, as a colleague would say it in a meeting. Keep code identifiers, file paths, library names and numbers unchanged. Reply with ONLY the translation, nothing else.`;
class TrWorker {
  constructor() { this.q = []; this.busy = false; this.n = 0; this.p = null; this.cur = null; this.buf = ''; this.lang = 'fr'; }
  start(lang = this.lang) {   // the language is in the system prompt: a worker translates into one language, and is started again for another
    const p = spawnClaude(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--no-session-persistence', '--tools', '', '--system-prompt', trSys(lang)], { cwd: os.tmpdir() });
    if (!p) return;
    this.p = p; this.buf = ''; this.n = 0; this.lang = lang;
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
  ask(text, lang = 'fr') { return new Promise((res) => { this.q.push({ text, lang, res }); this.pump(); }); }
  kill() { clearTimeout(this.idle); if (this.p) { const p = this.p; this.p = null; try { p.kill(); } catch {} } }
  pump() {
    if (this.busy || !this.q.length) return;
    if (!this.p || this.n >= 30 || this.lang !== this.q[0].lang) { if (this.p) { const old = this.p; this.p = null; old.kill(); } this.start(this.q[0].lang); if (!this.p) { while (this.q.length) this.q.shift().res(null); return; } }   // restart now and then: the conversation context grows
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
async function translateFast(texts, lang = 'fr') {
  const need = [...new Set(texts.filter((t) => !cache.has(lang + '|' + t)))];
  if (need.length && need.length <= 3 && !process.env.ANTHROPIC_API_KEY) {   // a few lines: warm workers in parallel; many lines: one batched call
    await Promise.all(need.map(async (t) => { const r = await pickWorker().ask(t, lang); if (r) cache.set(lang + '|' + t, r); }));
    return { texts: texts.map((t) => cache.get(lang + '|' + t) || t), ok: texts.every((t) => cache.has(lang + '|' + t)) };
  }
  return claudeMap(lang, trInstr(lang), texts);
}
const quips = (texts, lang) => claudeMap('q' + lang, `Each string is a work report from a software agent. For each, write ONE short, deadpan, funny reaction (max 12 words) from a grumpy teammate in a South Park-style cartoon meeting, in ${TR_LANG[lang] || 'English'}. No emojis.`, texts);

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
  const job = (kk ? kokoro.synth(text, voice, kokoro.speedFor(rate), tmp).catch((e) => { const vs = listVoices(), v = vs.voices.find((x) => x.name === fb) || vs.voices.find((x) => x.locale.startsWith(kokoro.localeOf(voice).slice(0, 3))); if (!v) throw e; return synthesize(v.name, rate, text, tmp); }) : synthesize(voice, rate, text, tmp))   // a line Kokoro cannot make goes to a system voice instead of being dropped: the one the page names (fb, its best system voice for this character), or else the first one of the same language
    .then(() => { fs.renameSync(tmp, file); return file; }).finally(() => ttsJobs.delete(key));
  ttsJobs.set(key, job); return job;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

// ---- Custom characters: the person's own pixel art replaces the drawn characters. Plain image files in one folder, nothing else is ever served from it.
//   lead.png / claude.png → the lead · you.png → the human · any other image → a pool for the sub-agents · name-talk.png → optional open-mouth frame of name.png
//   name-bg.png → optional room of name.png: the whole picture behind it, desk included (its bottom sixth is drawn again in front of the character)
//   name-head.png → optional head of name.png, drawn above it and nodding while it speaks: name.png is then the body, and name-talk.png the head with its mouth open
//   name-hands.png → optional hands of name.png, on their own: they type while the agent works · name-desk.png, name-desk-dark.png… → optional laptops of name.png, drawn over its hands:
//   the page gives each agent one of them, out now and then for a few seconds (all the time with ⚙ → Characters → laptop)
//   name+hat-1.png, name+hat-2.png, name+glasses-1.png… → optional extras of name.png, by kind (the word after the +): pictures drawn over it. Each agent that gets this character wears one of each kind or none,
//   so one character becomes many: it is the one given again when there are more agents than characters
//   an extra whose kind starts with "sticker" (name+sticker1-2.png) is worn by the thing on the desk, not by the character: drawn over the laptop, under the hands
const CHAR_NAME = /^[\w][\w .()+\-]{0,78}\.(png|gif|webp|jpe?g)$/i, CHAR_MAX = 300 * 1024, CHAR_TYPES = { png: 'image/png', gif: 'image/gif', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const charactersDir = () => process.env.AGENT_STANDUP_CHARACTERS || path.join(os.homedir(), '.agent-standup', 'characters');
// lstat, not stat: a symlink is not a regular file, so it is skipped and never served
// Built-in character packs, shipped with the app (examples/<folder>): picked in ⚙ → Characters. examples/characters stays in the repository as a model for one's own folder; it is not shipped
const PACKS = { cats: 'cats', vampire: 'vampire' };   // vampire: the one character of the Halloween pack that everyone gets, as the human (see the page's charYou)
// Packs sold in the shop of the website (api/ in the repository): their pictures are neither in the app nor in the repository. A bought pack is unpacked in the packs folder and is then a pack like a built-in one.
const SHOP_PACKS = { halloween: { price: '2 €', artist: 'Fabien Coupas', artistUrl: 'https://www.instagram.com/fabien_coupas/' } },   // the artist is credited wherever the pack is shown
  PACK_MAX = 20 * 1024 * 1024;
const shopUrl = () => (process.env.AGENT_STANDUP_STORE || 'https://agent-standup.com').replace(/\/+$/, ''), packsDir = () => process.env.AGENT_STANDUP_PACKS || path.join(os.homedir(), '.agent-standup', 'packs');
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);   // its own names only: 'constructor' or 'toString' is not a pack (they answered 500)
const packDir = (name) => (hasOwn(PACKS, name) ? path.join(__dirname, 'examples', PACKS[name]) : hasOwn(SHOP_PACKS, name) ? path.join(packsDir(), name) : null);
function listCharacters(pack) {
  const dir = pack ? packDir(pack) : charactersDir(); let names = []; if (!dir) return { dir: '', max: CHAR_MAX, chars: [] }; try { names = fs.readdirSync(dir); } catch {}
  const ok = names.filter((f) => CHAR_NAME.test(f)).filter((f) => { try { const st = fs.lstatSync(path.join(dir, f)); return st.isFile() && st.size <= CHAR_MAX; } catch { return false; } }).sort().slice(0, 200);
  const stem = (f) => f.replace(/\.[^.]+$/, ''), by = new Map(ok.map((f) => [stem(f).toLowerCase(), f]));
  const extra = (f) => stem(f).match(/^(.+)\+([a-z]+\d*)[-_ ]?\w*$/i);   // the kind may end with a number: sticker1, sticker2… are kinds of their own
  const layer = (f) => { const m = stem(f).match(/^(.+)-(bg|head|hands|desk(-\w+)?)$/i); return !!(m && by.has(m[1].toLowerCase())); };   // a layer only when its character is there: help-desk.png alone is a character
  const chars = ok.filter((f) => !/-talk$/i.test(stem(f)) && !layer(f) && !extra(f)).map((f) => { const st = stem(f), l = st.toLowerCase(), extras = {};
    for (const x of ok) { const m = extra(x), k = m && m[1].toLowerCase() === l ? m[2].toLowerCase() : ''; if (k) (extras[k] = extras[k] || []).push(x); }
    return { stem: st, file: f, talk: by.get(l + '-talk') || null, bg: by.get(l + '-bg') || null, desks: ok.filter((x) => { const s = stem(x).toLowerCase(); return s === l + '-desk' || s.startsWith(l + '-desk-'); }), head: by.get(l + '-head') || null, hands: by.get(l + '-hands') || null, extras: Object.keys(extras).length ? extras : null, role: /^(lead|claude)$/.test(l) ? 'lead' : /^(you|human|user)$/.test(l) ? 'you' : 'agent' }; }).sort((a, b) => a.stem.localeCompare(b.stem));
  return { dir, max: CHAR_MAX, chars };
}
// ---- Buying a pack. The app never sees a card: it asks the shop for a payment page (Stripe's), opens it in the browser, then asks the shop for the pack with the code of that purchase until the shop,
// which asks Stripe, says it is paid. The code is kept beside the packs: it is the proof of the purchase, and what installs the pack on another computer. Nothing else is sent, and nothing is asked again once the pack is here.
const codesFile = () => path.join(packsDir(), 'codes.json');
const readCodes = () => { try { const v = JSON.parse(fs.readFileSync(codesFile(), 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const writeCode = (name, v) => { const all = readCodes(); all[name] = v; fs.mkdirSync(packsDir(), { recursive: true }); const tmp = codesFile() + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(all, null, 1), { mode: 0o600 }); fs.renameSync(tmp, codesFile()); };
const packList = () => [...Object.keys(PACKS).map((name) => ({ name, n: listCharacters(name).chars.length })),
  ...Object.keys(SHOP_PACKS).map((name) => { const c = readCodes()[name] || {}; return { name, n: listCharacters(name).chars.length, shop: true, price: SHOP_PACKS[name].price, artist: SHOP_PACKS[name].artist || '', artistUrl: SHOP_PACKS[name].artistUrl || '', code: c.short || c.code || '', waiting: !!(c.pending && c.pending.length) }; })];   // the code shown is the one for people when there is one
// A pack arrives as a zip of plain image files, read here without a library: stored or deflated entries only, kept under their bare name and only if a characters folder would accept that name, each within the size of a character.
function unzipImages(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--; if (e < 0) throw new Error('not a zip');
  const n = buf.readUInt16LE(e + 10), out = []; let p = buf.readUInt32LE(e + 16); if (n > 400) throw new Error('too many files');
  for (let i = 0; i < n; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nl).split(/[\\/]/).pop();
    p += 46 + nl + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const note = /^(LICEN[CS]E|README)\.txt$/i.test(name); if (!note && !CHAR_NAME.test(name)) continue;   // a folder, a hidden file, anything that is not a picture or the pack's two notes: left out
    if (size > (note ? 65536 : CHAR_MAX) || off + 30 > buf.length) throw new Error('bad entry: ' + name);
    const from = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), raw = buf.subarray(from, from + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: CHAR_MAX }) : null; if (!data || data.length !== size) throw new Error('bad entry: ' + name);
    if (!out.some((f) => f.name.toLowerCase() === name.toLowerCase())) out.push({ name, data });
  }
  if (!out.some((f) => CHAR_NAME.test(f.name))) throw new Error('no picture in the pack');
  return out.slice(0, 200);
}
// ---- Pictures added from the page (⚙ → Characters → My folder): written in the characters folder under the name of their role, or under their own name for a sub-agent.
// The picture a new one replaces is moved to a "replaced" folder beside it, never deleted, and nothing but the four image types is written.
const IMG_MAGIC = [['png', (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47], ['gif', (b) => b.toString('latin1', 0, 4) === 'GIF8'], ['webp', (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'], ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff]];
const ROLE_FILES = { you: 'you', 'you-talk': 'you-talk', lead: 'lead', 'lead-talk': 'lead-talk' };
function putAside(dir, stem) {   // the pictures of this name, whatever their type, go to dir/replaced/ under a name that says when
  let names = []; try { names = fs.readdirSync(dir); } catch {} const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const f of names) if (CHAR_NAME.test(f) && f.replace(/\.[^.]+$/, '').toLowerCase() === stem) { fs.mkdirSync(path.join(dir, 'replaced'), { recursive: true }); fs.renameSync(path.join(dir, f), path.join(dir, 'replaced', stamp + ' ' + f)); }
}
function addCharacter(role, name, b64) {   // → { file } or throws a word the page can say: 'type', 'size', 'name'
  const data = Buffer.from(String(b64 || ''), 'base64'), type = (IMG_MAGIC.find(([, ok]) => ok(data)) || [])[0]; if (!type) throw Object.assign(new Error('type'), { word: 'type' }); if (data.length > CHAR_MAX) throw Object.assign(new Error('size'), { word: 'size' });
  const dir = charactersDir(); fs.mkdirSync(dir, { recursive: true });
  let stem = ROLE_FILES[role]; if (!stem) { stem = String(name || '').replace(/\.[^.]*$/, '').replace(/[^\w .()\-]+/g, ' ').trim().slice(0, 60).replace(/^[^\w]+/, '') || 'agent'; if (/^(lead|claude|you|human|user)(-talk)?$/i.test(stem) || /-(talk|bg|head|hands|desk(-\w+)?)$/i.test(stem)) stem += ' 2'; }   // a sub-agent never takes the name of a role
  const file = stem + '.' + type; if (!CHAR_NAME.test(file)) throw Object.assign(new Error('name'), { word: 'name' });
  if (!ROLE_FILES[role]) { let k = 2, f = file; while (fs.existsSync(path.join(dir, f))) f = `${stem} ${k++}.${type}`; fs.writeFileSync(path.join(dir, f), data); return { file: f }; }   // a sub-agent's picture never replaces another one
  putAside(dir, stem.toLowerCase()); if (!/-talk$/.test(stem)) for (const s of ['-talk', '-head', '-hands', '-bg', '-desk', '-desk-dark']) putAside(dir, stem + s);   // a new face: the old open mouth and layers go aside with the old picture
  fs.writeFileSync(path.join(dir, file), data); return { file };
}
function removeCharacter(file) {   // moved to replaced/, with its open mouth and its room; only a picture the folder lists
  const f = String(file || ''), dir = charactersDir(); if (!CHAR_NAME.test(f) || !listCharacters('').chars.some((c) => c.file === f)) return false;
  const stem = f.replace(/\.[^.]+$/, '').toLowerCase(); for (const s of [stem, stem + '-talk', stem + '-head', stem + '-bg', stem + '-desk', stem + '-desk-dark', stem + '-hands']) putAside(dir, s); return true;
}
function installPack(name, zip) {   // written beside its place first, then swapped in: a pack is never half there
  const files = unzipImages(zip), dir = packDir(name), tmp = dir + '.' + process.pid + '.tmp'; fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(tmp, f.name), f.data); fs.rmSync(dir, { recursive: true, force: true }); fs.renameSync(tmp, dir);
}
const askShop = (p, body) => fetch(shopUrl() + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
async function buyPack(name) {   // → { status, url } the payment page to open, or { status, error }
  let r; try { r = await askShop('/api/checkout', { pack: name }); } catch { return { status: 502, error: 'offline' }; }
  const j = await r.json().catch(() => ({})); if (!r.ok) return { status: r.status, error: j.error || 'shop' };
  if (typeof j.url !== 'string' || typeof j.code !== 'string' || !/^(https:\/\/|http:\/\/localhost[:/])/.test(j.url)) return { status: 502, error: 'shop' };
  const c = readCodes()[name] || {}, pending = [j.code, ...(c.pending || [])].slice(0, 5), short = typeof j.short === 'string' && /^[A-Z]{2}-[\w-]{9}$/.test(j.short) ? j.short : '';
  writeCode(name, { code: c.code || '', short: c.short || '', pending, shorts: Object.fromEntries(pending.map((k) => [k, k === j.code ? short : (c.shorts || {})[k] || ''])) }); return { status: 200, url: j.url };   // shorts: the code for people (HW-…) of each payment page opened   // a few, in case the button was pressed more than once: any of them may be the one that gets paid
}
async function claimPack(name, typed) {   // typed: a code the person pastes (another computer); else the purchases started here
  const c = readCodes()[name] || {}, tries = typed ? [typed] : [c.code, ...(c.pending || [])].filter(Boolean); if (!tries.length) return { status: 400, error: 'code' };
  let last = { status: 402, error: 'unpaid' };
  for (const code of tries) {
    let r; try { r = await askShop('/api/pack', { pack: name, code }); } catch { return { status: 502, error: 'offline' }; }
    if (r.ok) { const zip = Buffer.from(await r.arrayBuffer()); if (zip.length > PACK_MAX) return { status: 502, error: 'shop' }; try { installPack(name, zip); } catch (e) { logError('pack ' + name, e); return { status: 502, error: 'shop' }; }
      writeCode(name, { code, short: (c.shorts || {})[code] || (/^[A-Z]{2}-/i.test(code) ? code.toUpperCase() : c.short || ''), pending: [] }); return { status: 200, ok: true, n: listCharacters(name).chars.length }; }
    last = { status: r.status, error: (await r.json().catch(() => ({}))).error || 'shop' }; if (r.status !== 402 && r.status !== 404) break;   // not paid yet, or not a purchase of this pack: the next one may be; anything else is the shop's trouble
  }
  return last;
}
// ---- Shared files: a file the session created is shown in its folder (Finder, Explorer, the file manager) when the page asks. Only a file a Write call of that very session names, and only if it is still there:
// the page cannot have any other path opened, nothing is read and nothing is run. A Codex or Vibe session may name a file from the folder it was started in.
// The same goes for a document one of its commands names (an export, a report made by a script), from the moment that command started: an older file by that name is not one of its files.
function sessionFile(proj, id, file) {   // { fp: where it is, since: 0 for a file it wrote, else when the first command that names it started }
  const sx = sourceOf(proj); if (!(sx ? guard(() => sx.fileOf(id), null) : fs.existsSync(path.join(projDir(proj, id), id + '.jsonl')))) return null;
  const ev = timeline(proj, id).events, said = new Set(); let since = ev.some((e) => e.kind === 'tools' && e.tools.some((t) => t.d && t.d.kind === 'write' && t.d.file === file)) ? 0 : null;
  if (since == null) {
    for (const e of ev) if (e.kind === 'results') for (const it of e.items) if (it.files && it.files.includes(file)) said.add(it.id);   // named in what a command printed: counted from when that command started
    for (const e of ev) if (e.kind === 'tools' && e.tools.some((t) => said.has(t.id) || (t.d && t.d.kind === 'cmd' && t.d.outs && t.d.outs.includes(file)))) since = since == null ? e.ts || 1 : Math.min(since, e.ts || 1);
  }
  if (since == null || (since && ev.some((e) => e.kind === 'tools' && e.tools.some((t) => t.d && t.d.kind === 'edit' && t.d.file === file)))) return null;   // a file the session changed by hand is recent for that reason: a command that names it did not make it
  if (path.isAbsolute(file)) return { fp: path.normalize(file), since };
  const cwd = sx && sx.cwd ? guard(() => sx.cwd(id), '') : ''; return cwd ? { fp: path.resolve(cwd, file), since } : null;
}
const reveal = {   // run and stat: replaced in the tests, which must not open a window nor write a file outside their folder
  stat: (f) => fs.statSync(f),
  cmds(file, platform = process.platform) {   // one or two commands: the second is tried when the first fails
    if (platform === 'darwin') return [['open', ['-R', file]]];
    if (platform === 'win32') return [['explorer.exe', ['/select,"' + file + '"'], { windowsVerbatimArguments: true }]];   // Explorer wants the quotes around the path only (no file name holds a quote on Windows)
    const dir = ['xdg-open', [path.dirname(file)]];   // Linux: the file manager is asked to select the file; one that cannot do it opens the folder (as does a name with a comma, which dbus-send would read as two files)
    return file.includes(',') ? [dir] : [['dbus-send', ['--session', '--dest=org.freedesktop.FileManager1', '--type=method_call', '--print-reply', '/org/freedesktop/FileManager1', 'org.freedesktop.FileManager1.ShowItems', 'array:string:' + require('url').pathToFileURL(file).href, 'string:'], { timeout: 3000 }], dir];
  },
  run(file) { const go = (list) => { const c = list[0]; if (!c) return; try { execFile(c[0], c[1], c[2] || {}, (err) => { if (err) go(list.slice(1)); }); } catch { go(list.slice(1)); } }; go(reveal.cmds(file)); },
};
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
  if (sfs && sfs !== 'same-origin' && sfs !== 'none' && (req.method !== 'GET' || ['/api/translate', '/api/quips', '/api/warm', '/api/audio', '/api/tts', '/api/prefs', '/api/prefs.js', '/api/voices', '/api/kokoro', '/api/kokoro/install', '/api/media', '/api/artifact', '/api/errors', '/api/packs', '/api/reply'].includes(url.pathname))) { res.writeHead(403); return res.end('forbidden'); }
  const readBody = (cb, max = 262144) => {   // request bodies are small JSON: stop reading beyond 256 KB (or max) and give up after 10 s
    const chunks = []; let size = 0, over = false; req.setTimeout(10000, () => req.destroy());
    if (+req.headers['content-length'] > max) { res.writeHead(413); res.end('too large'); return req.destroy(); }
    req.on('data', (d) => { if (over) return; size += d.length; if (size > max) { over = true; res.writeHead(413); res.end('too large'); req.destroy(); } else chunks.push(d); });   // bytes, not characters
    req.on('end', () => { if (!over) cb(Buffer.concat(chunks).toString('utf8')); });
  };
  const textList = (x) => (Array.isArray(x) ? x : []).slice(0, 200).map((t) => String(t).slice(0, 2000));
  try {
    if (url.pathname === '/api/translate' && req.method === 'POST') return readBody(async (body) => { try { const b = JSON.parse(body); json(await translate(textList(b.texts), trLang(b.lang))); } catch (e) { json({ error: String(e) }, 400); } });
    if (url.pathname === '/api/quips' && req.method === 'POST') return readBody(async (body) => { try { const b = JSON.parse(body); json(await quips(textList(b.texts), Object.hasOwn(TR_LANG, b.lang) ? b.lang : 'en')); } catch (e) { json({ error: String(e) }, 400); } });
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
    if (url.pathname === '/api/warm') { const lang = trLang(url.searchParams.get('lang')); trWorkers.forEach((w) => { if (!w.p) w.start(lang); }); return json({ ok: true }); }
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
    if (url.pathname === '/api/prefs.js') { res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' }); return res.end('window.SAVED_PREFS = ' + JSON.stringify(readPrefs()).replace(/</g, '\\u003c') + ';' + (reply.on() ? 'window.REPLY_TOKEN = "' + REPLY_TOKEN + '";' : '')); }
    if (url.pathname === '/api/prefs' && req.method === 'PUT') return readBody((body) => { try { const v = JSON.parse(body); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('prefs must be an object'); writePrefs(v); json({ ok: true }); } catch (e) { json({ error: String(e.message || e) }, 400); } });
    if (url.pathname === '/api/prefs') return json(readPrefs() || {});
    if (url.pathname === '/api/done' && req.method === 'POST') return readBody((body) => { try { const v = JSON.parse(body); json({ ok: setDone(String(v.proj || ''), String(v.id || ''), v.on !== false) }); } catch (e) { logError('done', e); json({ error: String(e.message || e) }, 400); } });
    if (url.pathname === '/api/errors' && req.method === 'POST') return readBody((body) => { try { const b = JSON.parse(body) || {}; logError('page' + (typeof b.where === 'string' && b.where ? ' ' + b.where.slice(0, 40) : ''), { message: String(b.msg || ''), stack: String(b.stack || '') }); json({ ok: true }); } catch (e) { json({ error: String(e.message || e) }, 400); } });   // an error of the page, written to the local log
    if (url.pathname === '/api/errors') return json(errorReport());
    if (url.pathname === '/api/current') { const q = (k) => url.searchParams.get(k) || ''; return json(currentSession(q('proj'), q('pid') ? { proj: q('pproj'), id: q('pid'), since: q('since') ? +q('since') : NaN, pin: q('pin') === '1' } : null, { proj: q('sproj'), id: q('sid') })); }
    if (url.pathname === '/api/board') return json(boardRows());
    if (url.pathname === '/api/characters') return json(listCharacters(url.searchParams.get('pack') || ''));
    if (url.pathname === '/api/characters/add' && req.method === 'POST') return readBody((body) => { try { const b = JSON.parse(body || '{}') || {}; json(addCharacter(String(b.role || ''), b.name, b.data)); } catch (e) { if (!e.word) logError('add character', e); json({ error: e.word || 'write' }, e.word ? 400 : 500); } }, 512 * 1024);   // a picture of 300 KB is 400 KB once written as text
    if (url.pathname === '/api/characters/remove' && req.method === 'POST') return readBody((body) => { let b = {}; try { b = JSON.parse(body || '{}') || {}; } catch {} try { json(removeCharacter(b.file) ? { ok: true } : { error: 'file' }, 200); } catch (e) { logError('remove character', e); json({ error: 'write' }, 500); } });
    if (url.pathname === '/api/packs') return json(packList());
    if ((url.pathname === '/api/packs/buy' || url.pathname === '/api/packs/claim') && req.method === 'POST') return readBody((body) => {
      let b = {}; try { b = JSON.parse(body || '{}') || {}; } catch {} const name = String(b.pack || ''); if (!hasOwn(SHOP_PACKS, name)) return json({ error: 'pack' }, 404);
      (url.pathname.endsWith('/buy') ? buyPack(name) : claimPack(name, typeof b.code === 'string' ? b.code.trim().slice(0, 260) : '')).then((r) => json(r, r.status), (e) => { logError('shop', e); json({ error: 'shop' }, 500); });
    });
    if (url.pathname === '/api/reveal' && req.method === 'POST') return readBody((body) => {   // 404: not a file this session created · 410: created, and no longer there
      try {
        let b = null; try { b = JSON.parse(body); } catch {} const SAFE = /^[\w.\-]+$/, ok = (v) => typeof v === 'string' && SAFE.test(v) && v !== '..' && v.length <= 200;
        if (!b || !ok(b.proj) || !ok(b.id) || typeof b.file !== 'string' || !b.file || b.file.length > 4096) return json({ error: 'bad request' }, 400);
        const f = sessionFile(b.proj, b.id, b.file); if (!f) return json({ error: 'not a file of this session' }, 404);
        let st = null; try { st = reveal.stat(f.fp); } catch {} if (!st || !st.isFile()) return json({ error: 'gone' }, 410);
        if (f.since && st.mtimeMs < f.since - 2000) return json({ error: 'not a file of this session' }, 404);   // a command names it, and it was there before: read, listed or removed, not made
        if (b.check !== true) reveal.run(f.fp); json({ ok: true });   // check: the page asks whether a document a command names is there, before it shows it
      } catch (e) { json({ error: String(e.message || e) }, 500); }
    });
    if (url.pathname === '/api/media') {
      const q = (k) => url.searchParams.get(k) || '', SAFE = /^[\w.\-]+$/, n = +q('n') || 0, bad = [q('proj'), q('id'), q('agent'), q('tool')].some((v) => !SAFE.test(v) || v === '..' || v.length > 200) || q('tool').length < 6;   // no tool call has an id that short, and looking for one meant reading the whole transcript
      const file = bad || !Number.isInteger(n) || n < 0 || n > 9 ? null : mediaFile(q('proj'), q('id'), q('agent')), im = file && toolImage(file, q('tool'), n);
      if (!im) { res.writeHead(bad ? 400 : 404); return res.end(bad ? 'bad request' : 'not found'); }
      res.writeHead(200, { 'content-type': im.type, 'content-length': im.buf.length, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' }); return res.end(im.buf);
    }
    if (url.pathname === '/api/artifact') {   // the page a publish of this session sent, for the frame of the shared screen · check=1: is there one, and does it name libraries (asked before the frame is drawn) · whole=1: the whole document
      const q = (k) => url.searchParams.get(k) || '', SAFE = /^[\w.\-]+$/, bad = [q('proj'), q('id'), q('agent'), q('tool')].some((v) => !SAFE.test(v) || v === '..' || v.length > 200) || q('tool').length < 6;
      if (bad) { res.writeHead(400); return res.end('bad request'); }
      const file = sourceOf(q('proj')) ? null : mediaFile(q('proj'), q('id'), q('agent')), plan = file && fs.existsSync(file) && fs.existsSync(mediaFile(q('proj'), q('id'), 'main')) ? artifactPlan(q('proj'), q('id'), q('agent'), q('tool')) : null, page = plan && artifactBuild(file, q('tool'), plan, q('whole') === '1');
      if (q('check')) return json(page ? { ok: true, net: page.net, ...(page.pages > 1 ? { pages: page.pages, label: page.label } : {}) } : { ok: false }, page ? 200 : 404);   // pages: a document of several pages, which can be shown whole (whole=1)
      if (!page) { res.writeHead(404); return res.end('not found'); }
      const body = Buffer.from((/^\s*<!doctype/i.test(page.html) ? '' : '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">') + page.html, 'utf8');   // an artifact is published as the inside of a page: claude.ai adds the rest, and so does this
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'content-security-policy': artifactCsp(q('net') === '1'), 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'private, no-store' }); return res.end(body);
    }
    if (url.pathname === '/api/reply') {   // the human's line: can this session hear it (GET), type it into its terminal (POST)
      if (!reply.on()) { res.writeHead(404); return res.end('not found'); }
      if (req.method === 'POST') return readBody((body) => { let b = {}; try { b = JSON.parse(body) || {}; } catch {} if (!replyTokenOk(b.token)) return json({ error: 'token' }, 403); reply.send(String(b.id || ''), b.text).then((r) => json(r, r.ok ? 200 : r.error === 'text' ? 400 : 409), (e) => { logError('reply', e); json({ error: 'tmux' }, 500); }); }, 16384);
      return reply.lookup(url.searchParams.get('id') || '').then(({ pane, ...r }) => json(r), (e) => { logError('reply', e); json({ ok: false, why: 'tmux' }); });
    }
    if (url.pathname === '/api/session') {
      const proj = url.searchParams.get('proj') || '', sid = url.searchParams.get('id') || '', SAFE = /^[\w.\-]+$/;
      if (!SAFE.test(proj) || !SAFE.test(sid) || proj === '..' || sid === '..' || proj.length > 200 || sid.length > 200) { res.writeHead(400); return res.end('bad request'); }
      if (proj !== '_demo' && !(sourceOf(proj) ? sourceOf(proj).fileOf(sid) : fs.existsSync(path.join(projDir(proj, sid), sid + '.jsonl')))) return json({ error: 'session not found' }, 404);
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
      if (a === tl.seq) { if (!entry.idle) entry.idle = JSON.stringify({ id: tl.id, agents: tl.agents, ep: tl.ep, seq: tl.seq, marks: tl.marks, events: [] }); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(entry.idle); }   // nothing new, which is the answer to nearly every poll: written once
      return json({ id: tl.id, agents: tl.agents, ep: tl.ep, seq: tl.seq, marks: tl.marks, events: feedSince(entry, a) });   // new events and changed ones alike, whole, under the key they always had
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
    // The only frame of the page is the window of an artifact, served from here. Without this line a page shown there could take its own frame to another site, and send out what it holds in the address.
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', ...(path.extname(file) === '.html' ? { 'content-security-policy': "frame-src 'self'" } : {}) });
    res.end(fs.readFileSync(file));
  } catch (e) { logError(req.method + ' ' + url.pathname, e); if (res.headersSent) return res.destroy(); json({ error: String(e.message || e) }, 500); }
  }).listen(port, '127.0.0.1', function () { console.log(`Agent Standup → http://localhost:${this.address().port}`); });
}
module.exports = { start, currentSession, shutdown, findClaude, bundledClaude, boardRows, sessionRows: listSessions, charactersDir, listCharacters, packsDir, installPack, logError, _reveal: reveal, _scrub: { tidy, homeRe }, _artifact: { page: artifactPage, csp: artifactCsp } };
if (require.main === module) {
  start().on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use (maybe Agent Standup is already running, e.g. inside VS Code). Try: PORT=4790 node server.js` : String(e));
    process.exit(1);
  });
}
