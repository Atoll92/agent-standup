// Which session the live view follows.
const fs = require('fs'), path = require('path');
const { PROJ } = require('../codex.js');
const { mtimeOf } = require('./sessionFiles');

// A session written to in the last 90 s keeps the call, so another session writing elsewhere does not steal it mid-line.
const STICK_MS = 90000;

const isSafeName = (x) => typeof x === 'string' && /^[\w.\-]+$/.test(x) && x !== '..';

// A project asked for by its folder name matches that folder, or a folder inside it (their names start the same).
const inFolder = (proj, folder) => proj === folder || proj.startsWith(folder + '-');

function createCurrent({ root, codex, files }) {
  // When a session was last active: its transcript, its sub-agents' transcripts, and the folders they are in
  // (a new file in them is activity too). 0 when the session is not there.
  function sessionMtime(proj, id) {
    if (proj === PROJ) { const row = codex.row(id); return row ? row.mtime : 0; }
    let latest = mtimeOf(path.join(root, proj, id + '.jsonl'));
    if (!latest) return 0;
    const subs = files.subFiles(proj, id);
    for (const x of subs) latest = Math.max(latest, mtimeOf(x.file));
    for (const dir of subs.dirs) latest = Math.max(latest, mtimeOf(dir));
    return latest;
  }

  // The session to follow, as { proj, id, mtime } ({} when there is none), chosen in this order:
  //   1. `stick`, the one followed so far, while it is still active (and still in the project asked for)
  //   2. the one named by projFilter + idFilter (pinned from the board)
  //   3. the most recently active one (limited to projFilter when given; everywhere if that project has none)
  function currentSession(projFilter, idFilter, stick) {
    return stickyChoice(projFilter, stick) || pinnedChoice(projFilter, idFilter) || newestChoice(projFilter)
      || (projFilter ? currentSession('', '', stick) : {});
  }

  function stickyChoice(projFilter, stick) {
    if (!stick || !isSafeName(stick.id) || !isSafeName(stick.proj)) return null;
    const inProject = !projFilter || inFolder(stick.proj, projFilter) || (stick.proj === PROJ && codex.inProject(stick.id, projFilter));
    if (!inProject || Date.now() - sessionMtime(stick.proj, stick.id) >= STICK_MS) return null;
    return { proj: stick.proj, id: stick.id, mtime: sessionMtime(stick.proj, stick.id) };
  }

  function pinnedChoice(projFilter, idFilter) {
    if (!idFilter || !projFilter || !isSafeName(idFilter) || !isSafeName(projFilter)) return null;
    const exists = projFilter === PROJ ? !!codex.fileOf(idFilter) : fs.existsSync(path.join(root, projFilter, idFilter + '.jsonl'));
    return exists ? { proj: projFilter, id: idFilter, mtime: Date.now() } : null;
  }

  function newestChoice(projFilter) {
    let best = null;
    const consider = (proj, id, mtime) => { if (!best || mtime > best.mtime) best = { proj, id, mtime }; };

    // A Codex session counts for a project when it was started in that folder.
    for (const r of codex.sessions()) if (!projFilter || codex.inProject(r.id, projFilter)) consider(PROJ, r.id, r.mtime);

    for (const proj of fs.existsSync(root) ? fs.readdirSync(root) : []) {
      if (projFilter && !inFolder(proj, projFilter)) continue;
      let names;
      try { names = fs.readdirSync(path.join(root, proj)); } catch { continue; }
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue;
        const id = name.slice(0, -'.jsonl'.length), mtime = sessionMtime(proj, id);
        if (mtime) consider(proj, id, mtime);   // 0: a link to a transcript that is gone
      }
    }
    return best;
  }

  return { currentSession, sessionMtime };
}

module.exports = { createCurrent };
