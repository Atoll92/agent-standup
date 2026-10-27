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
const SOURCES = [codex, vibe], sourceOf = (proj) => SOURCES.find((m) => m.PROJ === proj) || null, guard = (fn, or) => { try { return fn(); } catch (e) { logError('reader', e); return or; } };   // guard: a session of another tool that cannot be read costs that session, never the list   // the tools other than Claude Code: each lists its sessions under one made-up project
const kokoro = require('./kokoro.js');   // natural voices, installed on demand (see kokoro.js)
const zlib = require('zlib');
const { execFileSync, execFile } = require('child_process');

const PORT = process.env.PORT || 4747;
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
const coworkNotes = new Map(), coworkNoteOf = new Map();   // note file → { sig, title }; session folder → { f: its note in the newer layout, at: when looked for }
function coworkNote(s, id) {   // the note of the session folder s: <s>.json, or in the newer layout (a folder named after the start of the session's own id) local_<s>-….json beside it, the one that names this transcript when there are several
  if (mtimeOf(s + '.json')) return s + '.json';
  const c = coworkNoteOf.get(s); if (c && (c.f ? mtimeOf(c.f) : Date.now() - c.at < 10e3)) return c.f;   // a folder without a note is looked at again after 10 s, not at every scan
  const parent = path.dirname(s), pre = 'local_' + path.basename(s) + '-'; let names = []; try { names = fs.readdirSync(parent).filter((n) => n.startsWith(pre) && n.endsWith('.json')).map((n) => path.join(parent, n)); } catch {}
  const f = names.length === 1 ? names[0] : names.find((p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')).cliSessionId === id; } catch { return false; } }) || '';
  coworkNoteOf.set(s, { f, at: Date.now() }); return f;
}
function coworkTitle(proj, id) {   // the name the desktop app gave the session, the one its own list shows: kept in a note beside the session's folder, of which the title alone is taken
  const dir = proj === COWORK && coworkMap().get(id); if (!dir) return '';
  const f = coworkNote(path.resolve(dir, '..', '..', '..'), id); let st; try { st = fs.statSync(f); } catch { return ''; }
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
  if (typeof rec.type === 'string' && rec.type.startsWith('api-request')) return [];   // a request Claude Code kept (2.1.300 on): its blocks repeat the conversation sent, calls and edits included, which happened once, in their own records
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
// A call that drives a browser (Claude in Chrome, written claude-in-chrome by Claude Code and Claude_in_Chrome by the desktop app; the desktop app's own browser): its steps (one, or those of a browser_batch, in order), for the browser window of the shared screen.
// a: what it did · x, y: where it clicked, in the frame of the page's screenshots · t: what it typed or the key it pressed · u: the address it went to · q: what it looked for · n: its own one-line account of the step
// Claude Preview (the desktop app's preview of a local server, mcp__Claude_Preview__preview_*, also offered by its browser) is one too: its steps are named after the tool, without "preview_" (start, eval, resize, screenshot, logs, stop…).
const BROWSER_MCP = /^mcp__(?:[^_]+__)?(claude-in-chrome|Claude_in_Chrome|Claude_Browser|Claude_Preview)__/;
const previewStep = (name, i) => {
  const a = name.slice(8) === 'console_logs' ? 'logs' : name.slice(8, 38), s = { a };
  if (a === 'eval' && typeof i.expression === 'string') s.q = clip(i.expression, 120); if (typeof i.url === 'string') s.u = clip(i.url, 300);   // the page a start names, as 1.40 showed it
  if (a === 'resize') { if (Number.isFinite(+i.width) && Number.isFinite(+i.height) && i.width != null && i.height != null) { s.w = +i.width; s.h = +i.height; } else if (typeof i.preset === 'string') s.preset = clip(i.preset, 30); }   // a size, or one of its presets (desktop, mobile…)
  return s;
};
const browserStep = (name, i) => {
  i = i && typeof i === 'object' ? i : {}; if (!i.action && /^preview_/.test(name || '')) return previewStep(name, i);
  const s = { a: String(i.action || name || '').slice(0, 30) }, c = Array.isArray(i.coordinate) ? i.coordinate : null;
  if (c && Number.isFinite(+c[0]) && Number.isFinite(+c[1])) { s.x = +c[0]; s.y = +c[1]; }
  if (typeof i.url === 'string') s.u = clip(i.url, 300); if (typeof i.text === 'string' && /type|key/.test(s.a)) s.t = clip(i.text, 80); if (typeof i.query === 'string') s.q = clip(i.query, 120); if (typeof i.action_summary === 'string') s.n = clip(i.action_summary, 140);
  return s;
};
const browserLabel = (name, i) => ({ kind: 'browser', steps: (Array.isArray(i.actions) ? i.actions.slice(-12).map((x) => browserStep(x && x.name, x && x.input)) : [browserStep(name, i)]) });
// What a browser call answered about the page: its address and title, the frame its clicks are counted in (a screenshot at half scale is still clicked in full-size coordinates),
// and p: where its last click landed, which the desktop app's browser says when the agent named an element instead of a point ("left_click at (628, 441) [ref_112]"). Its tabs have names ("seed"), not numbers; the desktop app's Chrome writes a tab's address without quotes
// A preview's answers say other things: the port of the server it started (u), the size it gave the page (f), and the last lines of the page's console or of the server's log (log, [] when there are none), shown under the page.
function previewSeen(tool, text, web) {
  if (tool === 'preview_start') { const m = /"port":\s*(\d{2,5})\b/.exec(text); if (m) web.u = 'http://localhost:' + m[1]; }
  else if (tool === 'preview_resize') { const m = /\b(\d{2,5}) ?x ?(\d{2,5})\b/.exec(text); if (m && +m[1] > 0 && +m[2] > 0) web.f = [+m[1], +m[2]]; }
  else if (tool === 'preview_console_logs' || tool === 'preview_logs') { const lines = noAnsi(text.slice(-64000)).split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()); web.log = lines.length === 1 && /^No\b.*\.$/.test(lines[0]) ? [] : lines.slice(-12).map((l) => clip(l, 200)); }   // "No console logs."
}
function browserSeen(text, name) {
  const all = (re) => [...text.matchAll(re)].pop(), web = {}, tab = (text.match(/Executed on tabId: ([\w-]+)/) || [])[1], row = tab && all(new RegExp(`tabId ${tab}: "(.*)" \\("?([^"\\s]*?)"?\\)\\s*$`, 'gm'));
  const u = all(/(?:[Nn]avigated to|URL:) *(\S+)/g), t = all(/^Title: *(.+)$/gm), f = all(/coordinate frame: *(\d+)x(\d+)/g) || all(/captured screenshot \((\d+)x(\d+)/g) || all(/Screenshot size: *(\d+)x(\d+)/g), p = all(/\b(?:left_click|right_click|double_click|triple_click|hover) at \((\d+), *(\d+)\)/g);
  const url = (u && u[1]) || (row && row[2]) || ''; if (/^(https?|file|chrome|about):/i.test(url)) web.u = clip(url, 300);
  const title = (t && t[1]) || (row && row[1] !== row[2] && row[1]) || ''; if (title) web.t = clip(title.trim(), 120);
  if (f && +f[1] > 0 && +f[2] > 0) web.f = [+f[1], +f[2]]; if (p) web.p = [+p[1], +p[2]];
  const tool = String(name || '').split('__').pop(); if (/^preview_/.test(tool)) previewSeen(tool, text, web);
  return Object.keys(web).length ? { web } : {};
}
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
    case 'TaskCreate': out.d = { kind: 'task', op: 'create', subject: clip(i.subject, 120), active: clip(i.activeForm, 120) }; if (typeof i.subject === 'string') out.arg = i.subject.slice(0, 90); break;   // the task list of Claude Code 2.1.200 on, one call per task (TaskStop and TaskOutput are about background commands: calls like any other)
    case 'TaskUpdate': out.d = { kind: 'task', op: 'update', taskId: clip(i.taskId, 40), ...(typeof i.status === 'string' ? { status: i.status.slice(0, 20) } : {}), ...(typeof i.subject === 'string' ? { subject: clip(i.subject, 120) } : {}) }; break;
    case 'ExitPlanMode': out.d = { kind: 'plan', text: clip(i.plan, 4000) }; break;
    case 'WebFetch': out.d = { kind: 'web', url: i.url }; break;
    case 'WebSearch': out.d = { kind: 'web', query: i.query }; break;
    case 'NotebookEdit': out.d = { kind: 'edit', file: i.notebook_path, old: '', new: clip(i.new_source, 500) }; break;
    case 'AskUserQuestion': out.d = { kind: 'text', what: 'question', text: clip((q0 ? q0.question + '\n' + (q0.options || []).map((o) => '• ' + (o.label || '')).join('\n') : ''), 500) }; break;
    case 'Skill': out.d = { kind: 'text', what: 'skill', v: i.skill, text: clip(i.skill + (i.args ? ' ' + i.args : ''), 200) }; break;
    case 'ToolSearch': out.d = { kind: 'text', what: 'toolsearch', text: clip(i.query, 200) }; break;
    case 'Artifact': if ((!i.action || i.action === 'publish') && !i.asset) { out.d = { kind: 'artifact', file: typeof i.file_path === 'string' ? i.file_path : '', title: clip(i.title, 120), note: clip(i.description, 240) }; const sent = i.files ? artSentOf(i) : [], pg = !/\.html?$/i.test(out.d.file) && sent.find((f) => /\.html?$/i.test(f)); if (sent.length > 1) out.d.sent = sent; if (pg) out.d.page = pg; break; }   // a page published on claude.ai: the call shows it in a browser window (see artifactPage). Any other use of the tool (a read, a list, an upload) is a call like any other
    if (i.action === 'open') { out.d = { kind: 'artifact', file: '', title: '', note: '', open: 1 }; break; }   // a page put on the person's screen: in the line of files when this session did not make it (see artOf)
    // falls through
    default: if (BROWSER_MCP.test(b.name)) { out.d = browserLabel(mcp[mcp.length - 1], i); const s = out.d.steps[out.d.steps.length - 1]; if (s) out.arg = String(s.n || s.u || s.q || s.a).slice(0, 90); break; }
      if ((b.name === 'mcp__workspace__bash' || b.name === 'mcp__terminal__run_in_terminal') && typeof i.command === 'string') { out.d = { kind: 'cmd', text: clip(i.command, 1200), note: clip(i.title || i.description, 140) }; break; }   // Cowork's commands (its sandbox, the person's own terminal): commands like Bash
      if (b.name === 'mcp__workspace__web_fetch' && typeof i.url === 'string') { out.d = { kind: 'web', url: i.url }; break; }
      if (b.name === 'mcp__cowork__present_files' && Array.isArray(i.files)) {   // Cowork hands files to the person: the line of files shows them (outs), as the documents a command makes
        const outs = i.files.map((f) => (typeof f === 'string' ? f : f && f.file_path)).filter((f) => typeof f === 'string' && path.isAbsolute(f) && f.length <= 400).slice(0, 16);
        out.d = { kind: 'text', what: 'mcp', v: 'cowork · present_files', text: clip(outs.map((f) => path.basename(f)).join('\n'), 400), ...(outs.length ? { outs } : {}) }; break;
      }
      if (mcp && /(^|_)Claude_Docs$/.test(mcp[1] || '') && mcp[2] === 'batch' && i.container && i.container.create && typeof i.container.create.name === 'string') { out.d = { kind: 'artifact', file: '', title: clip(i.container.create.name, 120), note: '', doc: 1 }; break; }   // a doc of the Claude Docs connector being born (its later edits are calls like any other)
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
// The colours and cursor moves of a terminal (ANSI escape codes) are taken out of what a tool printed: the page shows text. clipOut: clip for an output, taking them out of the part it keeps.
const ANSI = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\x1b/g;   // and an escape left alone (a sequence cut short, bytes that are not text)
const noAnsi = (s) => (s.includes('\x1b') ? s.replace(ANSI, '') : s);
const clipOut = (x, n = 700) => { const s = String(x == null ? '' : x); return noAnsi(s.length > n + 400 ? s.slice(0, n + 400) : s).slice(0, n); };
// A test run, summed up for the shared screen: its runner, how many passed, failed and were skipped, and the names of the first that failed. Only when the output has the summary line of one of
// these runners: node:test (its spec and TAP reporters), vitest, jest, pytest, mocha, go test, cargo test. Any other output, numbers and all, is not a test run.
const TESTS_SEEN = /^[ \t]*(?:ℹ (?:tests|pass|fail) \d|# (?:tests|pass|fail) \d|Tests:? +\d|=+ [^\n]{0,300}?\b(?:passed|failed|errors?|skipped|no tests ran)\b[^\n]{0,300}? in [\d.]+s\b|\d+ (?:passing|failing)\b|test result: |(?:ok|FAIL)[ \t]+\S+[ \t]+(?:[\d.]+s|\(cached\))|--- FAIL: )/m;
function testsOf(text0) {   // the patterns are bounded per line (300 characters): a long line of output must not hold the server
  let text = String(text0 || ''); if (text.length > 400000) text = text.slice(-400000);   // a summary is at the end
  text = noAnsi(text); if (!TESTS_SEEN.test(text)) return null;
  const all = (re, s = text) => [...s.matchAll(re)], counts = (s) => { const o = {}; for (const x of s.matchAll(/(\d+) ([a-z]+)/g)) o[x[2]] = (o[x[2]] || 0) + +x[1]; return o; }, failed = [];
  const name = (s) => { s = String(s || '').trim().slice(0, 120); if (s && failed.length < 6 && !failed.includes(s)) failed.push(s); };
  const out = (runner, pass, fail, skip, total) => ({ runner, pass, fail, skip, total: total || pass + fail + skip, failed });
  let m = all(/^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/gm);   // cargo: one line per test binary
  if (m.length) { for (const x of all(/^test (\S+) \.\.\. FAILED[ \t]*$/gm)) name(x[1]); const sum = (i) => m.reduce((s, x) => s + +x[i], 0); return out('cargo', sum(1), sum(2), sum(3)); }
  m = all(/^=+ ([^\n=]{0,300}?\b(?:passed|failed|errors?|skipped|no tests ran)\b[^\n=]{0,300}?) in [\d.]+s\b[^\n]{0,300}?=+[ \t]*$/gm).pop();   // pytest: "=== 3 failed, 40 passed, 2 skipped in 1.2s ==="
  if (m) { const c = counts(m[1]); for (const x of all(/^(?:FAILED|ERROR) (\S+)/gm)) name(x[1]); return out('pytest', (c.passed || 0) + (c.xpassed || 0), (c.failed || 0) + (c.error || 0) + (c.errors || 0), (c.skipped || 0) + (c.xfailed || 0)); }
  const gp = all(/^(ok|FAIL)[ \t]+\S+[ \t]+(?:[\d.]+s|\(cached\))/gm), gt = all(/^[ \t]*--- (PASS|FAIL|SKIP): (\S+)/gm), k = (w) => gt.filter((x) => x[1] === w).length;   // go test: a line per package, and one per test with -v (failures always)
  if (gp.length || k('FAIL')) { for (const x of gt) if (x[1] === 'FAIL') name(x[2]); return k('PASS') ? out('go', k('PASS'), k('FAIL'), k('SKIP')) : out('go', gp.filter((x) => x[1] === 'ok').length, k('FAIL') || gp.filter((x) => x[1] === 'FAIL').length, k('SKIP')); }
  m = all(/^[ \t]*Tests[ \t]{2,}(.+?)[ \t]*\((\d+)\)[ \t]*$/gm).pop();   // vitest: "Tests  3 failed | 40 passed (43)"
  if (m) { const c = counts(m[1]); for (const x of all(/^[ \t]*FAIL[ \t]+(.+?)[ \t]*$/gm)) name(x[1]); for (const x of all(/^[ \t]*[×✗][ \t]+(.+?)(?:[ \t]+\d+m?s)?[ \t]*$/gm)) name(x[1]); return out('vitest', c.passed || 0, c.failed || 0, (c.skipped || 0) + (c.todo || 0), +m[2]); }
  m = all(/^[ \t]*Tests:[ \t]+(.+?)[ \t]*$/gm).pop();   // jest: "Tests: 2 failed, 40 passed, 42 total"
  if (m) { const c = counts(m[1]); for (const x of all(/^[ \t]*● (.+?)[ \t]*$/gm)) if (!/^(Console|Test suite failed to run)$/.test(x[1])) name(x[1]); for (const x of all(/^[ \t]*[✕×][ \t]+(.+?)(?:[ \t]+\(\d+ m?s\))?[ \t]*$/gm)) name(x[1]); return out('jest', c.passed || 0, c.failed || 0, (c.skipped || 0) + (c.todo || 0), c.total); }
  const mp = /^[ \t]*(\d+) passing\b/m.exec(text), mf = /^[ \t]*(\d+) failing\b/m.exec(text), mn = /^[ \t]*(\d+) pending\b/m.exec(text);   // mocha: "40 passing (2s)", "3 failing", then the failures, numbered
  if (mp) {   // mocha always says how many passed: a count of failures alone is some other script's
    const ls = mf ? text.slice(mf.index).split('\n') : [], seen = new Set();   // a failure's title runs over several lines, its suites then the test, which ends with ":"
    for (let i = 0; i < ls.length && failed.length < 6; i++) { const x = /^[ \t]*(\d+)\) (.+?)[ \t]*$/.exec(ls[i]); if (!x || seen.has(x[1])) continue; seen.add(x[1]); let t = x[2]; for (let j = i + 1; !/:$/.test(t) && j < Math.min(ls.length, i + 6) && ls[j].trim(); j++) t += ' › ' + ls[j].trim(); name(t.replace(/:$/, '')); }
    return out('mocha', mp ? +mp[1] : 0, mf ? +mf[1] : 0, mn ? +mn[1] : 0);
  }
  m = all(/^(?:ℹ|#) (tests|pass|fail|cancelled|skipped|skip|todo) (\d+)[ \t]*$/gm);   // node:test, spec reporter (ℹ) or TAP (#); a command that runs it twice prints two summaries
  if (m.some((x) => x[1] === 'tests')) { const c = {}; for (const x of m) c[x[1]] = (c[x[1]] || 0) + +x[2]; for (const x of all(/^[ \t]*not ok \d+ - (.+?)(?:[ \t]+#.*)?[ \t]*$/gm)) name(x[1]); for (const x of all(/^[ \t]*✖ (.+?)(?: \([\d.]+m?s\))?[ \t]*$/gm)) if (x[1] !== 'failing tests:') name(x[1]); return out('node', c.pass || 0, (c.fail || 0) + (c.cancelled || 0), (c.skipped || 0) + (c.skip || 0), c.tests); }
  return null;
}
// A change shown as a diff, from what Claude Code noted of an Edit or a Write (structuredPatch), or of a command that changed files (bashEditDiff, 2.1.283 on). At most 3 files, 4 parts of each, 40 lines a part. more: the files left out.
function diffOf(files, moreFiles) {
  const fl = files.filter((f) => f && typeof f.file === 'string' && Array.isArray(f.hunks) && f.hunks.length); if (!fl.length) return null;
  const out = { files: fl.slice(0, 3).map((f) => ({ file: clip(f.file, 400), hunks: f.hunks.slice(0, 4).map((h) => ({ o: +(h && h.oldStart) || 0, n: +(h && h.newStart) || 0, lines: (h && Array.isArray(h.lines) ? h.lines : []).slice(0, 40).map((l) => clip(l, 200)) })) })) };
  const more = (+moreFiles > 0 ? +moreFiles : 0) + fl.length - out.files.length; if (more) out.more = more;
  return out;
}
// What else a result says, for the shared screen, from its text and from what Claude Code noted about the call (u: the record's toolUseResult): tests, diff, search (the links a search found), fetch (a page read),
// task (a task created), bg (the id of a command left running in the background, whose output /api/taskout reads). The original of an edited file, which Claude Code also notes, is never kept.
const CMD_TOOL = new Set(['Bash', 'mcp__workspace__bash', 'mcp__terminal__run_in_terminal']), taskId = (v) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : '');
function resultMore(n, text, u) {
  const o = {}; if (CMD_TOOL.has(n)) { const t = testsOf(text); if (t) o.tests = t; }
  if (!u || typeof u !== 'object' || Array.isArray(u)) return o;
  if (n === 'Bash') { const d = u.bashEditDiff, x = d && Array.isArray(d.files) && diffOf(d.files.map((f) => ({ file: f && f.filePath, hunks: f && f.hunks })), d.moreFiles); if (x) o.diff = x; if (taskId(u.backgroundTaskId)) o.bg = u.backgroundTaskId; }
  else if (n === 'Edit' || n === 'MultiEdit' || n === 'Write') { const x = Array.isArray(u.structuredPatch) && diffOf([{ file: u.filePath, hunks: u.structuredPatch }], 0); if (x) o.diff = x; }
  else if (n === 'WebSearch' && Array.isArray(u.results)) { const s = []; for (const r of u.results) for (const c of r && Array.isArray(r.content) ? r.content : []) if (c && typeof c.url === 'string' && s.length < 8) s.push({ t: clip(c.title, 120), u: clip(c.url, 300) }); if (s.length) o.search = s; }
  else if (n === 'WebFetch' && typeof u.url === 'string') o.fetch = { u: clip(u.url, 300), ...(Number.isFinite(u.code) ? { code: u.code } : {}), ...(Number.isFinite(u.bytes) ? { bytes: u.bytes } : {}), ...(Number.isFinite(u.durationMs) ? { ms: u.durationMs } : {}) };
  else if (n === 'TaskCreate' && u.task && u.task.id != null) o.task = { id: clip(u.task.id, 40), subject: clip(u.task.subject, 120) };
  else if (n === 'Monitor' && taskId(u.taskId)) o.bg = u.taskId;
  else if (n === 'TaskOutput' && u.task && taskId(u.task.task_id) && !/agent/.test(String(u.task.task_type || ''))) o.bg = u.task.task_id;   // a command's output asked for; a sub-agent's is its transcript
  return o;
}
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
  if (agent === 'main' || agent === 'user') return path.join(projDir(proj, sid), sid + '.jsonl');   // user: the pictures pasted with a message, in the lead's file
  const hit = subFiles(proj, sid).find((x) => x.aid === agent);
  return hit ? hit.file : null;
}
function toolImage(file, toolId, n, user) {   // looks for the tool's result line in the transcript, 8 MB at a time; the few pictures asked last are kept in memory. user: toolId is the id of a message the person sent (its uuid), and the pictures are the ones pasted with it
  const key = file + '|' + toolId + '|' + n + (user ? '|u' : ''), memo = mediaMemo.get(key); if (memo && memo.buf) return memo;
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
        if (user) { const im = r.type === 'user' && r.uuid === toolId ? blocks(r).filter(isImg)[n] : null; if (im) found = { type: im.source.media_type, buf: Buffer.from(im.source.data, 'base64') }; continue; }
        for (const blk of blocks(r)) if (blk.type === 'tool_result' && blk.tool_use_id === toolId) { const im = resultImages(blk.content)[n]; if (im) found = { type: im.source.media_type, buf: Buffer.from(im.source.data, 'base64') }; }
      }
      carry = all.subarray(all.lastIndexOf(10) + 1);
    }
  } catch {} finally { if (fd != null) fs.closeSync(fd); }
  mediaMemo.delete(key); mediaMemo.set(key, found || { miss: size }); if (mediaMemo.size > 12) mediaMemo.delete(mediaMemo.keys().next().value);
  return found;
}
// ---- A command left running in the background (Bash sent to the background, Monitor): Claude Code writes what it prints, as it comes, to <its temporary folder>/<project>/<session id>/tasks/<task id>.output,
// and ends the file with "[exited with code N]" once it stops. The shared screen shows the end of it while it runs. Only that file is read, of a session the call knows; nothing is sent anywhere.
// The temporary folder is claude-<uid> in /tmp (macOS and Linux), in the system's own (os.tmpdir) or in CLAUDE_CODE_TMPDIR. The project is found by the session's folder: a session that moved to a worktree writes under another name.
const TASKOUT_MAX = 12 * 1024;
function claudeTemps() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null, out = []; if (uid == null) return out;
  for (const d of ['/tmp', os.tmpdir(), process.env.CLAUDE_CODE_TMPDIR]) { if (!d) continue; let real; try { real = fs.realpathSync(path.join(d, 'claude-' + uid)); const st = fs.statSync(real); if (st.uid !== uid || (st.mode & 0o022)) continue; } catch { continue; } if (!out.includes(real)) out.push(real); }   // yours, and nobody else can write in it (a shared /tmp)
  return out;
}
function taskOutput(proj, id, task) {   // { text: its last whole lines (12 KB at most), done, code: its exit code once it said it, size, mtime }, or null
  for (const root of claudeTemps()) {
    let keys = []; try { keys = fs.readdirSync(root); } catch { continue; }
    for (const key of keys.includes(proj) ? [proj, ...keys.filter((k) => k !== proj)] : keys) {
      const fp = path.join(root, key, id, 'tasks', task + '.output'); let st; try { st = fs.lstatSync(fp); } catch { continue; }
      if (!st.isFile()) continue;   // a link (a sub-agent's output is one, to its transcript) is not followed
      let buf = Buffer.alloc(0), size = st.size; const fd = fs.openSync(fp, 'r');
      try { size = fs.fstatSync(fd).size; const n = Math.min(size, TASKOUT_MAX + 4096); buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, size - n); } finally { fs.closeSync(fd); }
      let text = buf.toString('utf8'); if (buf.length < size) { const nl = text.indexOf('\n'); text = nl >= 0 ? text.slice(nl + 1) : text.slice(text.lastIndexOf('\r') + 1); }   // whole lines only; with no line at all, a progress bar redrawn with \r: from its last state
      text = noAnsi(text).split('\n').map((l) => { l = l.replace(/\r$/, ''); const r = l.lastIndexOf('\r'); return r >= 0 ? l.slice(r + 1) : l; }).join('\n');   // a progress bar redrawn in place: its last state
      const over = Buffer.byteLength(text) - TASKOUT_MAX; if (over > 0) { const b = Buffer.from(text), nl = b.indexOf(10, over); text = nl >= 0 && nl < b.length - 1 ? b.subarray(nl + 1).toString('utf8') : b.subarray(b.length - TASKOUT_MAX / 4).toString('utf8'); }   // cut once, at the first whole line that fits
      const m = /\[exited with code (-?\d+)\]\s*$/.exec(text);
      return { text, done: !!m || Date.now() - st.mtimeMs > 10 * 60e3, code: m ? +m[1] : null, size, mtime: st.mtimeMs };   // done: it said so, or it has been silent for 10 minutes
    }
  }
  return null;
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
const sigOf = (e) => e.kind + '|' + e.agent + '|' + (e.to || '') + '|' + (e.end || '') + '|' + (e.kind === 'tools' ? e.tools.length + ':' + e.tools[e.tools.length - 1].id + ':' + e.tools.map((t) => (t.d && t.d.kind === 'plan' ? (t.d.text || '').length + (t.d.text || '').slice(-24) : '')).join(',') : e.kind === 'usage' ? e.u.i + ',' + e.u.o + ',' + e.u.r + ',' + e.u.w + ',' + e.model : e.kind === 'order' ? e.toolId + ',' + e.bg + ',' + e.title + ',' + e.text : e.kind === 'finish' ? e.ts : '');   // everything about an event that can differ from one build to the next (a plan's text too: its answer names the plan approved). Except for an order's late-arriving prompt, its text, its tool calls, its results and its time never do: they come from one transcript record (same key = same record); and `t` moves only when time zero does, which feedStep looks at once for all
function feedStep(prev, tl, files) {
  let f = prev && files.every((x) => { const was = prev.gens.get(x); return was === undefined || was === (fileStates.get(x) || {}).gen; }) ? prev : null;   // a transcript read again from its start numbers its events again: the keys no longer mean the same thing
  for (let pass = 0; ; pass++) {
    if (!f) f = { ep: crypto.randomBytes(6).toString('hex'), seq: 0, known: new Map(), gens: new Map() };
    const n = tl.events.length, sq = new Uint32Array(n), seq = f.seq + 1, before = f.known.size, z = tl.events.find((e) => e.kind !== 'usage' && e.kind !== 'finish' && e.kind !== 'compact' && e.kind !== 'tasks'), t0 = z ? z.ts : 0, moved = f.t0 !== t0; let hits = 0, changed = false; f.t0 = t0;   // time zero moved (something now comes before the first line): every `t` is different
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
// Since Claude Code 2.1.300 a transcript also keeps each request it sent (system prompt, tools, parameters) and a snapshot of the prompt: lines of 100 KB and more, about 40% of a new file.
// A card reads the last 192 KB of the other records: further back when those fill it (3 MB at most). Right after an order, the order itself was out of the 192 KB 1 time in 20.
const BULKY = /^\{"type":"api-request|"attachment":\{"type":"prompt_snapshot"/, TAIL = 192 * 1024;
function boardTail(file) {
  for (let n = TAIL; ; n *= 4) { const { text, cut } = readTail(file, n), lines = text.split('\n'); if (cut) lines.shift(); let rest = 0; for (const l of lines) if (!BULKY.test(l.slice(0, 200))) rest += l.length; if (!cut || rest >= TAIL || n >= 3 * 1024 * 1024) return { lines, cut }; }
}
const APPROVAL = /^(Edit|Write|MultiEdit|NotebookEdit)/, ASKS = /^(AskUserQuestion|ExitPlanMode)/, SUBTOOL = /^(Task|Agent)$/;
// A turn that ended without doing what was asked ("I couldn't verify how old the posts were, so 0 drafts"): to the eye, the same "your turn" as one that did. It says so in its first sentence;
// later on, "I couldn't" is mostly a caveat on work that was done ("Done. I couldn't test on Windows"), and so is a first sentence that says what worked before a "but". On 1,676 real ends of turn
// this flags 11, each a real "could not". A turn that ended on an error Claude Code wrote itself (the API, the login, the limit) is one too; "No response requested." is not.
const GAVE = /\b(?:I|we) (?:couldn't|could not|can't|cannot|wasn't able to|was unable to|am unable to|'m unable to|was not able to|failed to|did not manage|didn't manage)\b|\b(?:gave up|giving up|unable to (?:proceed|continue|complete))\b|je n'ai pas (?:pu|réussi)|\bimpossible de\b|\bje ne (?:peux|parviens|suis pas parvenu)|je n'arrive pas|\bno (?:pude|he podido|puedo|logré)\b|\bnão (?:consegui|posso|pude)\b|\bich (?:konnte|kann) (?:\S+ )?nicht\b/i;
// "I couldn't find any bugs", "I can't see a problem with it", "I can't reproduce it: it already works": a check that came out clean, not work left undone.
const CLEAN = /^\s+(?:(?:find|see|spot|detect|identify|trouver|voir|repérer|détecter|relever)\b[^.!?,;:]{0,30}?\b(?:bugs?|issues?|problems?|errors?|regressions?|mistakes?|flaws?|faults?|wrong|problèmes?|erreurs?|soucis|anomalies?|fautes?)\b|(?:reproduce|reproduire)\b[^.!?]{0,60}?\b(?:works|working|passes|already|fonctionne|marche|déjà|passent)\b)/i;
function gaveUp(text) {   // the first sentence when it says it could not, else ''
  const s = String(text || '').replace(/[’‘]/g, "'").replace(/^\s*#{1,6} ([^\n]*)\n+/, (h, t) => (GAVE.test(t) ? t + '. ' : '')).replace(/^[#>*\s]+/, '').replace(/\*\*/g, ''), m = s.match(/^[\s\S]{0,240}?[.!?:](?:\s|$)/), lead = (m ? m[0] : s.slice(0, 240)).trim(), all = new RegExp(GAVE.source, 'gi');
  for (let f; (f = all.exec(lead));) {   // each "could not" of the sentence: one that is a clean check does not count, the next one may
    if (CLEAN.test(s.slice(f.index + f[0].length, f.index + f[0].length + 200))) continue;   /* s, not lead: "I can't reproduce it: it already works" goes on after the colon (s and lead start at the same place) */
    if (/\b(?:but|though|however|mais|cependant|pero|mas|aber)\b|;/i.test(lead.slice(0, f.index))) return '';
    const rest = lead.slice(f.index + f[0].length), clear = /,\s*(?:but|however) (?:I|we) (?!(?:couldn't|could not|can't|cannot|didn't|did not|still)\b)|,\s*mais j'ai\b|,\s*pero (?:he|hemos)\b|\binstead\b(?! of)|\bà la place\b|,\s*so (?:I|we) (?:ran|used|switched|fell back|went with|worked around|tested|checked|verified|fixed|replaced|chose)\b|,\s*so (?:it|this|that|the \w+)(?:'s| is| are) (?:safe|done|complete|ready)\b/i;
    if (clear.test(rest) && !/\b(?:still|also fails?|fail(?:s|ed)?|doesn't|didn't|won't|couldn't|can't|cannot|not|only|untested|yourself|left|what I could|partly|partially)\b|, but (?!I |we )/i.test(rest)) return '';   /* the same sentence goes on to what was done instead ("I couldn't reproduce it, but I found the cause", "…, so I switched to https.get"); not "…, so I wrote 0 drafts", a workaround that failed too, or work handed back ("but the commit is ready: push it yourself") */
    return lead.replace(/\s+/g, ' ').replace(/\s*:$/, '');
  }
  return '';
}
const boardCache = new Map();   // file → { sig, parsed, title }
let boardMemo = { at: 0, rows: [] }, boardForced = 0;
const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;   // nothing else is given to the page as a link to open
const askOf = (b) => { const q = b.name === 'AskUserQuestion' && b.input && Array.isArray(b.input.questions) && b.input.questions[0] && b.input.questions[0].question; return typeof q === 'string' ? clip(q.trim(), 200) : ''; };   // the question a session stopped on, for its card
const callOf = (b) => { const i = b.input || {}, v = b.name === 'Bash' ? i.command : /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name) ? path.basename(String(i.file_path || i.notebook_path || '')) : b.name === 'WebFetch' ? i.url : ''; return typeof v === 'string' && v.trim() ? b.name + '(' + clip(v.replace(/\s+/g, ' ').trim(), 160) + ')' : ''; };   // what a call waiting for your go-ahead would do, written the way Claude Code shows it: Bash(npm test)
const PLAN_FILE = /[\\/]\.claude[\\/]plans[\\/][^\\/]+\.md$/, PLAN_DIR = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'plans') + path.sep : '';
const planFile = (f) => PLAN_FILE.test(f) || (!!PLAN_DIR && f.startsWith(PLAN_DIR) && f.endsWith('.md'));   // also where a CLAUDE_CONFIG_DIR set elsewhere keeps them
const planDoc = (f) => { try { const st = fs.statSync(f); if (!st.isFile() || st.size > 262144) return ''; return clip(fs.readFileSync(f, 'utf8').trim(), 4000); } catch { return ''; } };   // the whole plan, for the shared screen
const planText = (f) => { try { const st = fs.statSync(f); if (!st.isFile() || st.size > 262144) return ''; return clip(fs.readFileSync(f, 'utf8').trim(), 1200); } catch { return ''; } };
const menuOf = (b) => {   // what a menu waiting for you shows, from the call it waits on, word for word: the questions and their options in their order (the terminal numbers them the same way), the command, the file, the plan
  const i = b.input || {}, t = (x, n) => (typeof x === 'string' ? clip(x.trim(), n) : '');
  if (b.name === 'AskUserQuestion') return { kind: 'question', questions: (Array.isArray(i.questions) ? i.questions : []).slice(0, 4).map((q) => ({ q: t(q && q.question, 300), head: t(q && q.header, 30), multi: !!(q && q.multiSelect), options: (q && Array.isArray(q.options) ? q.options : []).slice(0, 8).map((o) => ({ label: t(o && o.label, 80), about: t(o && o.description, 140) })).filter((o) => o.label) })).filter((q) => q.q) };
  if (b.name === 'ExitPlanMode') return { kind: 'plan', text: t(i.plan, 1200) };
  if (b.name === 'Bash') return { kind: 'command', cmd: t(i.command, 600), about: t(i.description, 160) };
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name)) return { kind: 'edit', file: t(i.file_path || i.notebook_path, 300) };
  if (b.name === 'WebFetch') return { kind: 'fetch', url: t(i.url, 300) };
  return { kind: 'tool', tool: t(b.name, 80) };
};
// Claude Code also keeps <config>/sessions/<pid>.json for each open session: its status (busy, idle, or waiting while a menu waits for your answer: a permission, a question) and since when.
// It is the only sign of a Bash approval: in the transcript, a command waiting for your go-ahead looks just like one that runs. A file whose process has ended is left out.
const CC_SESSIONS = process.env.AGENT_STANDUP_CC_SESSIONS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'sessions');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function liveStatus() {   // session id → { status, since, pid, ep (where it runs: claude-vscode, cli, claude-desktop, sdk-cli…), and for missingTranscripts: raw (the status as written), cwd, kind, startedAt, version, updatedAt (when the file was last written: a /clear moves it, and the id, but not statusUpdatedAt) }
  const out = new Map(); let names = []; try { names = fs.readdirSync(CC_SESSIONS); } catch { return out; }
  for (const n of names) { if (!/^\d+\.json$/.test(n)) continue; try { const s = JSON.parse(fs.readFileSync(path.join(CC_SESSIONS, n), 'utf8')); if (s && typeof s.sessionId === 'string' && /^(busy|idle|waiting)$/.test(s.status) && Number.isInteger(s.pid) && s.pid > 0 && alive(s.pid)) out.set(s.sessionId, { status: s.status !== 'waiting' ? s.status : s.waitingFor === 'dialog open' ? 'idle' : s.entrypoint === 'sdk-cli' ? 'busy' : s.status, since: Number(s.statusUpdatedAt) || 0, pid: s.pid, ep: String(s.entrypoint || ''), raw: s.status, cwd: typeof s.cwd === 'string' ? s.cwd : '', kind: typeof s.kind === 'string' ? s.kind : '', startedAt: Number(s.startedAt) || 0, version: typeof s.version === 'string' ? s.version : '', updatedAt: Number(s.updatedAt) || 0 }); } catch {} }   /* a dialog you opened yourself (/model, /config, /mcp…) also says waiting: it is not a question for you. Nor is a menu of a session started with claude -p (entrypoint sdk-cli): its question goes to the program that started it. An Agent SDK host (sdk-ts, sdk-py: Zed, a home-made app) may show its menus to a person, so those are kept */
  return out;
}
// A Claude Code session that is open and has worked, yet whose transcript is nowhere in the projects folder read here. The call cannot show it; the page says so, and why it may be (issue #9). Read from the status files alone, nothing sent.
// Only one cause is visible this way (Claude Code 2.1.304, tried): CLAUDE_CODE_SKIP_PROMPT_HISTORY=1 writes the status file (interactive, idle/busy) and shows "Transcript saving is off", but no transcript.
// An inherited CLAUDE_CODE_CHILD_SESSION=1 writes neither, and another CLAUDE_CONFIG_DIR puts the status file in that other folder: neither leaves anything here. What is listed may also be a cause not known yet.
// Listed only once this server has seen the session busy, under its current id, for 5 s: a session just opened, one where you opened /model or /config, and one right after /clear
// (a new id and updatedAt, while status and statusUpdatedAt are still those of the id before) have written no transcript yet, and need none.
let missingMemo = { at: 0, list: [] }; const transcriptSeen = new Set(), busySeen = new Map();   // transcriptSeen: ids found once are not looked for again, a transcript stays where it was written · busySeen: id → when it was first seen busy (at most 500)
function missingTranscripts() {   // [{ id, cwd, name, version, ep, since }]: one look every 10 s at most
  if (process.env.AGENT_STANDUP_PROJECTS && !process.env.AGENT_STANDUP_CC_SESSIONS) return [];   // sessions read from another folder than the one these status files belong to: every live session would look as if it wrote nothing
  const now = Date.now(); if (now - missingMemo.at < 10e3) return missingMemo.list;
  const list = []; let dirs = null;
  for (const [id, w] of liveStatus()) {
    if ((w.kind && w.kind !== 'interactive') || /^sdk-(cli|ts|py)$/.test(w.ep) || transcriptSeen.has(id) || !/^[\w-]+$/.test(id)) continue;   // a session a program runs keeps no transcript a person would look for
    if (w.raw === 'busy' && w.since >= w.updatedAt && !busySeen.has(id)) { if (busySeen.size >= 500) busySeen.delete(busySeen.keys().next().value); busySeen.set(id, Math.min(now, w.since || now)); }   // a status written for this id (an older Claude Code writes no updatedAt: 0)
    if (!(now - (busySeen.get(id) || now) >= 5e3)) continue;   // Claude Code writes the transcript with the first message: never busy yet, or only just
    const name = id + '.jsonl', key = w.cwd.replace(/[^a-zA-Z0-9]/g, '-');   // Claude Code's project folder naming: the folder of its cwd, looked at first
    if ((key && mtimeOf(path.join(ROOT, key, name))) || coworkMap().has(id)) { transcriptSeen.add(id); continue; }
    if (!dirs) { dirs = []; try { dirs = fs.readdirSync(ROOT); } catch {} }   // a long path is shortened in its folder name: every folder, then
    if (dirs.some((d) => mtimeOf(path.join(ROOT, d, name)))) { transcriptSeen.add(id); continue; }
    list.push({ id, cwd: w.cwd, name: w.cwd ? path.basename(w.cwd) : '', version: w.version, ep: w.ep, since: w.startedAt || w.since });
  }
  missingMemo = { at: now, list }; return list;
}
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
// Answer in Claude Code: a click on what needs you goes where it can be answered. The session's process (its status file) leads to the editor window that runs it: each Agent Standup
// extension notes its window in <settings folder>/editors/<extension host pid>.json (its link scheme, its window number), and Claude Code's extension opens
// <scheme>://anthropic.claude-code/open?session=<id>&windowId=<n> in that window, which brings up the session's tab. Without that note: the editor among the session's parent processes (macOS),
// in whichever window was last used. A session in a terminal or in the Claude app (macOS): that app is brought to the front. Nothing leaves the computer: a local link or app is opened.
const editorsDir = () => path.join(path.dirname(PREFS), 'editors'), EDITOR_APPS = [[/Visual Studio Code - Insiders\.app|Code - Insiders\.app/, 'vscode-insiders'], [/Visual Studio Code\.app|\/Code\.app\//, 'vscode'], [/\/Cursor\.app\//, 'cursor'], [/\/Windsurf\.app\//, 'windsurf'], [/\/VSCodium\.app\//, 'vscodium']];
function noteEditor(info) {   // the extension, for its window: { scheme, windowId } (forgetEditor when the window closes)
  try {
    const d = editorsDir(); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, process.pid + '.json'), JSON.stringify({ pid: process.pid, ppid: process.ppid, scheme: String((info && info.scheme) || ''), windowId: String((info && info.windowId) || '') }));   // ppid: a note left by a crash is not taken for another process that gets its number
    for (const n of fs.readdirSync(d)) { const p = +n.replace(/\.json$/, ''); if (/^\d+\.json$/.test(n) && !alive(p)) try { fs.unlinkSync(path.join(d, n)); } catch {} }   // the notes of windows that closed without saying so
  } catch (e) { logError('editor note', e); }
}
function forgetEditor() { try { fs.unlinkSync(path.join(editorsDir(), process.pid + '.json')); } catch {} }
function procTree() {   // pid → { ppid, cmd }: one look at every process (macOS and Linux; nothing on Windows)
  const m = new Map(); if (process.platform === 'win32') return m;
  try { for (const l of execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 3000, maxBuffer: 16 << 20 }).split('\n')) { const x = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l); if (x) m.set(+x[1], { ppid: +x[2], cmd: x[3] }); } } catch {}
  return m;
}
function openLocal(args) {   // a link or an app, opened as a click on it would be (AGENT_STANDUP_ANSWER=dry: said, not opened, for the tests)
  if (process.env.AGENT_STANDUP_ANSWER === 'dry') return;
  const [cmd, a] = process.platform === 'darwin' ? ['open', args] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', args[args.length - 1]]] : ['xdg-open', [args[args.length - 1]]];
  try { spawn(cmd, a, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch {}
}
function answerIn(id, opts = {}) {   // { how: 'editor' | 'app' | '', app, link }: where the session that waits can be answered, opened. opts.here(id): the extension, for a session of its own window (no link, and no prompt from the editor)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) return { how: '' };
  const w = liveStatus().get(String(id)); if (!w || !w.pid || !/^(claude-vscode|cli|claude-desktop)$/.test(w.ep)) return { how: '' };   // a session a program runs (sdk-…) has no one to answer it there
  const tree = procTree(), up = []; for (let p = w.pid, i = 0; p > 1 && i < 20 && tree.has(p); i++) { up.push(p); p = tree.get(p).ppid; }
  const link = (scheme, win) => `${scheme}://anthropic.claude-code/open?session=${String(id).toLowerCase()}${win ? '&windowId=' + win : ''}`;
  if (w.ep === 'claude-vscode') {
    for (const p of up) {   // the window that runs it: its extension host is one of its parents
      let e = null; try { e = JSON.parse(fs.readFileSync(path.join(editorsDir(), p + '.json'), 'utf8')); } catch {} if (!e || e.ppid !== tree.get(p).ppid) continue;
      if (e.pid === process.pid && typeof opts.here === 'function') { try { opts.here(String(id).toLowerCase()); } catch {} return { how: 'editor', here: 1 }; }
      if (/^[a-z][a-z0-9+.-]{1,30}$/.test(e.scheme) && /^\d{1,9}$/.test(String(e.windowId))) { const l = link(e.scheme, e.windowId); openLocal([l]); return { how: 'editor', link: l }; }
    }
    for (const p of up) for (const [re, scheme] of EDITOR_APPS) if (re.test(tree.get(p).cmd)) {   // no note: the link goes to the editor's last used window, so only when it has one (one extension host); else the editor comes to the front, and its tab is yours to pick
      const host = tree.get(p).cmd, hosts = [...tree.values()].filter((x) => x.cmd === host && (tree.get(x.ppid) || {}).cmd !== host).length;   // an extension host per window, started by the app itself (language servers and the like are its children)
      if (hosts === 1 && /Helper \(Plugin\)/.test(host)) { const l = link(scheme, ''); openLocal([l]); return { how: 'editor', link: l }; }
      break;
    }
  }
  if (process.platform === 'darwin' && up.some((p) => /\/iTermServer/.test(tree.get(p).cmd))) { openLocal(['-b', 'com.googlecode.iterm2']); return { how: 'app', app: 'iTerm' }; }   // iTerm2 runs its shells under a server of its own, not under the app
  if (process.platform === 'darwin') for (const p of up.slice().reverse()) { const m = /^(\/.+?\.app)\//.exec(tree.get(p).cmd); if (m) { openLocal(['-a', m[1]]); return { how: 'app', app: path.basename(m[1], '.app') }; } }   // the outermost app: Terminal, iTerm, Claude…
  return { how: '' };
}
// Does this session's Claude Code write a status in ~/.claude/sessions (the terminal since 2.1.221; the VS Code panel, the desktop app's Code tab and the Agent SDK since 2.1.269; Cowork keeps its own elsewhere)?
// Where it does, no status means its process has ended: a question left open there was given up, not asked.
const verAtLeast = (v, min) => { const x = String(v || '').split('.').map((n) => parseInt(n, 10) || 0); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== min[i]) return (x[i] || 0) > min[i]; return true; };
const statusWritten = (proj, p) => proj !== COWORK && !!p.ver && p.ep !== 'local-agent' && verAtLeast(p.ver, p.ep === 'cli' ? [2, 1, 221] : [2, 1, 269]);
// The error Claude Code writes as the last message when it cannot go on: your plan's usage limit ("You've hit your limit · resets 7:20pm (Europe/Paris)"; before, "Claude AI usage limit reached|<epoch>",
// "5-hour limit reached ∙ resets 3pm"…) or a login that is gone ("Not logged in · Please run /login", "Failed to authenticate: OAuth session expired…", "Invalid API key"). Said as what it is, not as "gave up".
const LIMIT_ERR = /hit your (?:[\w-]+ )?limit|\b(?:usage|5-hour|weekly|daily|monthly|session|spend(?:ing)?) (?:[\w-]+ )?limit (?:reached|exceeded)|limit will reset/i, NOT_LIMIT = /context|not your usage limit|temporarily limiting/i;
const AUTH_ERR = /not logged in|please run \/login|oauth (?:token|session) (?:has )?expired|failed to authenticate|invalid api key|authentication_error/i;
function errKind(text, code) {   // { limit: { resets } } | { auth: 1 } | null; code: the error field of the record (authentication_failed…), which older versions do not write
  if (code === 'authentication_failed') return { auth: 1 };
  if (!LIMIT_ERR.test(text) || NOT_LIMIT.test(text)) return AUTH_ERR.test(text) ? { auth: 1 } : null;   // a limit first: its text may offer /login to switch accounts
  const at = /limit reached\|(\d{9,11})\b/i.exec(text), m = /\breset(?:s)?(?: at)?\s+([^\n·∙|]+)/i.exec(text);
  let resets = m ? m[1].trim().replace(/\.$/, '').slice(0, 80) : ''; if (!resets && at) { const d = new Date(+at[1] * 1000); resets = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }   // the oldest form gives the time as a number: said in this computer's hours
  return { limit: { resets } };
}
function parseTail(file, st) {
  const sig = st.mtimeMs + ':' + st.size, hit = boardCache.get(file); if (hit && hit.sig === sig) return hit;
  const { lines, cut } = boardTail(file);
  const pend = new Map(), bg = new Map(), runs = new Map(); let ver = '', ep = '', idle = false, lastType = null, lastTool = false, lastStop = null, stops = false, esc = false, lastTs = 0, stamp = 0, bare = false, custom = (hit && hit.custom) || null, ai = (hit && hit.ai) || null, first = hit ? hit.first : undefined, pr = (hit && hit.pr) || null, asked = (hit && hit.asked) || 0, plan = (hit && hit.plan) || null, say = '', err = '', errK = null;   // say: the first text since the last call or message of yours, the start of what closes the turn; err: an error that closed it, errK: what kind (errKind)
  for (const l of lines) try {   // one odd record costs that record, not the whole card
    if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    const a = typedAt(r); if (a > asked) asked = a; if (a && r.type === 'user') pend.clear(); if (typeof r.version === 'string') ver = r.version; if (typeof r.entrypoint === 'string') ep = r.entrypoint;   /* which Claude Code, and where: does it write a status that says a menu is open (statusWritten) */   /* an order of yours: a call still without its answer was given up (a menu you passed over by typing, a session closed mid-call), it waits on nothing any more */
    if (r.type === 'custom-title' && typeof r.customTitle === 'string') custom = r.customTitle; else if (r.type === 'ai-title' && typeof r.aiTitle === 'string') ai = r.aiTitle;   // a session is renamed, or named, long after its row was first shown: the latest one read wins
    if (r.type === 'pr-link' && PR_URL.test(r.prUrl)) pr = { n: +r.prUrl.slice(r.prUrl.lastIndexOf('/') + 1), url: r.prUrl };   // the pull request Claude Code noted for the session: the latest one, shown on its card
    const t = Date.parse(r.timestamp) || 0, bl = blocks(r); if (t) { stamp = t; bare = false; } else bare = true;   // bare: only records without a time since the last one that has one (last-prompt, ai-title, mode, cost-state…), which Claude Code also writes when its tab is closed: no one moved there
    if (r.type === 'system' && r.subtype === 'compact_boundary') idle = /^idle/.test(String((r.compactMetadata && r.compactMetadata.trigger) || ''));   // Claude Code 2.1.299 compacts a large session left idle for about 54 minutes: nobody moved there
    if (r.isCompactSummary) continue;   // the summary of a compaction is not a message: the turn stands as it was
    if (r.type === 'assistant' || r.type === 'user') { idle = false; lastType = r.type; lastTool = bl.some((b) => b.type === 'tool_use'); lastStop = (r.type === 'assistant' && r.message && r.message.stop_reason) || null; if (lastStop) stops = true; if (t) lastTs = t;
      esc = r.type === 'user' && bl.some((b) => b.type === 'text' && /^\s*\[Request interrupted/i.test(b.text || '')); if (esc) pend.clear(); }   // Esc: the turn stops there, and no call is waited for any more
    if (r.type === 'user' || (r.type === 'assistant' && lastTool)) { say = ''; err = ''; errK = null; }
    else if (r.type === 'assistant' && !r.isSidechain) { const tx = bl.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim(), m = r.message || {}; err = (r.isApiErrorMessage || m.model === '<synthetic>') && tx && !/^No response requested/i.test(tx) ? tx : ''; errK = err ? errKind(err, r.error) : null; if (tx && !say) say = tx; }
    for (const b of bl) if (b.type === 'tool_use' && /^(Write|Edit|MultiEdit)$/.test(b.name) && b.input && planFile(String(b.input.file_path || ''))) plan = { file: String(b.input.file_path), ts: t };   // the plan, written in its own file before it is shown for approval
    for (const b of bl) { if (b.type === 'tool_use') pend.set(b.id, { id: String(b.id || ''), name: b.name, ts: t, q: askOf(b), c: callOf(b), m: menuOf(b) }); else if (b.type === 'tool_result') pend.delete(b.tool_use_id); }
    if (r.type === 'user' && !r.isSidechain) for (const b of bl) {   // the sub-agents the lead launched in the background, until the news that each one ended (Claude Code 2.1.302 runs them all in the background in VS Code and the desktop app)
      if (b.type === 'tool_result') { const rt = resultText(b.content), m = /^\s*Async agent launched[\s\S]*?agentId: ?([\w-]+)/i.exec(rt), wf = !m && /^\s*Workflow launched in background\.\s*Task ID: ?([\w-]+)/i.exec(rt); if (m) bg.set(m[1], t);
        else if (wf) { bg.set(wf[1], t); const run = /\bRun ID: ?([\w-]+)/.exec(rt) || /[\\/]subagents[\\/]workflows[\\/]([\w-]+)/.exec(rt); if (run) runs.set(wf[1], run[1]); } }   // a workflow too, until the news of its task id; its agents write in subagents/workflows/<run id>
      else if (b.type === 'text') for (const m of String(b.text || '').matchAll(/<task-notification>[\s\S]*?<task-id>([\w-]+)<\/task-id>/g)) bg.delete(m[1]);
    }
    const queued = r.isSidechain ? '' : r.type === 'attachment' && r.attachment && r.attachment.type === 'queued_command' && typeof r.attachment.prompt === 'string' ? r.attachment.prompt : r.type === 'queue-operation' && r.operation === 'enqueue' && typeof r.content === 'string' ? r.content : '';
    for (const m of queued.matchAll(/<task-notification>[\s\S]*?<task-id>([\w-]+)<\/task-id>/g)) bg.delete(m[1]);   // before Claude Code 2.1.302 the news that a background agent ended is often only queued (and handed over inside the next order): it has ended all the same
  } catch {}
  if (!hit && !custom) {   // first look at this file: a little further back than the lines read above, and without needing whole lines
    const big = readTail(file, 256 * 1024).text, un = (m) => { try { return m ? JSON.parse('"' + m[1] + '"') : null; } catch { return null; } };
    custom = un([...big.matchAll(/"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/g)].pop()); if (!ai) ai = un([...big.matchAll(/"type":"ai-title","aiTitle":"((?:[^"\\]|\\.)*)"/g)].pop());
  }
  if (!custom && !ai && first == null) first = firstPrompt(file) || (st.size > 64 * 1024 ? '' : null);   // '' = looked for and not there; a file that has just been created is looked at again
  if (!hit && !asked && cut) asked = typedBefore(file);
  const out = { sig, title: custom || ai || first || null, custom, ai, first, pr, lastType, lastTool, lastStop, stops, esc, lastTs, pending: [...pend.values()], ...(lastType === 'assistant' && errK ? errK : lastType === 'assistant' && (err || gaveUp(say)) ? { gave: (err || gaveUp(say)).replace(/\s+/g, ' ').slice(0, 240) } : {}) };   // limit, auth: it stopped on your usage limit, or a login that is gone, not of its own accord   // a title the person typed wins over the generated one, and both over the first prompt
  out.ver = ver || (hit && hit.ver) || ''; out.ep = ep || (hit && hit.ep) || ''; out.asked = asked; out.plan = plan; out.bg = [...bg].filter(([, ts]) => ts >= asked).map(([k, ts]) => (runs.has(k) ? [k, ts, runs.get(k)] : [k, ts])); if (idle && lastTs) out.quiet = lastTs; else if (bare && stamp) out.quiet = stamp; boardCache.set(file, out); if (boardCache.size > 3 * ROWS_MAX) boardCache.delete(boardCache.keys().next().value); return out;   // more than the list can hold: a full list never pushes its own rows out, which read every row again at each scan
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
// How many sessions the list keeps, newest first, of each kind (Claude Code, each other tool, Cowork): `most` of them, and whatever the count, the PER_FOLDER newest of each folder, so that
// sessions written elsewhere never push the ones of a folder out. That is what happened with only a count: the Claude Code session of the folder the call follows left the list, and with it its
// tab and the call, behind 40 sessions a desktop app had just written in temporary folders (issue #9). Sessions started in a temporary folder (see tmpKey) have places of their own, TMP_ROWS at most.
const PER_FOLDER = 3, TMP_ROWS = 10, ROWS_MAX = 200;   // ROWS_MAX: a ceiling on what the folders add, for someone with hundreds of folders (one worktree per task)
function capRows(list, most, folderOf) {   // list: newest first
  const real = list.filter((r) => !tmpKey(folderOf(r))), keep = new Set(real.slice(0, most)), per = new Map();
  for (const r of real) { if (keep.size >= ROWS_MAX) break; const k = folderOf(r), n = per.get(k) || 0; if (n < PER_FOLDER) { keep.add(r); per.set(k, n + 1); } }
  return real.filter((r) => keep.has(r)).concat(list.filter((r) => tmpKey(folderOf(r))).slice(0, TMP_ROWS));
}
function bgAtWork(proj, id, bg, now) {   // bg: [agent id, launched at] or [workflow task id, launched at, run id]. Still at work: not marked finished in its meta file (Claude Code 2.1.302 on) and written to, or launched, in the last 30 minutes
  for (const [aid, ts, run] of bg || []) {
    if (!/^[\w-]+$/.test(aid)) continue;
    if (run) {   // a workflow: done once Claude Code writes its record in <session>/workflows/<run>.json (it does at the end); at work while one of its agents wrote in the last 30 minutes
      if (!/^[\w-]+$/.test(run)) continue; const d = path.join(projDir(proj, id), id), wd = path.join(d, 'subagents', 'workflows', run); let last = 0; const w = readMeta(path.join(d, 'workflows', run + '.json')), done = !!w && typeof w === 'object' && Object.keys(w).length > 0 && !/^(running|pending)$/.test(String(w.status));   // readMeta: read again only when the file changes
      if (!done) { try { for (const f of fs.readdirSync(wd)) if (f.endsWith('.jsonl')) last = Math.max(last, mtimeOf(path.join(wd, f))); } catch {} if (now - Math.max(last, ts || 0) < 30 * 60e3) return true; }
      continue;
    } const f = path.join(projDir(proj, id), id, 'subagents', 'agent-' + aid);
    const done = (readMeta(f + '.meta.json') || {}).finished === true;
    if (!done && now - Math.max(mtimeOf(f + '.jsonl'), ts || 0) < 30 * 60e3) return true;
  }
  return false;
}
function boardRows0() {
  const now = Date.now(), rows = [], live = liveStatus();
  for (const m of SOURCES) for (const r of guard(() => m.sessions(), [])) if (now - r.mtime < 12 * 3600e3) rows.push({ proj: m.PROJ, id: r.id, st: { mtimeMs: r.mtime, size: r.size }, cx: r, src: m });
  for (const proj of projects()) {
    for (const { id, file } of transcripts(proj)) { try { const st = fs.statSync(file); if (now - st.mtimeMs < 12 * 3600e3) rows.push({ proj, id, st }); } catch {} }
  }
  rows.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  const own = (r) => r.proj, folder = (r) => String(r.cx.key || r.cx.dir || '');   // a Claude Code session is listed under its folder; a Codex or Vibe one says which folder it was started in
  return capRows(rows.filter((r) => !r.cx && r.proj !== COWORK), 40, own).concat(...SOURCES.map((m) => capRows(rows.filter((r) => r.src === m), 20, folder)), rows.filter((r) => r.proj === COWORK).slice(0, 20)).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs).map(({ proj, id, st, cx, src }) => {
    if (cx) { const r = guard(() => src.boardRow(cx, now), null); if (r && tmpKey(r.dir)) r.tmp = 1; return r; }   // tmp: started in the temporary folder (see tmpKey)
    const file = path.join(projDir(proj, id), id + '.jsonl'); let p; try { p = parseTail(file, st); } catch { p = { pending: [] }; }
    const moved = p.quiet || st.mtimeMs, age = now - moved, pend = p.pending || [], w = live.get(id), lp = (w && w.status === 'waiting' && pend.find((c) => !SUBTOOL.test(c.name))) || pend[pend.length - 1]; let state = 'idle', tool = '', ageMs = age, since = 0, open = null, maybe = 0, asks = 0;   // lp: with a menu open and several calls waiting, Claude Code asks about the first of them
    if (w && w.status === 'waiting' && lp) { state = 'blocked'; tool = lp.name; since = w.since || lp.ts || st.mtimeMs; ageMs = now - since; }   // a menu is open in the session and a call waits on it: it needs you now, however long ago it was written
    else if (w && w.status === 'waiting') { state = 'blocked'; since = w.since || st.mtimeMs; ageMs = now - since; const pt = p.plan && p.plan.ts > (p.asked || 0) ? planText(p.plan.file) : ''; open = { id: 'w' + since, tool: pt ? 'ExitPlanMode' : '', ...(pt ? { kind: 'plan', text: pt } : { kind: 'menu' }), sure: 1 }; }   // a menu is open and the transcript has no call waiting on it: the plan to approve (Claude Code writes that call only once it is answered, the plan itself is in its file, written this turn), or a menu it does not record
    else if (age < 30 * 60e3) {
      if (lp) { ageMs = now - (lp.ts || st.mtimeMs); tool = lp.name;
        state = SUBTOOL.test(lp.name) ? 'waiting' : 'working'; if (!w && ASKS.test(lp.name) && ageMs > 4000 && !statusWritten(proj, p)) { state = 'blocked'; asks = 1; since = lp.ts || st.mtimeMs; } else if (!w && ((APPROVAL.test(lp.name) && ageMs > 15000) || (ASKS.test(lp.name) && ageMs > 4000))) { maybe = 1; since = lp.ts || st.mtimeMs; } }   // asks: no status (Cowork, Claude Code before 2.1.269), but a question or a plan open in the transcript is one: it needs you   // maybe: only a guess from how long a call has waited, for a session whose status Claude Code does not write (Cowork, before 2.1.2xx): shown on its tile, never as "needs you" (no visitor, no red, no notification). A status that says busy or idle is believed: the panel in VS Code also says "waiting" while it asks
      else if (p.esc) state = 'turn';   // you stopped it (Esc): it is your turn there, not "working" for the next ten minutes
      else if (p.lastType === 'assistant' && !p.lastTool && p.lastStop !== 'tool_use' && !(p.lastStop == null && p.stops && age < 45000)) state = !p.gave && !p.limit && !p.auth && bgAtWork(proj, id, p.bg, now) ? 'waiting' : 'turn';   // a line whose message goes on with a tool call is not the end of the turn: the call is written after it, a long one many seconds after.
      // A lead that ends its turn on "the agents are running, I'll wait" is not waiting for you: it goes on when they report (a sub-agent launched in the background, and not since an order of yours)
      // Claude Code up to 2.1.87 writes that line without saying why it stopped: in a transcript that does say it elsewhere, such a line is given 45 s for its call to come (1 in 100 takes longer than 25 s)
      else state = age < 10 * 60e3 ? 'working' : 'idle';
      if (state === 'turn') since = p.lastTs || st.mtimeMs;
    }
    else if (p.bg && p.bg.length && p.lastType === 'assistant' && !p.lastTool && !p.gave && !p.limit && !p.auth && bgAtWork(proj, id, p.bg, now)) state = 'waiting';   // a lead quiet for more than 30 minutes while what it launched in the background still works (a long workflow): waiting on it, not idle
    let subActive = 0, subTotal = 0;
    for (const x of subFiles(proj, id)) { subTotal++; if (now - mtimeOf(x.file) < 90e3) subActive++; }
    const ran = since && p.asked && p.asked < since ? since - p.asked : 0, ask = (state === 'blocked' || maybe) && lp ? lp.q || lp.c : '';   // since: when it started to wait on you; ran: how long it worked, from your last order to then
    return { proj, id, title: coworkTitle(proj, id) || p.title || id, mtime: moved, state, tool, ageMs, subActive, subTotal, asked: p.asked || 0, ...(since ? { since } : {}), ...(ran ? { ran } : {}), ...(p.pr ? { pr: p.pr } : {}), ...(ask ? { ask } : {}), ...(state === 'blocked' && ((w && w.status === 'waiting') || asks) ? { sure: 1 } : {}), ...(maybe ? { maybe } : {}), ...(w ? { known: 1 } : {}), ...(open ? { menu: open } : (state === 'blocked' || maybe) && lp && lp.m && !SUBTOOL.test(lp.name) ? { menu: { id: lp.id, tool: lp.name, ...lp.m, ...((w && w.status === 'waiting') || asks ? { sure: 1 } : {}) } } : {}), ...(state === 'turn' && p.gave ? { gave: p.gave } : {}), ...(state === 'turn' && p.limit ? { limit: p.limit } : {}), ...(state === 'turn' && p.auth ? { auth: 1 } : {}), ...(p.esc ? { cut: 1 } : {}), ...(tmpKey(proj) ? { tmp: 1 } : {}) };   // cut: stopped by you, which is no news to tell you
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
// Where this server runs, for ⚙ › Rate in the page: the editor (it sets AGENT_STANDUP_RATE to the review page of the store it installs from), the desktop app or the command line
// (a star on GitHub: they have no store). Only the desktop app and the command line ask on their own, on the third day: the extension asks in its own way (extension.js, noteUse).
const RATE_STORES = /^https:\/\/(marketplace\.visualstudio\.com|open-vsx\.org)\//, GITHUB_REPO = 'https://github.com/Atoll92/agent-standup';
function appKind() {
  const h = String(process.env.AGENT_STANDUP_HOST || ''), rate = String(process.env.AGENT_STANDUP_RATE || ''), lead = String(process.env.AGENT_STANDUP_LEAD_NAME || '').trim().slice(0, 100);
  const kind = h === 'desktop app' ? 'desktop' : h === 'command line' ? 'cli' : h === 'claude code plugin' ? 'plugin' : h ? 'editor' : '';
  return { kind, rate: kind === 'editor' && RATE_STORES.test(rate) ? rate : GITHUB_REPO, track: !noTrack(), updates: !noUpdate(), ...(lead ? { lead } : {}) };   // track: false when DO_NOT_TRACK is set, and the page does not ask about usage. lead: the lead's name set in the editor (agentStandup.leadName), which the page cleans and prefers to its own setting
}
// Usage, counted only for those who said yes, in the desktop app, the command line and the Claude Code plugin (the editor counts itself: extension.js, pingWeek). The page asks once
// (prefs.shareUsage, which this server reads again in the settings file before it sends anything); when the call is opened it asks this server, which sends at most one empty request a week (weeks from Monday, UTC) for the 1-pixel file of its kind in the "stats"
// release on GitHub: the requests of a week are the people who opened the call that week from there. Nothing is sent in a request: no id, no path, no content. Never with DO_NOT_TRACK set.
// A file per week beside the settings (sent-<kind>-week-<monday>) makes several servers and pages send it once. AGENT_STANDUP_PING_BASE: where the tests receive it.
const USAGE_PIXELS = { desktop: 'desktop-week.gif', cli: 'cli-week.gif', plugin: 'plugin-week.gif' };
const noTrack = () => /^(1|true|yes)$/i.test(String(process.env.DO_NOT_TRACK || '').trim());
const mondayOf = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
function usageWeek(now = new Date()) {
  const kind = appKind().kind, name = USAGE_PIXELS[kind]; if (!name || noTrack() || (readPrefs() || {}).shareUsage !== true) return { sent: false };   // the answer is read here too, from the settings file: the page asking is not enough
  const week = mondayOf(now), dir = path.dirname(PREFS), mine = 'sent-' + kind + '-week-' + week;
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (f.startsWith('sent-' + kind + '-week-') && f !== mine) try { fs.unlinkSync(path.join(dir, f)); } catch {}
    fs.closeSync(fs.openSync(path.join(dir, mine), 'wx'));
  } catch (e) { if (!(e && e.code === 'EEXIST')) logError('usage', e); return { sent: false, week }; }
  try {
    const u = new URL(name, process.env.AGENT_STANDUP_PING_BASE || 'https://github.com/Atoll92/agent-standup/releases/download/stats/');
    const r = require(u.protocol === 'http:' ? 'http' : 'https').get(u, { headers: { 'user-agent': 'agent-standup' }, timeout: 5000 }, (m) => { m.resume(); m.destroy(); });
    r.on('error', () => {}); r.on('timeout', () => r.destroy());
  } catch (e) { logError('usage', e); }
  return { sent: true, week };
}
// A newer version, told in the desktop app, the command line and the Claude Code plugin (the editor updates itself from its store). At most once a day, this server asks the npm registry which
// version is the latest: one request for the package's small manifest, with nothing about you or your sessions in it (the registry sees your IP address, as when npx starts the app). The answer is
// kept beside the settings (update-check.json), so every server and page share one request a day; after a failure it tries again an hour later. The page shows it once per version, by the menu,
// with the step that updates this app (index.html, updTip); the command line prints it when it starts. Off until the person says yes: the page asks once (prefs.updateNotice, read here
// from the settings file, as for usage; ⚙ › All settings turns it on or off). Never with DO_NOT_TRACK or NO_UPDATE_NOTIFIER set. AGENT_STANDUP_UPDATE_URL: where the tests answer.
const UPDATE_KINDS = ['desktop', 'cli', 'plugin'], UPDATE_FILE = path.join(path.dirname(PREFS), 'update-check.json'), VER_RE = /^\d{1,4}\.\d{1,5}\.\d{1,6}$/;
const noUpdate = () => noTrack() || /^(1|true|yes)$/i.test(String(process.env.NO_UPDATE_NOTIFIER || '').trim());
const verParts = (v) => String(v || '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
const newerThan = (a, b) => { const x = verParts(a), y = verParts(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
function updateHow(kind) {   // the step that updates this app: the desktop app is downloaded again, the plugin is updated by Claude Code, the command line by npx (it runs from npx's cache, a folder named _npx) or npm
  if (kind === 'desktop') return { how: 'download', url: GITHUB_REPO + '/releases/latest' };
  if (kind === 'plugin') return { how: 'plugin', cmd: 'claude plugin marketplace update double-geste && claude plugin update agent-standup@double-geste' };
  return __dirname.split(path.sep).includes('_npx') ? { how: 'npx', cmd: 'npx @double_geste/agent-standup@latest --open' } : { how: 'npm', cmd: 'npm i -g @double_geste/agent-standup@latest' };
}
function latestFromNpm() {   // the version npm calls latest, or '' (offline, an error, anything unexpected)
  return new Promise((done) => {
    try {
      const u = new URL(process.env.AGENT_STANDUP_UPDATE_URL || 'https://registry.npmjs.org/@double_geste/agent-standup/latest');
      const r = require(u.protocol === 'http:' ? 'http' : 'https').get(u, { headers: { 'user-agent': 'agent-standup', accept: 'application/json' }, timeout: 5000 }, (m) => {
        let b = ''; m.setEncoding('utf8'); m.on('data', (d) => { b += d; if (b.length > 65536) m.destroy(); }); m.on('error', () => done('')); m.on('close', () => done(''));
        m.on('end', () => { try { const v = m.statusCode === 200 ? String(JSON.parse(b).version || '') : ''; done(VER_RE.test(v) ? v : ''); } catch { done(''); } });
      });
      r.on('error', () => done('')); r.on('timeout', () => r.destroy());
    } catch (e) { logError('update', e); done(''); }
  });
}
let updateAsking = null;
function updateInfo() {   // what /api/update and the command line tell: { on, current, latest, newer, notes, how, cmd or url }
  const kind = appKind().kind, off = { on: false, current: VERSION };
  if (!UPDATE_KINDS.includes(kind) || noUpdate() || (readPrefs() || {}).updateNotice !== true) return Promise.resolve(off);   // the answer is read here, from the settings file: the page asking is not enough
  const tell = (latest) => (latest ? { on: true, current: VERSION, latest, newer: newerThan(latest, VERSION), notes: `${GITHUB_REPO}/releases/tag/v${latest}`, ...updateHow(kind) } : { ...off, on: true });
  let c = null; try { c = JSON.parse(fs.readFileSync(UPDATE_FILE, 'utf8')); } catch {}
  const known = c && typeof c.latest === 'string' && VER_RE.test(c.latest) ? c.latest : '', at = (c && +c.t) || 0, now = Date.now();
  if (at <= now && now - at < (c && c.failed ? 3600e3 : 864e5)) return Promise.resolve(tell(known));
  if (!updateAsking) updateAsking = latestFromNpm().then((v) => {
    try { fs.mkdirSync(path.dirname(UPDATE_FILE), { recursive: true }); fs.writeFileSync(UPDATE_FILE, JSON.stringify(v ? { t: Date.now(), latest: v } : { t: Date.now(), latest: known, failed: true })); } catch (e) { logError('update', e); }
    return v || known;
  }).finally(() => { updateAsking = null; });
  return updateAsking.then(tell);
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
const MENU_LIVE_MS = 30 * 60e3;   // a menu left open longer still needs you (board, visitor), but no longer takes the call from where you work
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
// A project of Claude Code is named after its folder with every character other than a letter or digit made a dash: -Users-a-app-old may be app/old (inside app) or app-old (beside it).
// Which one is told by the folder its sessions were started in (the cwd of its first records), read once per project. Not found (an empty project): counted as before, by its name.
const projCwds = new Map(), dirKey = (d) => String(d || '').replace(/[^a-zA-Z0-9]/g, '-');
const foldKey = (k) => (process.platform === 'win32' ? String(k).toLowerCase() : k);   // Windows: a folder is the same whatever its case (the editor sends C:, Claude Code may have written c:)
function projCwd(proj) {
  if (projCwds.has(proj)) return projCwds.get(proj);
  let cwd = ''; for (const { id } of transcripts(proj).slice(0, 3)) { try { const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(readHead(path.join(projDir(proj, id), id + '.jsonl'), 64 * 1024)); if (m) { cwd = JSON.parse('"' + m[1] + '"'); break; } } catch {} }
  const sure = !!cwd && foldKey(dirKey(cwd)) === foldKey(proj); if (sure) projCwds.set(proj, cwd); return sure ? cwd : '';   // kept once it is sure: the folder whose name is the project's
}
const inFolder = (proj, key) => { const p = foldKey(proj), k = foldKey(key); if (p === k) return true; if (!p.startsWith(k + '-')) return false; const cwd = projCwd(proj); if (!cwd) return true; for (let d = cwd; d;) { if (foldKey(dirKey(d)) === k) return true; const up = path.dirname(d); if (up === d) return false; d = up; } return false; };
function currentSession(projFilter, pick, stick, anyTmp) {   // pick: { proj, id, since } the session you went to by hand, and the latest order there was then · stick: the session the call is in · anyTmp: sessions in the temporary folder count too (see tmpKey)
  const safe = (x) => typeof x === 'string' && /^[\w.\-]+$/.test(x) && x !== '..', now = Date.now();
  const keys = process.platform === 'win32' && /^[a-zA-Z]-/.test(projFilter || '') ? [projFilter, (projFilter[0] === projFilter[0].toLowerCase() ? projFilter[0].toUpperCase() : projFilter[0].toLowerCase()) + projFilter.slice(1)] : [projFilter];   // Windows: a Codex or Vibe session's folder, with its drive letter in either case
  const there = (c) => !!c && safe(c.id) && safe(c.proj) && (sourceOf(c.proj) ? !!guard(() => sourceOf(c.proj).fileOf(c.id), null) : fs.existsSync(path.join(projDir(c.proj, c.id), c.id + '.jsonl')));
  const inScope = (c) => (!projFilter ? anyTmp || !tmpSession(c.proj, c.id) : inFolder(c.proj, projFilter) || !!(sourceOf(c.proj) && guard(() => keys.some((k) => sourceOf(c.proj).inProject(c.id, k)), false)));   // a Codex or Vibe session counts for a project when it was started in that folder
  const same = (a, b) => !!a && !!b && a.proj === b.proj && a.id === b.id; let all = boardRows();
  if (there(pick) && !all.some((r) => same(r, pick)) && now - boardForced > 5000 && sessionMtime(pick.proj, pick.id) > boardMemo.at - 1500) { boardForced = now; boardMemo.at = 0; all = boardRows(); }   // boardForced: at most every 5 s, for a session written to that the list never holds (older than 12 h, past the places of its kind)   // the session you went to was written after the list shared for 1.2 s was made: without it, its order read as none, and the next answer dropped your pick
  const rows = all.filter(inScope), mine = there(pick) ? all.find((r) => same(r, pick)) : null;
  const asked = Math.max(0, (mine && mine.asked) || 0, ...rows.map((r) => r.asked || 0));   // the latest order, in the folder the call follows or in the session you went to
  const moved = pick && pick.pin ? Math.max(0, ...rows.filter((r) => !same(r, pick)).map((r) => r.asked || 0)) : asked;   // pick.pin: a call pinned by a click on its tab (📌) is left for an order typed in another session only; what you type in it keeps it there
  if (there(pick) && !(moved > pick.since)) return { proj: pick.proj, id: pick.id, mtime: now, asked, pick: 1, why: pick.pin ? 'pin' : 'pick' };   // no "since" on the first question after a pick: the answer gives it (asked), and the page sends it back from then on
  const live = rows.filter((r) => /^(working|waiting)$/.test(r.state) || (r.state === 'blocked' && !(now - (r.since || now) > MENU_LIVE_MS)) || r.subActive > 0 || now - r.mtime < STICK_MS), last = Math.max(0, ...live.map((r) => r.asked || 0)), top = live.filter((r) => (r.asked || 0) === last);
  const to = top.find((r) => same(r, stick)) || top.sort((a, b) => b.mtime - a.mtime)[0];   // two sessions whose last order is not known (or of the same instant): the call stays where it is
  if (to) return { proj: to.proj, id: to.id, mtime: to.mtime, asked, why: last ? 'typed' : 'busy' };   // why: shown by the page, in the row of tabs
  if (there(stick) && inScope(stick)) return { proj: stick.proj, id: stick.id, mtime: sessionMtime(stick.proj, stick.id), asked, why: 'stay' };   // nobody is at work: the call stays where it is
  let best = null;
  const consider = (proj, id, m) => { if (!best || m > best.mtime) best = { proj, id, mtime: m }; };
  for (const m of SOURCES) for (const r of guard(() => m.sessions(), [])) if (inScope({ proj: m.PROJ, id: r.id })) consider(m.PROJ, r.id, r.mtime);
  for (const proj of projects()) {
    if (projFilter ? !inFolder(proj, projFilter) : !anyTmp && tmpKey(proj)) continue;   // the folder itself, or a folder inside it (a Cowork session is in no folder of yours: it counts when the call looks everywhere, or at Cowork)
    for (const { id } of transcripts(proj)) { const m = sessionMtime(proj, id); if (m) consider(proj, id, m); }   // 0: a link to a transcript that is gone
  }
  if (!best && projFilter) return { ...currentSession('', null, stick), wide: 1 };
  if (!best && !projFilter && !anyTmp) return currentSession('', pick, stick, true);   // nothing but sessions in the temporary folder: one of them rather than an empty call   // nothing in that folder (an editor open on another one than the sessions): the latest of anywhere, and the page is told, so its tabs follow the same rule
  return best ? { ...best, asked, why: 'latest' } : {};   // a call that is opened while nobody is at work: the session that was written to last
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
  if (!st || st.agent !== agent || size < st.offset) { st = { agent, file, journal: !!journal, gen: ++fileGen, offset: 0, mtime: 0, fp: Buffer.alloc(0), tail: Buffer.alloc(0), raw: [], toolName: {}, msgUsage: new Map() }; fileStates.set(file, st); }
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
  if (r.type === 'cost-state') { const usd = Number(r.totalCostUSD); if (agent === 'main' && Number.isFinite(usd) && usd >= 0) st.cost = { usd, at: st.lastTs || 0 }; return; }   // Claude Code's own count of what the session cost, sub-agents included, written when its process ends or restarts (2.1.300 on): the latest one read
  if (r.type === 'queue-operation' && typeof r.content === 'string' && r.content.includes('<task-notification>')) {   // how Claude Code reports that a background sub-agent has stopped
    const id = (r.content.match(/<tool-use-id>([^<]+)<\/tool-use-id>/) || [])[1], status = (r.content.match(/<status>([^<]+)<\/status>/) || [])[1];
    if (id && status && status !== 'running') push({ ts, agent, kind: 'agentdone', toolId: id });
    return;
  }
  if (r.type === 'attachment' && r.attachment && r.attachment.type === 'task_reminder' && Array.isArray(r.attachment.content)) {   // Claude Code reminds the agent of its task list now and then: the whole list as it stands, which the shared screen takes over from the calls that changed it
    const c = r.attachment.content; if (!c.length && !st.tasks) return; st.tasks = 1;   // an empty list before any task is no news
    push({ ts, agent, kind: 'tasks', items: c.slice(0, 50).map((x) => ({ id: clip(x && x.id, 40), c: clip(x && x.subject, 120), s: clip((x && x.status) || 'pending', 20), a: clip(x && x.activeForm, 120) })) });
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
    const one = blocks(r).filter((b) => b.type === 'tool_result').length === 1;   // what Claude Code noted about the call (toolUseResult) is that call's when the record answers one call
    if (one && st.plans && r.toolUseResult && typeof r.toolUseResult.plan === 'string' && r.toolUseResult.plan.trim()) for (const b of blocks(r)) if (b.type === 'tool_result' && st.plans.has(b.tool_use_id)) st.plans.get(b.tool_use_id).d.text = clip(r.toolUseResult.plan.trim(), 4000);   // the answer names the plan exactly: the plan file holds only the latest one
    for (const b of blocks(r)) if (b.type === 'tool_result' && st.toolName[b.tool_use_id] && !NO_RESULT.has(st.toolName[b.tool_use_id])) {
      const n = st.toolName[b.tool_use_id], text = resultText(b.content), img = resultImages(b.content).length, files = n === 'Bash' && !b.is_error ? docPaths(text, false).map((f) => absPath(f, r.cwd)) : [], art = !b.is_error && st.pubs && st.pubs.has(b.tool_use_id) ? artOf(st, st.pubs.get(b.tool_use_id), r.toolUseResult, text) : null;
      items.push({ id: b.tool_use_id, err: !!b.is_error, out: clipOut(text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trimEnd(), RESULT_MAX[n] || (/^mcp__/.test(n) ? 900 : 600)), ...(img ? { img } : {}), ...(files.length ? { files } : {}), ...(art ? { art } : {}), ...(BROWSER_MCP.test(n) && !b.is_error ? browserSeen(text, n) : {}), ...resultMore(n, text, one ? r.toolUseResult : null) });   // img: how many pictures came back; the page fetches them from /api/media · files: the documents a command says it made
    }
    if (items.length) push({ ts, agent, kind: 'results', items });
    const typed = blocks(r).filter((b) => b.type === 'text').map((b) => b.text).join('\n').replace(HARNESS, ''), cut = /^\s*\[Request interrupted[^\]]*\]/i.test(typed);   // what the human typed, without the blocks the harness wraps around it
    if (agent !== 'main') { if (!st.prompt && typed.trim() && !st.raw.length) st.prompt = { ts, text: typed.trim() }; return; }   // a sub-agent's first user message is the order, emitted from the parent's side (kept here for the agents of a workflow, whose order is in no other file)
    if (cut && st.out) st.out.clear(); if (cut && st.act >= 0) st.raw[st.act].end = 1;   // Esc: the turn stops there, without the end_turn mark. The last thing the lead said or did closes it
    const txt = typed.replace(/^\s*\[Request interrupted[^\]]*\]\s*/i, '').trim();
    if (txt && !/^<(system-reminder|command-|local-command|task-notification)/.test(txt) && !r.isMeta && !r.isCompactSummary) { if (st.out) st.out.clear(); const pics = blocks(r).filter(isImg).length; push({ ts, agent: 'user', kind: 'user', text: txt, ...(pics && typeof r.uuid === 'string' && /^[\w.\-]{6,200}$/.test(r.uuid) ? { img: pics, iid: r.uuid } : {}) }); }   // img: the pictures pasted with it, served by /api/media (agent=user, tool=iid)   // a call that never got its answer is not waited for across your next message · not the summary Claude Code writes when it compacts: thousands of characters the human never typed
  } else if (r.type === 'assistant') {
    const m = r.message || {}; let said = null;
    if (agent === 'main') { st.lead = 1; if (m.stop_reason) st.stops = 1; }   // this transcript says why each message stopped: its turns end with a mark, and until one comes the lead is at work (see marks, below)
    if (m.id && m.usage) {   // the same message is repeated once per content block with identical numbers: keep one per message id
      const u = m.usage, prev = st.msgUsage.get(m.id);
      const ef = String(r.perTurnEffort || r.effort || ''), adv = String(r.advisorModel || '');   // the effort it worked at and the model it may ask for advice, when Claude Code wrote them (2.1.275 on)
      st.msgUsage.set(m.id, { ts: prev ? prev.ts : ts, u: { i: u.input_tokens || 0, o: u.output_tokens || 0, r: u.cache_read_input_tokens || 0, w: u.cache_creation_input_tokens || 0 }, model: m.model, ...(/^[a-z]{2,12}$/.test(ef) ? { ef } : {}), ...(/^[\w.:\-\[\]]{1,80}$/.test(adv) && adv !== m.model ? { adv } : {}) });
    }
    const th = () => { const t = st.th; st.th = ''; return t ? { th: t } : {}; };   // what the agent was thinking before this line or call, when Claude Code kept it (most of the time it only keeps a signature): the call shows it as an inner thought
    for (const b of blocks(r)) {
      if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) st.th = clip(b.thinking.replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\n ]*/g, '\n').trim(), 900);   // line breaks are kept: each line of its notes is a thought of its own
      else if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) { said = push({ ts, agent, kind: 'say', text: b.text.trim(), ...th() }); st.act = st.raw.length - 1; st.sayOf = m.id; st.sayAt = st.act; }
      else if (b.type === 'tool_use' && b.name === 'SubagentHandback' && agent !== 'main' && b.input && typeof b.input.message === 'string' && b.input.message.trim()) { said = push({ ts, agent, kind: 'say', text: b.input.message.trim(), ...th() }); st.act = st.raw.length - 1; st.sayOf = m.id; st.sayAt = st.act; }   // since Claude Code 2.1.293 a sub-agent hands its report back through this call, and most write no sentence beside it: the message of the call is what it says last
      else if (b.type === 'tool_use') {
        st.toolName[b.id] = b.name; if (b.name === 'TaskCreate') st.tasks = 1; (st.out = st.out || new Set()).add(b.id); if (b.input && b.input.run_in_background) (st.bg = st.bg || {})[b.id] = true;   // out: the calls that have no answer yet
        if (b.name === 'Agent' || b.name === 'Task') push({ ts, agent, kind: 'agentcall', toolId: b.id, bg: !!(b.input && b.input.run_in_background), text: (b.input && b.input.prompt) || '', title: (b.input && b.input.description) || '', ...(b.input && typeof b.input.name === 'string' && b.input.name.trim() ? { nm: b.input.name.trim() } : {}) });
        else { const tool = toolLabel(b, ts); if (tool.d && tool.d.outs) tool.d.outs = tool.d.outs.map((f) => absPath(f, r.cwd)); if (/^(Write|Edit|MultiEdit)$/.test(b.name) && b.input && planFile(String(b.input.file_path || ''))) { st.planF = String(b.input.file_path); st.planW = b.name === 'Write' && typeof b.input.content === 'string' ? { mid: m.id, text: clip(b.input.content.trim(), 4000) } : null; } if (tool.d && tool.d.kind === 'plan') { (st.plans = st.plans || new Map()).set(b.id, tool); if (st.planW && st.planW.mid && st.planW.mid === m.id) tool.d.text = st.planW.text; else if (!tool.d.text && st.planF) tool.d.text = (st.planW && st.planW.text) || planDoc(st.planF); }   /* a plan written in the same message as its call: the call carries the one before, or none */   /* Claude Code 2.1.30x sends ExitPlanMode with no plan: the plan is the file the session just wrote in ~/.claude/plans */ if (tool.d && tool.d.kind === 'artifact') (st.pubs = st.pubs || new Map()).set(b.id, tool.d.open ? 'open' : tool.d.doc ? 'doc' : 'pub'); push({ ts, agent, kind: 'tool', tool, ...th() }); st.act = st.raw.length - 1; }
      }
    }
    if (agent === 'main' && (m.stop_reason === 'end_turn' || ((r.isApiErrorMessage || (m.model === '<synthetic>' && m.stop_reason === 'stop_sequence')) && !(st.out && st.out.size)))) {   // also a turn that ends on a message Claude Code writes itself, in the place of the model's: the API is down, the limit is reached, the request was refused, or there was nothing to answer. Nothing follows it, unless a call of the lead is still out: the connection dropped while its agents worked, and it goes on when they answer. (A message of the model that a safety check cuts is not the end either: Claude Code tells the model, which goes on.) The lead's turn is over: Claude Code writes one record per content block, each with the message's stop reason, so the mark goes on the line this record carries (a thinking block carries none)
      if (!said && m.id && st.sayOf === m.id) said = st.raw[st.sayAt];   // ...or on the line the same message brought in an earlier record
      if (said) said.end = 1;
    }
  }
}
const codexRecord = codex.parser({ toolLabel, clip, clipOut, testsOf, diffOf, resultMax: RESULT_MAX }), vibeRecord = vibe.parser({ toolLabel, clip: clipOut, resultMax: RESULT_MAX });   // Vibe clips only thoughts and outputs: without the codes of a terminal
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
  const sx = sourceOf(proj), rec = recordOf(sx), base = projDir(proj, id), mainFile = sx ? sx.fileOf(id) || '' : path.join(base, id + '.jsonl');   // source readers supply their own session and child files; the timeline and page are shared
  if (!fs.existsSync(mainFile)) throw new Error('session not found');
  const agents = { main: { id: 'main', role: 'Lead', type: 'main' } };   // the lead has the same name whatever tool runs the session: the page gives it
  const states = [(sx && sx.state && guard(() => sx.state(id), null)) || readNew(mainFile, 'main', false, rec)], subs = subFilesOf(proj, id), runs = {}; files.push(mainFile);   // sx.state: a format that is not read line by line hands over the events of the session whole   // runs: workflow run → { agents (file name → agent id), by (who launched it), toolId, done }
  for (const x of subs) {
    const aid = x.aid, m = x.meta || readMeta(x.file.replace(/\.jsonl$/, '.meta.json'));
    agents[aid] = { id: aid, role: m.description || m.workflowPhase || m.agentType || 'Agent', type: m.agentType || 'agent', toolUseId: m.toolUseId };
    if (m.parent) Object.assign(agents[aid], { parent: m.parent, name: m.name, startedAt: m.startedAt });   // Codex records the parent explicitly, even when its spawn prompt is encrypted
    if (x.run) { agents[aid].wf = x.run; if (m.workflowPhase) agents[aid].phase = m.workflowPhase; (runs[x.run] = runs[x.run] || { agents: {}, done: new Set() }).agents[x.id0] = aid; }   // launched by a workflow: no Agent call of the lead points at it
    agents[aid].mtime = x.mtime || mtimeOf(x.file) || undefined;
    const st = x.st || (x.zst ? sx && sx.state && guard(() => sx.state(aid, aid), null) : readNew(x.file, aid, false, rec)); if (st) states.push(st); files.push(x.file);   // x.zst: a compressed Codex child, read whole here only
  }
  for (const j of subs.journals) { const st = readNew(j.file, 'wf:' + j.run, true), run = runs[j.run]; files.push(j.file); if (st && run) for (const e of st.raw) if (run.agents[e.child]) run.done.add(run.agents[e.child]); }
  const childByTool = {};   // Agent tool_use id → the sub-agent it created, so we know who ordered whom
  for (const a of Object.values(agents)) if (a.toolUseId) childByTool[a.toolUseId] = a.id;
  const called = {}, born = {}; for (const st of states) if (st) { if (st.raw.length) born[st.agent] = st.raw[0].ts; for (const e of st.raw) if (e.kind === 'agentcall' && e.nm && childByTool[e.toolId]) called[childByTool[e.toolId]] = e.nm; }
  const sameName = {}; for (const a of Object.values(agents).filter((x) => x.id !== 'main').sort((x, y) => (born[x.id] || Infinity) - (born[y.id] || Infinity) || (x.id < y.id ? -1 : 1))) {   // in the order they started, so that a second agent of the same name is the one numbered 2 and stays so
    const n = ownName(called[a.id]) || ownName(a.name) || ownName(a.type, true); if (n) { const k = n.toLowerCase(); sameName[k] = (sameName[k] || 0) + 1; a.own = sameName[k] > 1 ? n + ' ' + sameName[k] : n; }
  }
  const runByTool = {}; for (const st of states) if (st) for (const e of st.raw) if (e.kind === 'wfrun' && runs[e.run] && !runs[e.run].by) { runs[e.run].by = e.agent; runs[e.run].toolId = e.toolId; runByTool[e.toolId] = runs[e.run]; }   // Workflow tool_use id → the run it started

  const finished = new Set(), now0 = Date.now(); for (const st of states) if (st) for (const e of st.raw) if (e.kind === 'agentdone') { if (childByTool[e.toolId]) finished.add(childByTool[e.toolId]); else if (runByTool[e.toolId]) for (const a of Object.values(runByTool[e.toolId].agents)) finished.add(a); }   // a run that stopped: so did every agent in it
  for (const run of Object.values(runs)) for (const a of run.done) finished.add(a);
  for (const st of states) if (st && st.agent !== 'main' && st.completed) finished.add(st.agent);
  let recentUntil = 0; for (const a of Object.values(agents)) if (a.id !== 'main' && a.mtime && now0 - a.mtime <= 240000) recentUntil = Math.max(recentUntil, a.mtime + 241000);
  for (const a of Object.values(agents)) if (a.id !== 'main' && now0 - (a.mtime || 0) > 240000) finished.add(a.id);   // old transcripts without a completion record: silent for 4 min counts as finished
  const events = [], parent = {}, doneSeen = new Set(), lastTs = {}; for (const st of states) if (st) lastTs[st.agent] = st.lastTs || 0;
  for (const a of Object.values(agents)) if (a.parent && a.parent !== a.id && agents[a.parent]) parent[a.id] = a.parent;
  const usageBy = new Map(); for (const st of states) if (st) for (const [mid, mu] of st.msgUsage) { if (!/^msg_/.test(mid)) continue; const o = usageBy.get(mid); if (!o || mu.ts < o.msgUsage.get(mid).ts || (mu.ts === o.msgUsage.get(mid).ts && st.agent === 'main')) usageBy.set(mid, st); }   // a fork (on by default since Claude Code 2.1.302) starts its file with a copy of the message that launched it: its tokens count once, for the agent that wrote it first. Only the API's own message ids (msg_…) name one message across files: Codex and Vibe number theirs in each agent (t0, v1…), the same name in two agents is two messages
  const finish = (to, ts, by) => { if (!doneSeen.has(to)) { doneSeen.add(to); events.push({ ts, agent: to, kind: 'finish', to: by, k: 'f/' + to }); } };   // one per agent, whichever record says it first: the key is the agent, not the record
  for (const st of states) {
    if (!st) continue;
    const a = agents[st.agent];
    if (a && a.parent && parent[st.agent]) {
      events.push({ ts: a.startedAt || (st.prompt && st.prompt.ts) || born[st.agent] || 0, agent: parent[st.agent], to: st.agent, kind: 'order', bg: true,
        text: st.prompt ? st.prompt.text : a.role, title: a.role, k: 'o/' + st.agent });
      for (const [n, q] of (st.prompts || []).entries()) events.push({ ts: q.ts, agent: parent[st.agent], to: st.agent, kind: 'order', bg: true, text: q.text, title: a.role, k: 'o/' + st.agent + '/' + (n + 1) });   // more work for a worker that had finished
      if (st.completedAt) finish(st.agent, st.completedAt, parent[st.agent]);   // kept while it works again (its time moves to the next end): an event that vanished would make the page load the call again
    }
    let lastSay = -1;   // the last thing a sub-agent says is its report back to the lead
    if (st.agent !== 'main' && finished.has(st.agent)) for (let i = st.raw.length - 1; i >= 0; i--) if (st.raw[i].kind === 'say') { lastSay = i; break; }
    const run = agents[st.agent] && agents[st.agent].wf ? runs[agents[st.agent].wf] : null;
    if (run && st.prompt) { parent[st.agent] = run.by || 'main'; events.push({ ts: st.prompt.ts, agent: parent[st.agent], to: st.agent, kind: 'order', ...(run.toolId ? { toolId: run.toolId } : {}), bg: true, wf: agents[st.agent].wf, text: st.prompt.text, title: agents[st.agent].role, k: 'o/' + st.agent }); }   // the order a workflow gave is the first message of the agent's own file: shown as an order from whoever launched the workflow (the lead when nothing says who), given in the background, when the agent started
    // a fork's file starts with a copy of the call that launched it (Claude Code 2.1.302 turns forks on by default): that copy is not the fork launching or finishing itself
    st.raw.forEach((e, i) => {
      if (e.kind === 'agentdone') { const to = childByTool[e.toolId] === e.agent ? null : childByTool[e.toolId], wr = runByTool[e.toolId]; if (to) finish(to, e.ts, e.agent); else if (wr) for (const a of Object.values(wr.agents)) if (!wr.done.has(a)) finish(a, Math.max(e.ts, lastTs[a] || 0), e.agent); }   // the agents the journal knows about are finished below, at their own time
      else if (e.kind === 'agentcall') { const to = childByTool[e.toolId]; if (to && to !== e.agent) { parent[to] = e.agent; events.push({ ts: e.ts, agent: e.agent, to, kind: 'order', toolId: e.toolId, bg: e.bg, text: e.text, title: e.title, k: e.k }); } }
      else if (e.kind === 'wfrun' || e.kind === 'wfdone') return;
      else if (i === lastSay) events.push({ ...e, kind: 'report', to: null });   // `to` filled below, once every order is known
      else events.push(e);
    });
    if (run && run.done.has(st.agent) && st.lastTs) finish(st.agent, st.lastTs, parent[st.agent] || 'main');   // the journal has no times: the agent finished when it last wrote
    for (const [mid, mu] of st.msgUsage) if (!usageBy.has(mid) || usageBy.get(mid) === st) events.push({ ts: mu.ts, agent: st.agent, kind: 'usage', u: mu.u, model: mu.model, ...(mu.cw ? { cw: mu.cw } : {}), ...(mu.ef ? { ef: mu.ef } : {}), ...(mu.adv ? { adv: mu.adv } : {}), k: 'u/' + st.agent + '/' + mid });
  }
  for (const e of events) if (e.kind === 'report' && e.to === null) e.to = parent[e.agent] || 'main';

  events.sort((a, b) => a.ts - b.ts);
  const merged = []; let lastReal = -1;   // consecutive tool calls of one agent become one activity beat; usage events are transparent to that rule
  for (const e of events) {
    const p = lastReal >= 0 ? merged[lastReal] : null;
    if (e.kind === 'usage' || e.kind === 'finish' || e.kind === 'compact' || e.kind === 'tasks') { merged.push(e); continue; }   // tasks: the list Claude Code reminds the agent of, which comes between two calls of one beat
    if (e.kind === 'tool' && p && p.kind === 'tools' && p.agent === e.agent && !p.end) { p.tools.push(e.tool); if (e.end) p.end = 1; }   // a beat keeps the key of its first call; one that closed a turn takes no more calls
    else { merged.push(e.kind === 'tool' ? { ts: e.ts, agent: e.agent, kind: 'tools', tools: [e.tool], ...(e.end ? { end: 1 } : {}), ...(e.th ? { th: e.th } : {}), k: e.k } : e); lastReal = merged.length - 1; }
  }
  const real = merged.find((e) => e.kind !== 'usage' && e.kind !== 'finish' && e.kind !== 'compact' && e.kind !== 'tasks'), first = real ? real.ts : 0, last = merged.length ? merged[merged.length - 1].ts : 0;   // time zero = the first thing said or done
  const marks = !sx && states[0] && (states[0].stops || !states[0].lead) ? { marks: 1 } : {};   // a Claude Code session whose turns end with a mark, also before the lead has written anything: a session that has not closed a turn yet is not one without marks, and its lead is not "done" each time it thinks for a while
  const ms = states.find((x) => x && x.agent === 'main'), cost = ms && ms.cost ? { usd: Math.round(ms.cost.usd * 1e4) / 1e4, final: !merged.some((e) => e.kind === 'usage' && e.ts > ms.cost.at) } : null;   // final: nothing was spent after Claude Code counted it (else it is a floor)
  return { id, proj, agents: Object.values(agents), events: merged.map((e) => ({ ...e, t: Math.max(0, e.ts - first) })), durationMs: last - first, recentUntil, ...marks, ...(cost ? { cost } : {}) };
}

// Ask the local `claude` CLI (uses the user's existing login) to map a JSON array of strings to another array. Cached.
const { spawn } = require('child_process');
const cache = new Map(), CACHE_MAX = 5000;   // translations and little lines, by text: the oldest go first past CACHE_MAX (an editor open for days kept every line of every session)
const remember = (k, v) => { cache.delete(k); cache.set(k, v); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); };
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
// Through cmd.exe, Node joins the arguments with spaces and quotes none: the empty value of --tools vanished and the system prompt became one argument per word. Quoted, each stays whole
// (a line break or a double quote inside would end it: there are none in what is sent, and they are made harmless anyway).
const winArg = (a) => '"' + String(a).replace(/[\r\n]+/g, ' ').replace(/"/g, "'") + '"';
function spawnClaude(args, opts) {
  const bin = findClaude(); if (!bin) { lastTrError = 'not-found'; return null; }
  const p = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin) ? spawn('"' + bin + '"', args.map(winArg), { ...opts, shell: true, windowsHide: true }) : spawn(bin, args, { ...opts, windowsHide: true });   // npm's Windows shims need a shell, which takes the arguments as they are: each one is quoted
  if (p.stdin) p.stdin.on('error', () => {});   // a claude that exits before reading its prompt (not signed in, an old version): EPIPE would otherwise end the whole server
  return p;
}
let running = 0; const queue = [];
const pump = () => { while (running < 3 && queue.length) { running++; queue.shift()(); } };
const schedule = (fn) => new Promise((res, rej) => { queue.push(() => fn().then(res, rej).finally(() => { running--; pump(); })); pump(); });
// Fast path (~1-2 s instead of ~6 s): if the user has an Anthropic API key in the environment, call the API directly.
async function apiMap(prompt, need) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error('no key');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }) });   // a request that hangs gives way to claude -p after 30 s
  if (!r.ok) throw new Error('api ' + r.status);
  const j = await r.json(), tb = j && Array.isArray(j.content) ? j.content.find((b) => b && b.type === 'text' && typeof b.text === 'string') : null; if (!tb) throw new Error('no text');   // the text block, wherever it is: a model that thinks first puts its thinking before it
  const out = tb.text, arr = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1));
  if (!Array.isArray(arr) || arr.length !== need.length) throw new Error('bad length'); return arr;
}
function claudeMap(kind, instruction, texts) {
  const need = [...new Set(texts.filter((t) => !cache.has(kind + '|' + t)))];
  const done = (ok) => ({ texts: texts.map((t) => cache.get(kind + '|' + t) || t), ok });
  if (!need.length) return Promise.resolve(done(true));
  const prompt = instruction + ' Output ONLY a JSON array of strings, same length and order, no markdown.\n' + JSON.stringify(need);
  return apiMap(prompt, need).then((arr) => { need.forEach((t, i) => remember(kind + '|' + t, String(arr[i]))); return done(true); }).catch(() => schedule(() => new Promise((resolve) => {
    const p = spawnClaude(['-p', '--model', 'haiku', '--no-session-persistence', '--tools', ''], { cwd: os.tmpdir() }); if (!p) return resolve(done(false));
    let out = ''; const timer = setTimeout(() => p.kill(), 60000);
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(done(false)));
    p.on('close', () => {
      clearTimeout(timer);
      let ok = false;
      try {
        const arr = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1));
        if (arr.length === need.length) { need.forEach((t, i) => remember(kind + '|' + t, String(arr[i]))); ok = true; }
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
    await Promise.all(need.map(async (t) => { const r = await pickWorker().ask(t, lang); if (r) remember(lang + '|' + t, r); }));
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
const ttsDir = process.platform === 'linux' ? path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'agent-standup', 'tts') : path.join(os.tmpdir(), 'agent-standup-tts-' + (process.getuid ? process.getuid() : 'user'));   // Linux: /tmp is shared by every user, and a folder or file put there first by someone else would have been used (written through, or played); macOS and Windows give each user a temporary folder of their own
try { fs.mkdirSync(ttsDir, { recursive: true, mode: 0o700 }); } catch {}
const ttsJobs = new Map();
const ttsClean = () => { try { for (const f of fs.readdirSync(ttsDir)) { const p = path.join(ttsDir, f); if (Date.now() - fs.statSync(p).mtimeMs > 864e5) fs.unlinkSync(p); } } catch {} };   // drop cached audio older than a day
ttsClean(); setInterval(ttsClean, 3600e3).unref();   // also while an editor stays open for days
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
  const ev = timeline(proj, id).events, said = new Set(); let since = ev.some((e) => e.kind === 'tools' && e.tools.some((t) => t.d && ((t.d.kind === 'write' && t.d.file === file) || (t.name === 'mcp__cowork__present_files' && t.d.outs && t.d.outs.includes(file))))) ? 0 : null;   // written by the session, or handed to the person by Cowork
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
// Which window plays sound, in a file next to the settings: each VS Code window has its own server, and two windows with the call open both spoke.
const AUDIO = path.join(path.dirname(PREFS), 'audio.json');
let audioMem = { id: null, seen: 0 }, audioFile = true;   // audioFile false: the file cannot be written (a read-only folder), this server keeps the owner itself as it used to
const audioOwner = () => { if (!audioFile) return audioMem; try { const a = JSON.parse(fs.readFileSync(AUDIO, 'utf8')); if (a && typeof a.id === 'string') return { id: a.id, seen: Math.min(+a.seen || 0, Date.now()) }; } catch {} return { id: null, seen: 0 }; };   // min: a clock set back left a time to come, and the owner never expired
const audioSave = (a) => { audioMem = a; try { fs.mkdirSync(path.dirname(AUDIO), { recursive: true }); const t = AUDIO + '.' + process.pid; fs.writeFileSync(t, JSON.stringify(a)); fs.renameSync(t, AUDIO); } catch { audioFile = false; } };   // whole or not at all: another server may read it at that moment
function start(port = PORT) {
  return http.createServer((req, res) => {
  let url; try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end('bad request'); }   // "GET //" is not an address: answered, where it used to stop the whole server
  req.on('error', () => {}); res.on('error', () => {});   // a browser that goes away mid-request is not our problem
  // Only the local machine may talk to this server: blocks other websites (cross-site requests) and DNS-rebinding attempts.
  const local = (h) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h || '');
  let originOk = true; try { originOk = !req.headers.origin || (local(new URL(req.headers.origin).host) && new URL(req.headers.origin).host === req.headers.host); } catch { originOk = false; }   // the page's own address: another local page (a dev server on another port) is another site
  if (!local(req.headers.host) || !originOk) { res.writeHead(403); return res.end('forbidden'); }
  const json = (o, code = 200) => { try { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); } catch { res.destroy(); } };   // also called from callbacks that run later, where nothing would catch an exception
  const sendFile = (fp) => { const s = fs.createReadStream(fp); s.on('error', () => res.destroy()); s.pipe(res); };   // a file that vanished between the check and the read ends this answer, not the server
  // Endpoints with side effects (they spawn programs or claim the sound), and the one that serves pictures from a session, refuse requests that a browser marks as coming from another site, e.g. an <img> on a web page.
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && sfs !== 'same-origin' && sfs !== 'none' && (req.method !== 'GET' || ['/api/translate', '/api/quips', '/api/warm', '/api/audio', '/api/tts', '/api/prefs', '/api/prefs.js', '/api/voices', '/api/kokoro', '/api/kokoro/install', '/api/media', '/api/taskout', '/api/artifact', '/api/errors', '/api/packs', '/api/update'].includes(url.pathname))) { res.writeHead(403); return res.end('forbidden'); }
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
      const now = Date.now(); let a = audioOwner();
      if (ok && url.searchParams.get('claim')) audioSave((a = { id: cid, seen: now }));
      else if (ok && a.id === cid && now - a.seen > 2000) audioSave((a = { id: cid, seen: now }));   // the owner says it is still there, written every 2 s at most
      if (a.id && now - a.seen > 6000) a = { id: null, seen: 0 };
      return json({ owner: a.id });
    }
    if (url.pathname === '/api/health') return json({ claude: findClaude(), apiKey: !!process.env.ANTHROPIC_API_KEY, trError: lastTrError, platform: process.platform });
    if (url.pathname === '/api/warm') { const lang = trLang(url.searchParams.get('lang')); trWorkers.forEach((w) => { if (!w.p) w.start(lang); }); return json({ ok: true }); }
    if (url.pathname === '/api/voices') {
      if (url.searchParams.get('engine') === 'kokoro') { const st = kokoro.status(); if (st.installed && !st.gaveUp) kokoro.warm(); return json({ available: st.installed && !st.gaveUp, ready: st.ready, voices: kokoro.voices(), platform: process.platform, engine: 'kokoro' }); }
      return loadVoices().then((v) => json(v));
    }
    if (url.pathname === '/api/kokoro/install' && req.method === 'POST') return json(kokoro.install()); if (url.pathname === '/api/usage' && req.method === 'POST') return json(usageWeek());
    if (url.pathname === '/api/update') return updateInfo().then(json, () => json({ on: false, current: VERSION }));   /* a newer version, at most one request to npm a day (updateInfo) */
    if (url.pathname === '/api/kokoro') return json(kokoro.status());
    if (url.pathname === '/api/tts') {
      return tts(url.searchParams.get('text') || '', url.searchParams.get('voice'), url.searchParams.get('rate'), url.searchParams.get('engine'), url.searchParams.get('fb'))
        .then((f) => { res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'max-age=86400' }); sendFile(f); })
        .catch((e) => json({ error: String(e.message) }, 400));
    }
    if (url.pathname === '/api/prefs.js') { res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' }); return res.end('window.SAVED_PREFS = ' + JSON.stringify(readPrefs()).replace(/</g, '\\u003c') + '; window.AS_APP = ' + JSON.stringify(appKind()).replace(/</g, '\\u003c') + ';'); }
    if (url.pathname === '/api/prefs' && req.method === 'PUT') return readBody((body) => { try { let v = JSON.parse(body); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('prefs must be an object'); const cur = readPrefs() || {}; if (v._patch && typeof v._patch === 'object') { const set = v._patch.set && typeof v._patch.set === 'object' && !Array.isArray(v._patch.set) ? v._patch.set : {}, del = Array.isArray(v._patch.del) ? v._patch.del : []; v = { ...cur, ...set }; for (const k of del) if (typeof k === 'string' && !(k in set)) delete v[k]; }   /* a page sends what it changed, merged into the file as it is now: a window opened earlier no longer puts back what another one changed. A whole object (an older page) still replaces the file */ if ((+cur.shareUsageT || 0) > (+v.shareUsageT || 0)) { v.shareUsage = cur.shareUsage; v.shareUsageT = cur.shareUsageT; v.usageAsked = cur.usageAsked; } if ((+cur.updateNoticeT || 0) > (+v.updateNoticeT || 0)) { v.updateNotice = cur.updateNotice; v.updateNoticeT = cur.updateNoticeT; v.updateAsked = cur.updateAsked; } writePrefs(v);   /* the usage answer: a page opened before it was changed elsewhere (another tab, the desktop app) writes back its old settings, not its old answer */ json({ ok: true }); } catch (e) { json({ error: String(e.message || e) }, 400); } });
    if (url.pathname === '/api/prefs') return json(readPrefs() || {});
    if (url.pathname === '/api/answer' && req.method === 'POST') return readBody((body) => { let v = {}; try { v = JSON.parse(body); } catch {} json(answerIn(String((v && v.id) || ''))); });   /* a click on what needs you: open it where it can be answered (answerIn) */
    if (url.pathname === '/api/done' && req.method === 'POST') return readBody((body) => { try { const v = JSON.parse(body); json({ ok: setDone(String(v.proj || ''), String(v.id || ''), v.on !== false) }); } catch (e) { logError('done', e); json({ error: String(e.message || e) }, 400); } });
    if (url.pathname === '/api/errors' && req.method === 'POST') return readBody((body) => { try { const b = JSON.parse(body) || {}; logError('page' + (typeof b.where === 'string' && b.where ? ' ' + b.where.slice(0, 40) : ''), { message: String(b.msg || ''), stack: String(b.stack || '') }); json({ ok: true }); } catch (e) { json({ error: String(e.message || e) }, 400); } });   // an error of the page, written to the local log
    if (url.pathname === '/api/errors') return json(errorReport());
    if (url.pathname === '/api/current') { const q = (k) => url.searchParams.get(k) || ''; return json(currentSession(q('proj'), q('pid') ? { proj: q('pproj'), id: q('pid'), since: q('since') ? +q('since') : NaN, pin: q('pin') === '1' } : null, { proj: q('sproj'), id: q('sid') })); }
    if (url.pathname === '/api/board') return json(boardRows());
    if (url.pathname === '/api/missing') return json(missingTranscripts());   // live Claude Code sessions whose transcript is not where the call reads (missingTranscripts)
    if (url.pathname === '/api/characters') return json(listCharacters(url.searchParams.get('pack') || ''));
    if (url.pathname === '/api/characters/add' && req.method === 'POST') return readBody((body) => { try { const b = JSON.parse(body || '{}') || {}; json(addCharacter(String(b.role || ''), b.name, b.data)); } catch (e) { if (!e.word) logError('add character', e); json({ error: e.word || 'write' }, e.word ? 400 : 500); } }, 512 * 1024);   // a picture of 300 KB is 400 KB once written as text
    if (url.pathname === '/api/characters/remove' && req.method === 'POST') return readBody((body) => { let b = {}; try { b = JSON.parse(body || '{}') || {}; } catch {} try { json(removeCharacter(b.file) ? { ok: true } : { error: 'file' }, 200); } catch (e) { logError('remove character', e); json({ error: 'write' }, 500); } });
    if (url.pathname === '/api/packs') return json(packList());
    if ((url.pathname === '/api/packs/buy' || url.pathname === '/api/packs/claim') && req.method === 'POST') return readBody((body) => {
      let b = {}; try { b = JSON.parse(body || '{}') || {}; } catch {} const name = String(b.pack || ''); if (!hasOwn(SHOP_PACKS, name)) return json({ error: 'pack' }, 404);
      (url.pathname.endsWith('/buy') ? buyPack(name) : claimPack(name, typeof b.code === 'string' ? b.code.trim().slice(0, 260) : '')).then((r) => json(r, r.status), (e) => { logError('shop', e); json({ error: 'shop' }, 500); });
    });
    if (url.pathname === '/api/reveal' && req.method === 'POST') return readBody((body) => {   // 404: not a file this session created · 410: created, and no longer there. A check (check: true) is answered 200 { exists: false, reason: 'unknown' | 'gone' } instead: the page asks it of every document it may show, and an error status there is a console error each time
      try {
        let b = null; try { b = JSON.parse(body); } catch {} const SAFE = /^[\w.\-]+$/, ok = (v) => typeof v === 'string' && SAFE.test(v) && v !== '..' && v.length <= 200;
        if (!b || !ok(b.proj) || !ok(b.id) || typeof b.file !== 'string' || !b.file || b.file.length > 4096) return json({ error: 'bad request' }, 400);
        const no = (reason, error, code) => (b.check === true ? json({ exists: false, reason }) : json({ error }, code));
        const f = sessionFile(b.proj, b.id, b.file); if (!f) return no('unknown', 'not a file of this session', 404);
        let st = null; try { st = reveal.stat(f.fp); } catch {} if (!st || !st.isFile()) return no('gone', 'gone', 410);
        if (f.since && st.mtimeMs < f.since - 2000) return no('unknown', 'not a file of this session', 404);   // a command names it, and it was there before: read, listed or removed, not made
        if (b.check !== true) reveal.run(f.fp); json(b.check === true ? { ok: true, exists: true } : { ok: true });   // check: the page asks whether a document a command names is there, before it shows it
      } catch (e) { json({ error: String(e.message || e) }, 500); }
    });
    if (url.pathname === '/api/media') {
      const q = (k) => url.searchParams.get(k) || '', SAFE = /^[\w.\-]+$/, n = +q('n') || 0, bad = [q('proj'), q('id'), q('agent'), q('tool')].some((v) => !SAFE.test(v) || v === '..' || v.length > 200) || q('tool').length < 6;   // no tool call has an id that short, and looking for one meant reading the whole transcript
      const sx = sourceOf(q('proj')), user = q('agent') === 'user', ok = !bad && Number.isInteger(n) && n >= 0 && n <= 9, file = ok && !sx ? mediaFile(q('proj'), q('id'), q('agent')) : null;
      const im = !ok ? null : q('proj') === '_demo' ? require('./demo.js').picture(q('tool'), n) : sx ? (sx.image ? guard(() => sx.image(q('id'), q('tool'), n, user, q('agent') || 'main'), null) : null) : file && toolImage(file, q('tool'), n, user);   // a Codex session: from the lead or the specified child rollout, plain or compressed
      if (!im) { res.writeHead(bad ? 400 : 404); return res.end(bad ? 'bad request' : 'not found'); }
      res.writeHead(200, { 'content-type': im.type, 'content-length': im.buf.length, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' }); return res.end(im.buf);
    }
    if (url.pathname === '/api/taskout') {   // the end of what a command left running in the background has printed so far (taskOutput)
      const q = (k) => url.searchParams.get(k) || '', SAFE = /^[\w.\-]+$/, bad = [q('proj'), q('id')].some((v) => !SAFE.test(v) || /^\.+$/.test(v) || v.length > 200) || !/^[\w-]{1,40}$/.test(q('task'));
      if (bad) return json({ error: 'bad request' }, 400);
      const out = !sourceOf(q('proj')) && fs.existsSync(path.join(projDir(q('proj'), q('id')), q('id') + '.jsonl')) ? taskOutput(q('proj'), q('id'), q('task')) : null;   // a session the call knows, of Claude Code: the other tools keep no such file
      return out ? json(out) : json({ error: 'not found' }, 404);
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
      if (a === tl.seq) { if (!entry.idle) entry.idle = JSON.stringify({ id: tl.id, agents: tl.agents, ep: tl.ep, seq: tl.seq, marks: tl.marks, ...(tl.cost ? { cost: tl.cost } : {}), events: [] }); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(entry.idle); }   // nothing new, which is the answer to nearly every poll: written once
      return json({ id: tl.id, agents: tl.agents, ep: tl.ep, seq: tl.seq, marks: tl.marks, ...(tl.cost ? { cost: tl.cost } : {}), events: feedSince(entry, a) });   // new events and changed ones alike, whole, under the key they always had
    }
    const pk = url.pathname.match(/^\/packs\/([a-z]+)\/(.*)$/);
    if (url.pathname.startsWith('/characters/') || (pk && packDir(pk[1]))) {   // only plain image files of the characters folder (or of a built-in pack), by exact name
      let f = ''; try { f = decodeURIComponent(pk ? pk[2] : url.pathname.slice('/characters/'.length)); } catch {}
      const dir = pk ? packDir(pk[1]) : charactersDir(), fp = path.join(dir, f);
      try { const ls = fs.lstatSync(fp); if (!CHAR_NAME.test(f) || !fp.startsWith(dir + path.sep) || !ls.isFile() || ls.size > CHAR_MAX) throw 0; } catch { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': CHAR_TYPES[f.split('.').pop().toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' }); return sendFile(fp);
    }
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
    let fst = null; try { fst = fs.statSync(file); } catch {}
    if (!file.startsWith(PUBLIC + path.sep) || !fst || !fst.isFile()) { res.writeHead(404); return res.end('not found'); }
    // The only frame of the page is the window of an artifact, served from here. Without this line a page shown there could take its own frame to another site, and send out what it holds in the address.
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', ...(path.extname(file) === '.html' ? { 'content-security-policy': "frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'" } : {}) });
    res.end(fs.readFileSync(file));
  } catch (e) { logError(req.method + ' ' + url.pathname, e); if (res.headersSent) return res.destroy(); json({ error: String(e.message || e) }, 500); }
  }).listen(port, '127.0.0.1', function () { console.log(`Agent Standup → http://localhost:${this.address().port}`); });
}
module.exports = { answerIn, missingTranscripts, noteEditor, forgetEditor, _winArg: winArg, start, currentSession, shutdown, findClaude, bundledClaude, boardRows, sessionRows: listSessions, charactersDir, listCharacters, packsDir, installPack, logError, updateInfo, _reveal: reveal, _scrub: { tidy, homeRe }, _artifact: { page: artifactPage, csp: artifactCsp } };
if (require.main === module && process.env.AGENT_STANDUP_CHILD === '1' && typeof process.send === 'function') {   // started by the VS Code extension in a process of its own (see extension.js): reading a large session no longer stops the editor's extensions. Asked for by name: pm2 and others give any app a channel too
  const srv = start(+process.env.PORT || 0), tell = (m) => { try { process.send(m); } catch {} };
  srv.on('listening', () => tell({ port: srv.address().port })).on('error', (e) => { tell({ error: e.code || String(e) }); process.exit(1); });
  process.on('message', (m) => { if (m && m.env && typeof m.env === 'object') for (const [k, v] of Object.entries(m.env)) { if (v == null) delete process.env[k]; else process.env[k] = String(v); } });   // a setting changed in the editor (claudePath, codex, vibe…)
  process.on('disconnect', () => { try { shutdown(); } catch {} process.exit(0); });   // the editor window closed, or its extension host ended: this server ends with it
  process.on('uncaughtException', (e) => logError('crash', e)); process.on('unhandledRejection', (e) => logError('promise', e));   // written down and gone on, as in the extension host it ran in before: one odd request does not end the call
} else if (require.main === module) {
  start().on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use (maybe Agent Standup is already running, e.g. inside VS Code). Try: PORT=4790 node server.js` : String(e));
    process.exit(1);
  });
}
