const fs = require('fs'), path = require('path');
const codex = require('../codex.js');
const { ROOT } = require('./config');
const { blocks, HARNESS } = require('./transcript');
const { mtimeOf, subFiles } = require('./sessionFiles');

let sessionsMemo = { at: 0, rows: [] };
function listSessions() {
  if (Date.now() - sessionsMemo.at < 2000) return sessionsMemo.rows;
  const out = listSessions0(); sessionsMemo = { at: Date.now(), rows: out }; return out;
}
function listSessions0() {
  const rows = [];
  for (const r of codex.sessions(30)) rows.push({ proj: codex.PROJ, id: r.id, mtime: r.mtime, size: r.size, agents: 0, cx: r });
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
  const top = rows.filter((r) => !r.cx).slice(0, 60).concat(rows.filter((r) => r.cx)).sort((a, b) => b.mtime - a.mtime);   // the 60 most recent Claude Code sessions as always, and up to 30 Codex ones beside them: neither pushes the other out
  for (const r of top) {
    if (r.cx) { const c = r.cx; delete r.cx; r.title = codex.title(c); r.project = codex.projectLabel(c.cwd); r.source = 'codex'; continue; }
    // titles come from the cached tail read (custom title, then AI title, then first prompt): no whole-file reads
    let t = null; try { const f = path.join(ROOT, r.proj, r.id + '.jsonl'); t = parseTail(f, fs.statSync(f)).title; } catch {}
    r.title = t || r.id; r.project = r.proj.replace(/^-Users-[^-]+-/, '').replace(/-/g, '/');
  }
  return top;
}
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
  for (const r of codex.sessions()) if (now - r.mtime < 12 * 3600e3) rows.push({ proj: codex.PROJ, id: r.id, st: { mtimeMs: r.mtime, size: r.size }, cx: r });
  for (const proj of fs.existsSync(ROOT) ? fs.readdirSync(ROOT) : []) {
    const dir = path.join(ROOT, proj); let files; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) { try { const st = fs.statSync(path.join(dir, f)); if (now - st.mtimeMs < 12 * 3600e3) rows.push({ proj, id: f.slice(0, -6), st }); } catch {} }
  }
  rows.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  return rows.filter((r) => !r.cx).slice(0, 40).concat(rows.filter((r) => r.cx).slice(0, 20)).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs).map(({ proj, id, st, cx }) => {
    if (cx) return codex.boardRow(cx, now);
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

module.exports = { listSessions, boardRows, parseTail };
