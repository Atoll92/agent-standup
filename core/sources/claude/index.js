// Claude Code as a source of sessions (see source.js).
// A project is a folder of `root`, named after the working folder; a session is <root>/<project>/<session>.jsonl, with its sub-agents' transcripts beside it.
const fs = require('fs'), path = require('path');
const { Source } = require('../source');
const { mtimeOf, createClaudeFiles } = require('./files');
const { createClaudeSession } = require('./session');
const { createClaudeBoard } = require('./board');

// A project asked for by its folder name matches that folder, or a folder inside it (their names start the same).
const inFolder = (proj, folder) => proj === folder || proj.startsWith(folder + '-');

class ClaudeSource extends Source {
  #root;
  #files;
  #session;
  #board;

  constructor({ root, reader }) {
    super();
    this.#root = root;
    this.#files = createClaudeFiles({ root });
    this.#session = createClaudeSession({ root, files: this.#files, reader });
    this.#board = createClaudeBoard({ root, files: this.#files });
  }

  get name() { return 'claude'; }

  readSession(proj, id, touched) { return this.#session.readSession(proj, id, touched); }

  exists(proj, id) { return fs.existsSync(this.#mainFile(proj, id)); }

  // When a session was last active: its transcript, its sub-agents' transcripts, and the folders they are in
  // (a new file in them is activity too). 0 when the session is not there.
  mtime(proj, id) {
    let latest = mtimeOf(this.#mainFile(proj, id));
    if (!latest) return 0;
    const subs = this.#files.subFiles(proj, id);
    for (const subAgent of subs) latest = Math.max(latest, mtimeOf(subAgent.file));
    for (const dir of subs.dirs) latest = Math.max(latest, mtimeOf(dir));
    return latest;
  }

  // A number that changes when anything in the session's files changes: the transcripts and the folders they are in
  // (a folder changes when a file appears in it, e.g. an agent's meta file), not every file around them.
  stamp(proj, id) {
    let total = 0;
    const add = (file) => { try { const stat = fs.statSync(file); total += stat.mtimeMs + stat.size; } catch {} };
    add(this.#mainFile(proj, id));
    const subs = this.#files.subFiles(proj, id);
    for (const subAgent of subs) add(subAgent.file);
    for (const journal of subs.journals) add(journal.file);
    for (const dir of subs.dirs) total += mtimeOf(dir);
    return total;
  }

  inProject(proj, id, folder) { return inFolder(proj, folder); }

  // The sessions of the project asked for (all of them without one), each with when it was last active.
  recent(projFilter) {
    const sessions = [];
    for (const proj of fs.existsSync(this.#root) ? fs.readdirSync(this.#root) : []) {
      if (projFilter && !inFolder(proj, projFilter)) continue;
      let names;
      try { names = fs.readdirSync(path.join(this.#root, proj)); } catch { continue; }
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue;
        const id = name.slice(0, -'.jsonl'.length), at = this.mtime(proj, id);
        if (at) sessions.push({ proj, id, mtime: at });   // 0: a link to a transcript that is gone
      }
    }
    return sessions;
  }

  listSessions() { return this.#board.listSessions(); }
  boardRows(options) { return this.#board.boardRows(options); }

  // The transcripts of a session's sub-agents. Not part of what a source is: the pictures of a session are found through it (see server/services/pictures.js).
  subFiles(proj, id) { return this.#files.subFiles(proj, id); }

  #mainFile(proj, id) { return path.join(this.#root, proj, id + '.jsonl'); }
}

module.exports = { ClaudeSource };
