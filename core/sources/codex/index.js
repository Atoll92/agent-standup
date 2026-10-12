// Codex (OpenAI's Codex: the desktop app and the command line) as a source of sessions (see source.js).
// A Codex session is one file somewhere else (see files.js), in another format (see record.js), and has no sub-agents.
// Its records become the events a Claude Code record gives (say, user, tool, results, usage, compact), so everything after that is shared:
// the timeline, the live feed, the board.
const fs = require('fs');
const { Source } = require('../source');
const { SessionNotFound } = require('../../errors');
const { Agent } = require('../../models');
const { PROJ, createCodexFiles } = require('./files');
const { createCodexBoard } = require('./board');
const { parser } = require('./record');
const { toolLabel, clip, RESULT_MAX } = require('../../transcript');

class CodexSource extends Source {
  #files;
  #board;
  #record;
  #reader;

  // `home`: the folder Codex keeps its files in, or null for no Codex sessions. `scanTtlMs`: see createCodexFiles.
  constructor({ home = null, scanTtlMs, reader }) {
    super();
    this.#files = createCodexFiles({ home, scanTtlMs });
    this.#board = createCodexBoard({ files: this.#files });
    this.#record = parser({ toolLabel, clip, resultMax: RESULT_MAX });
    this.#reader = reader;
  }

  get name() { return 'codex'; }
  get home() { return this.#files.home; }

  // Every Codex session is listed under one made-up project. No Claude Code project folder can have that name.
  owns(proj) { return proj === PROJ; }

  // Just the lead: the thread is the only agent.
  readSession(proj, id, touched) {
    const mainFile = this.#files.fileOf(id) || '';
    if (!fs.existsSync(mainFile)) throw new SessionNotFound();
    touched.push(mainFile);
    return {
      agents: { [Agent.LEAD_ID]: Agent.lead({ name: 'Codex' }) },
      states: [this.#reader.readNew(mainFile, 'main', false, this.#record)],
      runs: {},
    };
  }

  exists(proj, id) { return !!this.#files.fileOf(id); }

  mtime(proj, id) {
    const rollout = this.#files.row(id);
    return rollout ? rollout.mtime : 0;
  }

  stamp(proj, id) {
    try { const stat = fs.statSync(this.#files.fileOf(id) || ''); return stat.mtimeMs + stat.size; } catch { return 0; }
  }

  // A Codex session counts for a project when it was started in that folder.
  inProject(proj, id, folder) { return this.#files.inProject(id, folder); }

  recent(projFilter) {
    return this.#files.sessions()
      .filter((rollout) => !projFilter || this.#files.inProject(rollout.id, projFilter))
      .map((rollout) => ({ proj: PROJ, id: rollout.id, mtime: rollout.mtime }));
  }

  listSessions() { return this.#board.listSessions(); }
  boardRows(options) { return this.#board.boardRows(options); }
}

module.exports = { CodexSource };
