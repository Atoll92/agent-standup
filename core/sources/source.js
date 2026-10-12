const { NotImplemented } = require('../errors');

// One tool's sessions (Claude Code, Codex…): where its files are, and what they say. This class is the contract; each tool is a subclass.
//
// Sessions are addressed as (proj, id), a project being whatever the source calls a group of sessions. The rest of the core
// (the timeline, the live feed, the board, the choice of the session to follow) works through this interface and knows no tool by name,
// so adding a tool is a subclass and one line in createCore.
//
// A source is made from the folder its files are in and the reader (reader.js) that remembers what was read of each file.
class Source {
  // 'claude', 'codex'…
  get name() { throw new NotImplemented(this.constructor.name, 'name'); }

  // Is this project one of this source's? Only for sources that have projects of their own (Codex lists all its sessions under one):
  // Claude Code is the default source, whose projects are the folders of its root, and takes every project nobody else owns.
  owns(proj) { return false; }

  // The session's agents and what each of them did: { agents, states, runs } (see timeline.js for what they are).
  // Throws SessionNotFound. Every file read is added to `touched`, so the caller can tell when any of them changes.
  readSession(proj, id, touched) { throw new NotImplemented(this.constructor.name, 'readSession'); }

  // Is the session there?
  exists(proj, id) { throw new NotImplemented(this.constructor.name, 'exists'); }

  // When it was last active (ms), 0 when it is not there.
  mtime(proj, id) { throw new NotImplemented(this.constructor.name, 'mtime'); }

  // A number that changes when anything in its files changes.
  stamp(proj, id) { throw new NotImplemented(this.constructor.name, 'stamp'); }

  // Does it belong to the project asked for by folder name?
  inProject(proj, id, folder) { throw new NotImplemented(this.constructor.name, 'inProject'); }

  // Its sessions in the project asked for (all of them without one): [{ proj, id, mtime }].
  recent(folder) { throw new NotImplemented(this.constructor.name, 'recent'); }

  // Its most recent sessions with a title each, to pick from. Rows have at least proj, id, mtime and title.
  listSessions() { throw new NotImplemented(this.constructor.name, 'listSessions'); }

  // What each session written to in the last `windowMs` is doing. Rows have at least proj, id, mtime and state
  // (working, waiting, blocked, turn or idle, see claude/board.js).
  boardRows({ now, windowMs }) { throw new NotImplemented(this.constructor.name, 'boardRows'); }
}

module.exports = { Source };
