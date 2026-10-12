// Claude Code as a source of sessions (see core/index.js for what a source is).
// A project is a folder of `root`, named after the working folder; a session is <root>/<project>/<session>.jsonl, with its sub-agents' transcripts beside it.
const fs = require('fs'), path = require('path');
const { mtimeOf, createClaudeFiles } = require('./files');
const { createClaudeSession } = require('./session');
const { createClaudeBoard } = require('./board');

// A project asked for by its folder name matches that folder, or a folder inside it (their names start the same).
const inFolder = (proj, folder) => proj === folder || proj.startsWith(folder + '-');

function createClaudeSource({ root, reader }) {
  const files = createClaudeFiles({ root });
  const { readSession } = createClaudeSession({ root, files, reader });
  const board = createClaudeBoard({ root, files });
  const mainFile = (proj, id) => path.join(root, proj, id + '.jsonl');

  const exists = (proj, id) => fs.existsSync(mainFile(proj, id));

  // When a session was last active: its transcript, its sub-agents' transcripts, and the folders they are in
  // (a new file in them is activity too). 0 when the session is not there.
  function mtime(proj, id) {
    let latest = mtimeOf(mainFile(proj, id));
    if (!latest) return 0;
    const subs = files.subFiles(proj, id);
    for (const subAgent of subs) latest = Math.max(latest, mtimeOf(subAgent.file));
    for (const dir of subs.dirs) latest = Math.max(latest, mtimeOf(dir));
    return latest;
  }

  // A number that changes when anything in the session's files changes: the transcripts and the folders they are in
  // (a folder changes when a file appears in it, e.g. an agent's meta file), not every file around them.
  function stamp(proj, id) {
    let total = 0;
    const add = (file) => { try { const stat = fs.statSync(file); total += stat.mtimeMs + stat.size; } catch {} };
    add(mainFile(proj, id));
    const subs = files.subFiles(proj, id);
    for (const subAgent of subs) add(subAgent.file);
    for (const journal of subs.journals) add(journal.file);
    for (const dir of subs.dirs) total += mtimeOf(dir);
    return total;
  }

  // The sessions of the project asked for (all of them without one), each with when it was last active.
  function recent(projFilter) {
    const out = [];
    for (const proj of fs.existsSync(root) ? fs.readdirSync(root) : []) {
      if (projFilter && !inFolder(proj, projFilter)) continue;
      let names;
      try { names = fs.readdirSync(path.join(root, proj)); } catch { continue; }
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue;
        const id = name.slice(0, -'.jsonl'.length), at = mtime(proj, id);
        if (at) out.push({ proj, id, mtime: at });   // 0: a link to a transcript that is gone
      }
    }
    return out;
  }

  return {
    name: 'claude',
    readSession, exists, mtime, stamp, recent,
    inProject: (proj, id, folder) => inFolder(proj, folder),
    listSessions: board.listSessions,
    boardRows: board.boardRows,
    subFiles: files.subFiles,   // not part of what a source is: the pictures of a session are found through it (see server.js)
  };
}

module.exports = { createClaudeSource };
