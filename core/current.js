const fs = require('fs'), path = require('path');
const codex = require('../codex.js');
const { ROOT } = require('./config');
const { mtimeOf, subFiles } = require('./sessionFiles');

// Most recently active session (optionally limited to one project dir) — drives the live feed.
const STICK_MS = 90000;   // a session written to in the last 90 s keeps the call, so another session writing elsewhere does not steal it mid-line
function sessionMtime(proj, id) {
  if (proj === codex.PROJ) { const r = codex.row(id); return r ? r.mtime : 0; }
  let m = mtimeOf(path.join(ROOT, proj, id + '.jsonl')); if (!m) return 0; const subs = subFiles(proj, id);
  for (const x of subs) m = Math.max(m, mtimeOf(x.file)); for (const d of subs.dirs) m = Math.max(m, mtimeOf(d)); return m;   // the folders too: a new file in them is activity, as when every file around the transcripts was looked at
}
function currentSession(projFilter, idFilter, stick) {
  const safe = (x) => typeof x === 'string' && /^[\w.\-]+$/.test(x) && x !== '..';
  if (stick && safe(stick.id) && safe(stick.proj) && (!projFilter || stick.proj === projFilter || stick.proj.startsWith(projFilter + '-') || (stick.proj === codex.PROJ && codex.inProject(stick.id, projFilter))) && Date.now() - sessionMtime(stick.proj, stick.id) < STICK_MS) return { proj: stick.proj, id: stick.id, mtime: sessionMtime(stick.proj, stick.id) };
  if (idFilter && projFilter && projFilter !== '..' && idFilter !== '..' && /^[\w.\-]+$/.test(idFilter) && /^[\w.\-]+$/.test(projFilter) && (projFilter === codex.PROJ ? !!codex.fileOf(idFilter) : fs.existsSync(path.join(ROOT, projFilter, idFilter + '.jsonl')))) return { proj: projFilter, id: idFilter, mtime: Date.now() };   // pinned from the board
  let best = null;
  const consider = (proj, id, m) => { if (!best || m > best.mtime) best = { proj, id, mtime: m }; };
  for (const r of codex.sessions()) if (!projFilter || codex.inProject(r.id, projFilter)) consider(codex.PROJ, r.id, r.mtime);   // a Codex session counts for a project when it was started in that folder
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

module.exports = { currentSession, sessionMtime };
